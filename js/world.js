// World: owns all chunks, generates terrain, streams chunks around the player,
// and exposes getBlock / setBlock used by the player and the mesher.
import * as THREE from "three";
import { Chunk, CHUNK_SIZE, WORLD_HEIGHT, WATER_LEVEL } from "./chunk.js";
import { Noise } from "./noise.js";
import { BLOCK, AIR, isSolid } from "./blocks.js";
import { pickBiome } from "./biomes.js";
import { TextureAtlas } from "./textures.js";

const key = (cx, cz) => cx + "," + cz;
const floorDiv = (a, b) => Math.floor(a / b);
// fBm output has std ~0.15 and a practical max near 0.55; normalise to ~[-1,1].
const nz = (v) => Math.max(-1, Math.min(1, v / 0.55));
const CLIMATE_SPREAD = 1.7;
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 3D terrain tuning.
const SURF_BAND = 12;      // vertical band (± base height) where 3D noise sculpts the surface
const SURF_AMP = 6;        // how far the surface boundary is pushed by 3D noise
const OVERHANG_AMP = 4;    // low-frequency term that creates cliffs/overhangs
const CAVE_TUBE = 0.018;   // tunnel radius² — larger = wider/more tunnels
const CAVE_ROOM = 0.66;    // cavern threshold — lower = more open caverns
const CAVE_CEIL = 1;       // keep this many solid blocks below the surface uncarved
                          // (low -> caves open onto cliffs/hillsides as entrances)

// Water simulation.
const WATER_SOURCE = 9;   // permanent full-water level (oceans/lakes)
const WATER_FULL = 8;     // a full flowing block; horizontal flow decays from here

function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class World {
  constructor(scene, { seed = 1337, renderDistance = 6 } = {}) {
    this.scene = scene;
    this.renderDistance = renderDistance;
    this.chunks = new Map();
    this.heightNoise = new Noise(seed);
    this.tempNoise = new Noise(seed * 7 + 11);
    this.humidityNoise = new Noise(seed * 17 + 3);
    this.detailNoise = new Noise(seed * 13 + 5);
    this.warpNoise = new Noise(seed * 31 + 7);
    // 3D fields: surface density perturbation + two cave systems.
    this.surfaceNoise = new Noise(seed * 53 + 1);
    this.caveNoiseA = new Noise(seed * 101 + 9);
    this.caveNoiseB = new Noise(seed * 211 + 13);
    this.caveNoiseC = new Noise(seed * 307 + 17);
    // Reusable per-column solidity scratch buffer (avoids per-column allocation).
    this._col = new Uint8Array(WORLD_HEIGHT);
    this._freeze = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); // per-column "freezes" flag

    this.atlas = new TextureAtlas();
    this.materials = this.buildMaterials();

    this.genQueue = [];
    this.meshQueue = [];
    this.waterActive = new Set(); // packed "x,y,z" keys of cells to re-evaluate
    this.waterSeamQueue = new Set(); // chunk keys needing a cross-border water re-flood
  }

  buildMaterials() {
    const map = this.atlas.texture;
    const opaque = new THREE.MeshBasicMaterial({ map, vertexColors: true });
    const foliage = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
    });
    // depthWrite:true so overlapping water faces from different chunk meshes
    // don't cumulatively blend (which produced darker seams at chunk borders).
    const water = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, opacity: 0.78,
      depthWrite: true, side: THREE.DoubleSide,
    });
    return { opaque, foliage, water };
  }

  // ---- Block access (world coordinates) ----
  getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    const cx = floorDiv(x, CHUNK_SIZE), cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  setBlock(x, y, z, id, remesh = true) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = floorDiv(x, CHUNK_SIZE), cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    chunk.set(lx, y, lz, id);
    chunk.setW(lx, y, lz, 0); // the cell's standing water is cleared by the edit
    if (!remesh) return;
    chunk.dirty = true;
    this.queueMesh(chunk);
    // Remesh neighbours if the edit touches a chunk border.
    if (lx === 0) this.markNeighbor(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markNeighbor(cx + 1, cz);
    if (lz === 0) this.markNeighbor(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markNeighbor(cx, cz + 1);
    // Wake the fluid so it flows into a broken block / re-settles around a placed one.
    this.enqueueWaterAround(x, y, z);
  }

  // ---- Water simulation ----
  getWaterLevel(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = floorDiv(x, CHUNK_SIZE), cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return 0;
    return chunk.getW(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  enqueueWater(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.waterActive.add(x + "," + y + "," + z);
  }

  enqueueWaterAround(x, y, z) {
    this.enqueueWater(x, y, z);
    this.enqueueWater(x, y + 1, z);
    this.enqueueWater(x, y - 1, z);
    this.enqueueWater(x + 1, y, z);
    this.enqueueWater(x - 1, y, z);
    this.enqueueWater(x, y, z + 1);
    this.enqueueWater(x, y, z - 1);
  }

  setWaterCell(x, y, z, level) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cx = floorDiv(x, CHUNK_SIZE), cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.chunks.get(key(cx, cz));
    if (!chunk) return;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const wasWater = chunk.get(lx, y, lz) === BLOCK.WATER;
    if (level > 0) {
      chunk.set(lx, y, lz, BLOCK.WATER);
      chunk.setW(lx, y, lz, level);
    } else {
      if (wasWater) chunk.set(lx, y, lz, AIR);
      chunk.setW(lx, y, lz, 0);
    }
    chunk.dirty = true;
    this.queueMesh(chunk);
    if (lx === 0) this.markNeighbor(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markNeighbor(cx + 1, cz);
    if (lz === 0) this.markNeighbor(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markNeighbor(cx, cz + 1);
  }

  // Process a bounded number of queued cells. New changes enqueue their
  // neighbours, so flows animate across successive ticks.
  simulateWater(maxOps = 1500) {
    if (this.waterActive.size === 0) return;
    const batch = [];
    for (const k of this.waterActive) {
      batch.push(k);
      if (batch.length >= maxOps) break;
    }
    for (const k of batch) this.waterActive.delete(k);
    for (const k of batch) {
      const c = k.split(",");
      this.updateWaterCell(+c[0], +c[1], +c[2]);
    }
  }

  updateWaterCell(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id !== AIR && id !== BLOCK.WATER) return;   // solid cells hold no water
    const cur = this.getWaterLevel(x, y, z);
    if (cur === WATER_SOURCE) return;               // sources are permanent

    let target = 0;
    if (this.getWaterLevel(x, y + 1, z) > 0) {
      target = WATER_FULL;                          // water above -> we fill fully (falling/submerged)
    } else {
      const N = [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1]];
      for (const [nx, ny, nz] of N) {
        const nl = this.getWaterLevel(nx, ny, nz);
        if (nl <= 0) continue;
        if (nl === WATER_SOURCE) { if (WATER_FULL - 1 > target) target = WATER_FULL - 1; continue; }
        // A flowing neighbour spreads sideways only if it rests on solid ground.
        // Water with air/water below it is mid-fall and feeds only downward, so
        // waterfalls stay narrow instead of sheeting out at every height.
        if (!isSolid(this.getBlock(nx, ny - 1, nz))) continue;
        if (nl - 1 > target) target = nl - 1;
      }
    }

    if (target !== cur) {
      this.setWaterCell(x, y, z, target);
      this.enqueueWaterAround(x, y, z);
    }
  }

  markNeighbor(cx, cz) {
    const c = this.chunks.get(key(cx, cz));
    if (c) { c.dirty = true; this.queueMesh(c); }
  }

  queueMesh(chunk) {
    if (!this.meshQueue.includes(chunk)) this.meshQueue.push(chunk);
  }

  // ---- Terrain generation ----
  // Broad 2D shape: continents, mountain ranges, ridges. Returns a float so the
  // 3D surface band can sculpt around it. This is the *target* surface height;
  // the 3D density field perturbs the actual solid/air boundary around it.
  baseHeight(wx, wz) {
    // Domain warp the sample point so coastlines and ranges wind naturally.
    const wxw = wx + 34 * this.warpNoise.noise2(wx * 0.004 + 50, wz * 0.004);
    const wzw = wz + 34 * this.warpNoise.noise2(wx * 0.004, wz * 0.004 + 50);

    const cont = nz(this.heightNoise.fbm2(wxw * 0.0014, wzw * 0.0014, 3, 2, 0.5)); // land vs sea
    const erosion = nz(this.detailNoise.fbm2(wxw * 0.0032, wzw * 0.0032, 2, 2, 0.5));
    const mask = smoothstep(0.0, 0.7, erosion);                                    // where mountains rise
    let ridge = this.detailNoise.ridged2(wxw * 0.008, wzw * 0.008, 3, 2, 0.5);
    const rounding = this.heightNoise.fbm2(wxw * 0.008, wzw * 0.008, 2, 2, 0.5) * 0.5 + 0.5;
    ridge = 0.72 * ridge + 0.28 * rounding;
    const detail = this.heightNoise.fbm2(wx * 0.03, wz * 0.03, 3, 2, 0.5);

    const h = WATER_LEVEL + 5 + cont * 22 + mask * ridge * 82 + detail * 4;
    return Math.max(1, Math.min(WORLD_HEIGHT - 2, h));
  }

  // True if the voxel is solid terrain (before caves). Inside a vertical band
  // around the base height, a 3D noise field pushes the solid/air boundary in
  // and out — this is what removes contour terracing and grows cliffs/overhangs.
  terrainSolid(wx, wy, wz, h) {
    if (wy > h + SURF_BAND) return false;
    if (wy <= h - SURF_BAND) return true;
    const n = this.surfaceNoise.noise3(wx * 0.045, wy * 0.05, wz * 0.045);
    const big = this.surfaceNoise.noise3(wx * 0.018 + 9, wy * 0.022, wz * 0.018);
    const density = (h - wy) + n * SURF_AMP + big * OVERHANG_AMP;
    return density > 0;
  }

  // True if this underground voxel should be carved into a cave.
  caveAt(wx, wy, wz, hi) {
    if (wy < 5 || wy > hi - CAVE_CEIL) return false;
    // Spaghetti tunnels: where two noise fields are both near zero -> a tube.
    const t1 = this.caveNoiseA.noise3(wx * 0.028, wy * 0.046, wz * 0.028);
    const t2 = this.caveNoiseB.noise3(wx * 0.028, wy * 0.046, wz * 0.028);
    if (t1 * t1 + t2 * t2 < CAVE_TUBE) return true;
    // Cheese caverns: blobby open rooms.
    if (this.caveNoiseC.noise3(wx * 0.021, wy * 0.04, wz * 0.021) > CAVE_ROOM) return true;
    return false;
  }

  climate(noise, wx, wz) {
    return Math.max(-1, Math.min(1, noise.fbm2(wx * 0.004, wz * 0.004, 3, 2, 0.5) * CLIMATE_SPREAD));
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const solid = this._col;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const h = this.baseHeight(wx, wz);
        const hi = Math.floor(h);
        const temp = this.climate(this.tempNoise, wx, wz);
        const humidity = this.climate(this.humidityNoise, wx, wz);
        const rockJitter = this.warpNoise.noise2(wx * 0.06, wz * 0.06) * 6;
        const snowJitter = this.detailNoise.noise2(wx * 0.07 + 20, wz * 0.07) * 6;
        const biome = pickBiome(temp, humidity, hi, WATER_LEVEL, hi + rockJitter);
        this._freeze[lx + lz * CHUNK_SIZE] = biome.freezesWater ? 1 : 0;

        // 1) Build the column solidity from the 3D density field, minus caves.
        //    Always cover at least up to sea level so the water pass reads valid data.
        const top = Math.min(WORLD_HEIGHT - 1, Math.max(hi + SURF_BAND, WATER_LEVEL));
        for (let y = 0; y <= top; y++) {
          let s = this.terrainSolid(wx, y, wz, h) ? 1 : 0;
          if (s && this.caveAt(wx, y, wz, hi)) s = 0;
          if (y === 0) s = 1; // guaranteed bedrock floor, no void holes
          solid[y] = s;
        }

        // 1b) Open thin cave roofs at the surface into clean entrances rather
        //     than leaving 1-2 block caps floating over the void below.
        for (let pass = 0; pass < 4; pass++) {
          let y0 = -1;
          for (let y = top; y >= 0; y--) { if (solid[y]) { y0 = y; break; } }
          if (y0 <= 5) break;
          let thick = 0, y = y0;
          while (y >= 0 && solid[y]) { thick++; y--; }
          if (thick <= 2 && y > 4) {
            for (let k = y0; k > y; k--) solid[k] = 0;
          } else break;
        }

        // 2) Assign materials top-down. Only the first, sky-exposed solid run
        //    is the real surface (grass/subsurface). Once we drop below the
        //    first air gap, everything is shadowed (cave floors, ground under
        //    overhangs) and stays bare rock — grass/snow don't grow there.
        let depth = 0;
        let sky = true;
        let surfaceTopY = -1;
        for (let y = top; y >= 0; y--) {
          if (!solid[y]) {
            if (depth > 0) sky = false; // finished the exposed run; below is in shadow
            depth = 0;
            continue;
          }
          let id;
          if (y === 0) {
            id = BLOCK.BEDROCK;
          } else if (sky && depth === 0) {
            // Real, sky-exposed surface.
            id = (y <= WATER_LEVEL) ? biome.underwater : biome.surface;
            if (biome.snowCap && y > WATER_LEVEL) {
              if (y + snowJitter > 72) id = BLOCK.SNOW;
              else if (this.detailNoise.noise2(wx * 0.15, wz * 0.15) > 0.28) id = BLOCK.GRAVEL;
            }
            if (surfaceTopY < 0 && y > WATER_LEVEL) surfaceTopY = y;
          } else if (sky && depth <= 3) {
            id = biome.subsurface;
          } else {
            // Shadowed rock: cave floors/ceilings and ground beneath overhangs.
            id = this.stoneOrOre(wx, y, wz, hi);
          }
          chunk.set(lx, y, lz, id);
          depth++;
        }

        // 3) Decorate the highest land surface (if any).
        if (surfaceTopY > WATER_LEVEL) {
          this.decorate(chunk, biome, lx, surfaceTopY, lz, wx, wz);
        }
      }
    }

    // 4) Flood-fill water: fill all air connected to the open sea surface, at
    //    any depth (under overhangs, into ocean-connected caves). Enclosed
    //    caves stay dry. Then freeze the top layer in cold biomes.
    this.floodWater(chunk);
    this.capIce(chunk);

    chunk.dirty = true;
    this.chunks.set(key(cx, cz), chunk);
    // Let already-loaded neighbours absorb water from this chunk's borders, and
    // let this chunk absorb from neighbours generated earlier.
    this.markWaterSeamNeighbors(chunk);
    return chunk;
  }

  // Breadth-first flood from open-sky water-surface cells (and from neighbouring
  // chunks' border water) through connected air at or below sea level.
  // Generated water is all "source" (stable, full).
  floodWater(chunk) {
    const stack = [];
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (chunk.get(lx, WATER_LEVEL, lz) === AIR &&
            chunk.get(lx, WATER_LEVEL + 1, lz) === AIR) {
          chunk.set(lx, WATER_LEVEL, lz, BLOCK.WATER);
          chunk.setW(lx, WATER_LEVEL, lz, WATER_SOURCE);
          stack.push(lx, WATER_LEVEL, lz);
        }
      }
    }
    this.collectBorderSeeds(chunk, stack);
    this.floodBFS(chunk, stack);
  }

  // Seed from air cells on a chunk edge whose neighbour (across the border, in
  // an already-loaded chunk) is water.
  collectBorderSeeds(chunk, stack) {
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const C = CHUNK_SIZE - 1;
    for (let y = 0; y <= WATER_LEVEL; y++) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        if (chunk.get(0, y, i) === AIR && this.getBlock(ox - 1, y, oz + i) === BLOCK.WATER)
          this.floodStep(chunk, stack, 0, y, i);
        if (chunk.get(C, y, i) === AIR && this.getBlock(ox + CHUNK_SIZE, y, oz + i) === BLOCK.WATER)
          this.floodStep(chunk, stack, C, y, i);
        if (chunk.get(i, y, 0) === AIR && this.getBlock(ox + i, y, oz - 1) === BLOCK.WATER)
          this.floodStep(chunk, stack, i, y, 0);
        if (chunk.get(i, y, C) === AIR && this.getBlock(ox + i, y, oz + CHUNK_SIZE) === BLOCK.WATER)
          this.floodStep(chunk, stack, i, y, C);
      }
    }
  }

  floodBFS(chunk, stack) {
    let added = stack.length / 3;
    while (stack.length) {
      const z = stack.pop(), y = stack.pop(), x = stack.pop();
      added += this.floodStep(chunk, stack, x + 1, y, z);
      added += this.floodStep(chunk, stack, x - 1, y, z);
      added += this.floodStep(chunk, stack, x, y, z + 1);
      added += this.floodStep(chunk, stack, x, y, z - 1);
      added += this.floodStep(chunk, stack, x, y - 1, z);
      added += this.floodStep(chunk, stack, x, y + 1, z);
    }
    return added;
  }

  floodStep(chunk, stack, x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return 0;
    if (y < 0 || y > WATER_LEVEL) return 0;
    if (chunk.get(x, y, z) !== AIR) return 0;
    chunk.set(x, y, z, BLOCK.WATER);
    chunk.setW(x, y, z, WATER_SOURCE);
    stack.push(x, y, z);
    return 1;
  }

  markWaterSeamNeighbors(chunk) {
    const c = [[chunk.cx + 1, chunk.cz], [chunk.cx - 1, chunk.cz],
               [chunk.cx, chunk.cz + 1], [chunk.cx, chunk.cz - 1]];
    for (const [nx, nz] of c) {
      if (this.chunks.has(key(nx, nz))) this.waterSeamQueue.add(key(nx, nz));
    }
  }

  // Re-flood a chunk from its borders (water that arrived in a neighbour after
  // this chunk was generated). Cascades to neighbours if it adds anything.
  refloodFromBorders(chunk) {
    const stack = [];
    this.collectBorderSeeds(chunk, stack);
    if (stack.length === 0) return;
    const added = this.floodBFS(chunk, stack);
    if (added > 0) {
      chunk.dirty = true;
      this.queueMesh(chunk);
      // Neighbours' border faces now sit against new water and must be re-culled,
      // or they leave a stale "wall" of faces inside the body.
      this.markNeighbor(chunk.cx + 1, chunk.cz);
      this.markNeighbor(chunk.cx - 1, chunk.cz);
      this.markNeighbor(chunk.cx, chunk.cz + 1);
      this.markNeighbor(chunk.cx, chunk.cz - 1);
      this.markWaterSeamNeighbors(chunk);
    }
  }

  capIce(chunk) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (this._freeze[lx + lz * CHUNK_SIZE] &&
            chunk.get(lx, WATER_LEVEL, lz) === BLOCK.WATER) {
          chunk.set(lx, WATER_LEVEL, lz, BLOCK.ICE);
          chunk.setW(lx, WATER_LEVEL, lz, 0);
        }
      }
    }
  }

  // Returns stone, occasionally replaced by ore based on depth.
  stoneOrOre(wx, y, wz, hi) {
    if (y < hi - 4) {
      const r = hash3(wx, y, wz);
      if (y < 16 && r < 0.0035) return BLOCK.GOLD_ORE;
      if (y < 48 && r < 0.011) return BLOCK.IRON_ORE;
      if (r < 0.03) return BLOCK.COAL_ORE;
    }
    return BLOCK.STONE;
  }

  // Place a tree or a surface plant according to the biome's config.
  decorate(chunk, biome, lx, height, lz, wx, wz) {
    const topY = height + 1;
    if (topY >= WORLD_HEIGHT) return;

    const tree = biome.tree;
    if (tree && hash2(wx, wz) < tree.chance &&
        lx > 1 && lx < CHUNK_SIZE - 2 && lz > 1 && lz < CHUNK_SIZE - 2) {
      if (tree.type === "cactus") this.placeCactus(chunk, lx, topY, lz, wx, wz);
      else this.placeTree(chunk, lx, topY, lz, wx, wz);
      return;
    }

    // Otherwise maybe a plant. A single roll picks at most one plant type.
    let roll = hash2(wx + 101, wz - 57);
    for (const p of biome.plants) {
      if (roll < p.chance) {
        if (chunk.get(lx, topY, lz) === AIR) chunk.set(lx, topY, lz, p.block);
        return;
      }
      roll -= p.chance;
    }
  }

  placeCactus(chunk, lx, baseY, lz, wx, wz) {
    const h = 1 + Math.floor(hash2(wx + 7, wz + 13) * 3);
    for (let i = 0; i < h; i++) {
      if (baseY + i >= WORLD_HEIGHT) break;
      chunk.set(lx, baseY + i, lz, BLOCK.CACTUS);
    }
  }

  placeTree(chunk, lx, baseY, lz, wx, wz) {
    const trunk = 4 + Math.floor(hash2(wx + 17, wz - 31) * 3);
    const topY = baseY + trunk;
    if (topY + 2 >= WORLD_HEIGHT) return;
    for (let y = baseY; y < topY; y++) chunk.set(lx, y, lz, BLOCK.LOG);

    // Leaf canopy.
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= 0 ? 2 : 1;
      const cy = topY - 1 + dy;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && hash2(wx + dx, wz + dz) < 0.5) continue;
          const x = lx + dx, z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          if (chunk.get(x, cy, z) === AIR) chunk.set(x, cy, z, BLOCK.LEAVES);
        }
      }
    }
  }

  // ---- Meshing ----
  buildChunkMesh(chunk) {
    const geom = chunk.buildGeometry(this);
    if (chunk.meshes) {
      for (const k of ["opaque", "foliage", "water"]) {
        const m = chunk.meshes[k];
        if (m) { this.scene.remove(m); m.geometry.dispose(); }
      }
    }
    const meshes = {};
    const add = (k, mat) => {
      const g = geom[k];
      if (!g) { meshes[k] = null; return; }
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      meshes[k] = mesh;
    };
    add("opaque", this.materials.opaque);
    add("foliage", this.materials.foliage);
    add("water", this.materials.water);
    chunk.meshes = meshes;
    chunk.dirty = false;
  }

  // ---- Streaming around the player ----
  update(playerPos, budget = { gen: 3, mesh: 4 }) {
    const pcx = floorDiv(playerPos.x, CHUNK_SIZE);
    const pcz = floorDiv(playerPos.z, CHUNK_SIZE);
    const R = this.renderDistance;

    // Queue generation (radius + 1 so mesh neighbours always have data).
    const genR = R + 1;
    const wanted = [];
    for (let dz = -genR; dz <= genR; dz++) {
      for (let dx = -genR; dx <= genR; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const dist = dx * dx + dz * dz;
        if (!this.chunks.has(key(cx, cz))) wanted.push({ cx, cz, dist });
      }
    }
    wanted.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(budget.gen, wanted.length); i++) {
      this.generateChunk(wanted[i].cx, wanted[i].cz);
    }

    // Queue meshing for chunks in render distance whose neighbours exist.
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const chunk = this.chunks.get(key(cx, cz));
        if (!chunk || !chunk.dirty) continue;
        if (chunk.meshes && !chunk.dirty) continue;
        if (this.neighborsReady(cx, cz)) this.queueMesh(chunk);
      }
    }

    // Cross-chunk water seam re-flood (a few per frame). Queues remeshes.
    if (this.waterSeamQueue.size) {
      const seam = [];
      for (const k of this.waterSeamQueue) { seam.push(k); if (seam.length >= 3) break; }
      for (const k of seam) {
        this.waterSeamQueue.delete(k);
        const c = this.chunks.get(k);
        if (c) this.refloodFromBorders(c);
      }
    }

    // Process mesh queue nearest-first.
    this.meshQueue.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });
    let meshed = 0;
    while (this.meshQueue.length && meshed < budget.mesh) {
      const chunk = this.meshQueue.shift();
      if (!this.chunks.has(key(chunk.cx, chunk.cz))) continue;
      this.buildChunkMesh(chunk);
      meshed++;
    }

    // Unload distant chunks.
    const unloadR = R + 2;
    for (const [k, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) > unloadR || Math.abs(chunk.cz - pcz) > unloadR) {
        if (chunk.meshes) {
          for (const mk of ["opaque", "foliage", "water"]) {
            const m = chunk.meshes[mk];
            if (m) { this.scene.remove(m); m.geometry.dispose(); }
          }
        }
        this.chunks.delete(k);
      }
    }
  }

  neighborsReady(cx, cz) {
    // All 8 surrounding chunks: the mesher's ambient-occlusion corner samples
    // reach diagonally into neighbours, so meshing before the diagonal chunks
    // exist bakes a darker AO seam along chunk borders.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (!this.chunks.has(key(cx + dx, cz + dz))) return false;
      }
    }
    return true;
  }

  // True once the chunk under the player (and its ring) is generated.
  isReady(playerPos) {
    const pcx = floorDiv(playerPos.x, CHUNK_SIZE);
    const pcz = floorDiv(playerPos.z, CHUNK_SIZE);
    return this.neighborsReady(pcx, pcz) && this.chunks.has(key(pcx, pcz));
  }
}
