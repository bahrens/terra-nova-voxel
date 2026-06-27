// World: owns all chunks, generates terrain, streams chunks around the player,
// and exposes getBlock / setBlock used by the player and the mesher.
import * as THREE from "three";
import { Chunk, CHUNK_SIZE, WORLD_HEIGHT, WATER_LEVEL } from "./chunk.js";
import { Noise } from "./noise.js";
import { BLOCK, AIR } from "./blocks.js";
import { pickBiome } from "./biomes.js";
import { TextureAtlas } from "./textures.js";

const key = (cx, cz) => cx + "," + cz;
const floorDiv = (a, b) => Math.floor(a / b);
// fBm output has std ~0.15 and a practical max near 0.55; normalise to ~[-1,1].
const nz = (v) => Math.max(-1, Math.min(1, v / 0.55));
const CLIMATE_SPREAD = 1.7;

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

    this.atlas = new TextureAtlas();
    this.materials = this.buildMaterials();

    this.genQueue = [];
    this.meshQueue = [];
  }

  buildMaterials() {
    const map = this.atlas.texture;
    const opaque = new THREE.MeshBasicMaterial({ map, vertexColors: true });
    const foliage = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
    });
    const water = new THREE.MeshBasicMaterial({
      map, vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
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
    if (!remesh) return;
    chunk.dirty = true;
    this.queueMesh(chunk);
    // Remesh neighbours if the edit touches a chunk border.
    if (lx === 0) this.markNeighbor(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markNeighbor(cx + 1, cz);
    if (lz === 0) this.markNeighbor(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markNeighbor(cx, cz + 1);
  }

  markNeighbor(cx, cz) {
    const c = this.chunks.get(key(cx, cz));
    if (c) { c.dirty = true; this.queueMesh(c); }
  }

  queueMesh(chunk) {
    if (!this.meshQueue.includes(chunk)) this.meshQueue.push(chunk);
  }

  // ---- Terrain generation ----
  columnHeight(wx, wz) {
    const cont = nz(this.heightNoise.fbm2(wx * 0.004, wz * 0.004, 4, 2, 0.5));  // continents
    const hills = this.heightNoise.fbm2(wx * 0.02, wz * 0.02, 3, 2, 0.5);        // local bumps
    // Large-scale mask so mountains cluster into ranges instead of spikes.
    const mask = Math.max(0, nz(this.detailNoise.fbm2(wx * 0.0015, wz * 0.0015, 2, 2, 0.5)));
    const peak = Math.pow(mask, 1.7);
    const h = WATER_LEVEL + 2 + cont * 12 + hills * 6 + peak * 52;
    return Math.max(1, Math.min(WORLD_HEIGHT - 9, Math.floor(h)));
  }

  climate(noise, wx, wz) {
    return Math.max(-1, Math.min(1, noise.fbm2(wx * 0.004, wz * 0.004, 3, 2, 0.5) * CLIMATE_SPREAD));
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const height = this.columnHeight(wx, wz);
        const temp = this.climate(this.tempNoise, wx, wz);
        const humidity = this.climate(this.humidityNoise, wx, wz);
        const biome = pickBiome(temp, humidity, height, WATER_LEVEL);
        const underwater = height <= WATER_LEVEL;

        for (let y = 0; y <= height; y++) {
          let id;
          if (y === 0) {
            id = BLOCK.BEDROCK;
          } else if (y === height) {
            id = underwater ? biome.underwater : biome.surface;
            if (biome.snowCap && height > 64) id = BLOCK.SNOW;
          } else if (y >= height - 3) {
            id = biome.subsurface;
          } else {
            id = this.stoneOrOre(wx, y, wz, height);
          }
          chunk.set(lx, y, lz, id);
        }

        // Fill water up to sea level (frozen surface in cold biomes).
        for (let y = height + 1; y <= WATER_LEVEL; y++) {
          const ice = biome.freezesWater && y === WATER_LEVEL;
          chunk.set(lx, y, lz, ice ? BLOCK.ICE : BLOCK.WATER);
        }

        if (!underwater) this.decorate(chunk, biome, lx, height, lz, wx, wz);
      }
    }
    chunk.dirty = true;
    this.chunks.set(key(cx, cz), chunk);
    return chunk;
  }

  // Returns stone, occasionally replaced by ore based on depth.
  stoneOrOre(wx, y, wz, height) {
    if (y < height - 4) {
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
  update(playerPos, budget = { gen: 2, mesh: 3 }) {
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
    return this.chunks.has(key(cx + 1, cz)) && this.chunks.has(key(cx - 1, cz)) &&
           this.chunks.has(key(cx, cz + 1)) && this.chunks.has(key(cx, cz - 1));
  }

  // True once the chunk under the player (and its ring) is generated.
  isReady(playerPos) {
    const pcx = floorDiv(playerPos.x, CHUNK_SIZE);
    const pcz = floorDiv(playerPos.z, CHUNK_SIZE);
    return this.neighborsReady(pcx, pcz) && this.chunks.has(key(pcx, pcz));
  }
}
