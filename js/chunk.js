// A chunk is a CHUNK_SIZE × WORLD_HEIGHT × CHUNK_SIZE column of voxels.
// The mesher culls hidden faces, bakes directional lighting + ambient occlusion
// into vertex colours, and emits separate geometry for opaque / foliage / water.
import * as THREE from "three";
import { AIR, BLOCK, BLOCKS, isOpaque, isLiquid } from "./blocks.js";

// Rendered top height of an *open* (air above) water cell: a surface source
// sits slightly below the block top; flowing water tapers with its level.
// Cells capped by water or solid above always render full height (1.0).
function surfaceHeight(level) {
  if (level >= 9) return 0.875;          // source
  return Math.max(0.12, (level / 8) * 0.85); // flowing 1-8
}

// Water is shaded almost uniformly so vertical faces (pond/cliff edges, depth
// steps, residual pockets) read as water rather than dark walls.
const WATER_LIGHT = { top: 1.0, side: 0.94, bottom: 0.88 };

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 112;
export const WATER_LEVEL = 26;

// Face base brightness (fake directional light).
const FACE_LIGHT = { top: 1.0, bottom: 0.55, x: 0.68, z: 0.82 };

// 6 face directions with tangent axes chosen so u × v = normal (correct winding).
const FACES = [
  { dir: [ 1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], light: FACE_LIGHT.x,    tile: "side"   }, // +X
  { dir: [-1, 0, 0], u: [0, 0,  1], v: [0, 1, 0], light: FACE_LIGHT.x,    tile: "side"   }, // -X
  { dir: [ 0, 1, 0], u: [0, 0,  1], v: [1, 0, 0], light: FACE_LIGHT.top,  tile: "top"    }, // +Y
  { dir: [ 0,-1, 0], u: [1, 0,  0], v: [0, 0, 1], light: FACE_LIGHT.bottom,tile: "bottom"}, // -Y
  { dir: [ 0, 0, 1], u: [1, 0,  0], v: [0, 1, 0], light: FACE_LIGHT.z,    tile: "side"   }, // +Z
  { dir: [ 0, 0,-1], u: [-1,0,  0], v: [0, 1, 0], light: FACE_LIGHT.z,    tile: "side"   }, // -Z
];

const AO_LEVELS = [0.5, 0.66, 0.82, 1.0];

function aoValue(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    // Parallel water-level field for the fluid simulation: 0 none, 1-8 flowing,
    // 9 = source. Only meaningful where data[idx] === WATER.
    this.water = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    // Packed per-voxel light: high nibble = skylight (0-15), low nibble = block
    // light (0-15). Filled by computeLight(); read by the mesher and World.
    this.light = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    this.dirty = true;
    this.meshes = null; // { opaque, foliage, water } THREE.Mesh
  }

  getW(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.water[Chunk.idx(x, y, z)];
  }

  setW(x, y, z, v) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.water[Chunk.idx(x, y, z)] = v;
  }

  static idx(x, y, z) {
    return x + CHUNK_SIZE * z + CHUNK_SIZE * CHUNK_SIZE * y;
  }

  getSky(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return (this.light[Chunk.idx(x, y, z)] >> 4) & 15;
  }

  getBlockL(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[Chunk.idx(x, y, z)] & 15;
  }

  setSky(x, y, z, v) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = Chunk.idx(x, y, z);
    this.light[i] = (this.light[i] & 0x0f) | ((v & 15) << 4);
  }

  setBlockL(x, y, z, v) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = Chunk.idx(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | (v & 15);
  }

  // Recompute skylight (high nibble) and block light (low nibble) for the whole
  // chunk. Seeds from open sky, emitter blocks (torches), AND the light of loaded
  // horizontal neighbours (one step of decay across the border) so light crosses
  // chunk seams. Both channels decay -1 per step and are blocked by opaque blocks;
  // skylight additionally falls straight down at full level (sunlight columns).
  // `world` resolves neighbour chunks; omit it for a chunk-local result.
  computeLight(world) {
    const L = this.light;
    L.fill(0);
    const S = CHUNK_SIZE;
    const data = this.data;
    const inBounds = (x, y, z) =>
      x >= 0 && x < S && z >= 0 && z < S && y >= 0 && y < WORLD_HEIGHT;
    const west = world && world.getChunk(this.cx - 1, this.cz);
    const east = world && world.getChunk(this.cx + 1, this.cz);
    const north = world && world.getChunk(this.cx, this.cz - 1);
    const south = world && world.getChunk(this.cx, this.cz + 1);

    // --- Skylight (high nibble) ---
    {
      const qx = [], qy = [], qz = [];
      const seed = (x, y, z, level) => {
        if (level <= 0) return;
        const i = Chunk.idx(x, y, z);
        if (isOpaque(data[i]) || ((L[i] >> 4) & 15) >= level) return;
        L[i] = (L[i] & 0x0f) | (level << 4);
        qx.push(x); qy.push(y); qz.push(z);
      };
      // Open-sky columns: full level down to the first opaque block.
      for (let z = 0; z < S; z++)
        for (let x = 0; x < S; x++)
          for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
            if (isOpaque(data[Chunk.idx(x, y, z)])) break;
            seed(x, y, z, 15);
          }
      // Incoming from loaded neighbours (one horizontal step of decay).
      for (let y = 0; y < WORLD_HEIGHT; y++)
        for (let i = 0; i < S; i++) {
          if (west) seed(0, y, i, west.getSky(S - 1, y, i) - 1);
          if (east) seed(S - 1, y, i, east.getSky(0, y, i) - 1);
          if (north) seed(i, y, 0, north.getSky(i, y, S - 1) - 1);
          if (south) seed(i, y, S - 1, south.getSky(i, y, 0) - 1);
        }
      for (let head = 0; head < qx.length; head++) {
        const x = qx[head], y = qy[head], z = qz[head];
        const s = (L[Chunk.idx(x, y, z)] >> 4) & 15;
        if (s <= 1) continue;
        const N = [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
                   [x, y + 1, z], [x, y - 1, z]];
        for (const [nx, ny, nz] of N) {
          if (!inBounds(nx, ny, nz)) continue;
          const ni = Chunk.idx(nx, ny, nz);
          if (isOpaque(data[ni])) continue;
          const nl = (ny === y - 1 && s === 15) ? 15 : s - 1; // sunlight column
          if (((L[ni] >> 4) & 15) < nl) {
            L[ni] = (L[ni] & 0x0f) | (nl << 4);
            qx.push(nx); qy.push(ny); qz.push(nz);
          }
        }
      }
    }

    // --- Block light (low nibble) ---
    {
      const qx = [], qy = [], qz = [];
      const seed = (x, y, z, level) => {
        if (level <= 0) return;
        const i = Chunk.idx(x, y, z);
        if (isOpaque(data[i]) || (L[i] & 15) >= level) return;
        L[i] = (L[i] & 0xf0) | level;
        qx.push(x); qy.push(y); qz.push(z);
      };
      // Emitter blocks.
      for (let y = 0; y < WORLD_HEIGHT; y++)
        for (let z = 0; z < S; z++)
          for (let x = 0; x < S; x++) {
            const e = BLOCKS[data[Chunk.idx(x, y, z)]]?.light || 0;
            if (e > 0) {
              const i = Chunk.idx(x, y, z);
              L[i] = (L[i] & 0xf0) | e;
              qx.push(x); qy.push(y); qz.push(z);
            }
          }
      // Incoming from loaded neighbours.
      for (let y = 0; y < WORLD_HEIGHT; y++)
        for (let i = 0; i < S; i++) {
          if (west) seed(0, y, i, west.getBlockL(S - 1, y, i) - 1);
          if (east) seed(S - 1, y, i, east.getBlockL(0, y, i) - 1);
          if (north) seed(i, y, 0, north.getBlockL(i, y, S - 1) - 1);
          if (south) seed(i, y, S - 1, south.getBlockL(i, y, 0) - 1);
        }
      for (let head = 0; head < qx.length; head++) {
        const x = qx[head], y = qy[head], z = qz[head];
        const b = L[Chunk.idx(x, y, z)] & 15;
        if (b <= 1) continue;
        const N = [[x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
                   [x, y + 1, z], [x, y - 1, z]];
        for (const [nx, ny, nz] of N) {
          if (!inBounds(nx, ny, nz)) continue;
          const ni = Chunk.idx(nx, ny, nz);
          if (isOpaque(data[ni])) continue;
          const nl = b - 1;
          if ((L[ni] & 15) < nl) {
            L[ni] = (L[ni] & 0xf0) | nl;
            qx.push(nx); qy.push(ny); qz.push(nz);
          }
        }
      }
    }
  }

  get(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    return this.data[Chunk.idx(x, y, z)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[Chunk.idx(x, y, z)] = id;
  }

  // Build BufferGeometries for this chunk. `world` resolves neighbour blocks
  // (including across chunk borders). Returns { opaque, foliage, water }.
  buildGeometry(world) {
    const buffers = {
      opaque: newBuffer(),
      foliage: newBuffer(),
      water: newBuffer(),
    };
    const ox = this.cx * CHUNK_SIZE;
    const oz = this.cz * CHUNK_SIZE;

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this.data[Chunk.idx(x, y, z)];
          if (id === AIR) continue;
          const def = BLOCKS[id];
          const wx = ox + x, wy = y, wz = oz + z;

          // Cross-shaped plants are billboards, not cubes.
          if (def.render === "cross") {
            this.emitCross(buffers.foliage, world, wx, wy, wz, def);
            continue;
          }

          // Water is meshed with level-based heights (tapered flow / surface dip).
          if (def.liquid) {
            this.emitWaterCell(buffers.water, world, wx, wy, wz);
            continue;
          }

          const target = def.liquid ? buffers.water
            : def.transparent ? buffers.foliage
            : buffers.opaque;

          for (const face of FACES) {
            const nx = wx + face.dir[0];
            const ny = wy + face.dir[1];
            const nz = wz + face.dir[2];
            const neighbor = world.getBlock(nx, ny, nz);

            // Culling: skip faces hidden by an opaque neighbour, and internal
            // faces between two of the same transparent block (glass/water/leaves).
            if (isOpaque(neighbor)) continue;
            if (neighbor === id && def.transparent) continue;
            // Water only shows its top surface against air, not its sides under
            // other water handled above; skip side faces buried in terrain edge.

            this.emitFace(target, world, wx, wy, wz, face, def);
          }
        }
      }
    }

    return {
      opaque: finalizeBuffer(buffers.opaque),
      foliage: finalizeBuffer(buffers.foliage),
      water: finalizeBuffer(buffers.water),
    };
  }

  emitFace(buf, world, wx, wy, wz, face, def) {
    const [dx, dy, dz] = face.dir;
    const u = face.u, v = face.v;
    const tile = def.faces[face.tile];
    const [u0, v0, u1, v1] = world.atlas.uv(tile);
    const light = face.light;
    // Light of the cell this face opens into (always non-opaque). Smooth lighting
    // averages it with the per-corner neighbours below, so it's gathered there.
    const fSky = world.getSkyLight(wx + dx, wy + dy, wz + dz);
    const fBlock = world.getBlockLight(wx + dx, wy + dy, wz + dz);

    // Face plane centre = block centre + 0.5 along normal.
    const cx = wx + 0.5 + dx * 0.5;
    const cy = wy + 0.5 + dy * 0.5;
    const cz = wz + 0.5 + dz * 0.5;

    // 4 corners in (su, sv) ∈ {(-1,-1),(1,-1),(1,1),(-1,1)} — CCW from outside.
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const uvCoords = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

    const positions = [];
    const ao = [];
    const skyV = [], blockV = [];
    for (let i = 0; i < 4; i++) {
      const [su, sv] = signs[i];
      positions.push([
        cx + 0.5 * su * u[0] + 0.5 * sv * v[0],
        cy + 0.5 * su * u[1] + 0.5 * sv * v[1],
        cz + 0.5 * su * u[2] + 0.5 * sv * v[2],
      ]);
      // The three neighbours sharing this corner in the layer in front of the
      // face (edge1, edge2, diagonal) — reused for both AO and smooth lighting.
      const e1x = wx + dx + su * u[0], e1y = wy + dy + su * u[1], e1z = wz + dz + su * u[2];
      const e2x = wx + dx + sv * v[0], e2y = wy + dy + sv * v[1], e2z = wz + dz + sv * v[2];
      const ccx = wx + dx + su * u[0] + sv * v[0],
            ccy = wy + dy + su * u[1] + sv * v[1],
            ccz = wz + dz + su * u[2] + sv * v[2];
      const s1 = isOpaque(world.getBlock(e1x, e1y, e1z));
      const s2 = isOpaque(world.getBlock(e2x, e2y, e2z));
      const cnr = isOpaque(world.getBlock(ccx, ccy, ccz));
      ao.push(aoValue(s1 ? 1 : 0, s2 ? 1 : 0, cnr ? 1 : 0));

      // Smooth lighting, Minecraft-style: average the face cell with its three
      // corner neighbours over a FIXED divisor of 4, counting solid/hidden cells
      // as light 0. That zero-contribution is what darkens concave corners — i.e.
      // the ambient-occlusion effect lives in the light average itself (so there's
      // no separate AO multiply below). Convex edges and flat faces keep full
      // light, so inside corners no longer flare bright.
      const occluded = cnr || (s1 && s2);
      const eS1 = s1 ? 0 : world.getSkyLight(e1x, e1y, e1z);
      const eS2 = s2 ? 0 : world.getSkyLight(e2x, e2y, e2z);
      const cS = occluded ? 0 : world.getSkyLight(ccx, ccy, ccz);
      skyV.push((fSky + eS1 + eS2 + cS) / 4 / 15);
      const eB1 = s1 ? 0 : world.getBlockLight(e1x, e1y, e1z);
      const eB2 = s2 ? 0 : world.getBlockLight(e2x, e2y, e2z);
      const cB = occluded ? 0 : world.getBlockLight(ccx, ccy, ccz);
      blockV.push((fBlock + eB1 + eB2 + cB) / 4 / 15);
    }

    const baseIndex = buf.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      buf.positions.push(positions[i][0], positions[i][1], positions[i][2]);
      buf.normals.push(dx, dy, dz);
      buf.uvs.push(uvCoords[i][0], uvCoords[i][1]);
      // r = directional face shading only (AO now lives in the smoothed light),
      // g = skylight, b = block light (both smoothed per vertex).
      buf.colors.push(light, skyV[i], blockV[i]);
    }

    // Split the quad along the diagonal that runs THROUGH the darker pair of
    // corners, so a lone dark (concave-corner) vertex spreads into a smooth
    // shadow instead of being trapped in one triangle as a hard-edged wedge.
    // This is the standard AO-anisotropy rule (0fps): flip to the 1–3 diagonal
    // when the 0–2 diagonal is the brighter one. (The branches were previously
    // inverted, which is what produced the triangular corner shadows.)
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      buf.indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3,
                       baseIndex + 1, baseIndex + 3, baseIndex);
    } else {
      buf.indices.push(baseIndex, baseIndex + 1, baseIndex + 2,
                       baseIndex, baseIndex + 2, baseIndex + 3);
    }
  }

  // Emit two diagonal billboard quads forming an "X" (grass tufts, flowers).
  emitCross(buf, world, wx, wy, wz, def) {
    const tile = def.faces.side;
    const [u0, v0, u1, v1] = world.atlas.uv(tile);
    const b = 0.95; // plants render near full-bright
    const sky = world.getSkyLight(wx, wy, wz) / 15; // plant sits in its own cell
    const block = world.getBlockLight(wx, wy, wz) / 15; // torches light their own cell
    const a = 0.146, c = 0.854; // inset so the X fits inside the cell

    const quads = [
      [[a, 0, a], [c, 0, c], [c, 1, c], [a, 1, a]],
      [[a, 0, c], [c, 0, a], [c, 1, a], [a, 1, c]],
    ];
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

    for (const q of quads) {
      const base = buf.positions.length / 3;
      for (let i = 0; i < 4; i++) {
        buf.positions.push(wx + q[i][0], wy + q[i][1], wz + q[i][2]);
        buf.normals.push(0, 1, 0);
        buf.uvs.push(uvs[i][0], uvs[i][1]);
        buf.colors.push(b, sky, block);
      }
      buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  pushQuad(buf, verts, uv, light) {
    const base = buf.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      buf.positions.push(verts[i][0], verts[i][1], verts[i][2]);
      buf.normals.push(0, 1, 0);
      buf.uvs.push(uv[i][0], uv[i][1]);
      buf.colors.push(light, light, light);
    }
    buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Mesh a water cell using its surface height. Interior (submerged) cells
  // emit nothing; the surface dips slightly and flowing water tapers, with
  // small "step" faces where neighbouring water is shallower.
  emitWaterCell(buf, world, wx, wy, wz) {
    const W = BLOCK.WATER;
    const lvl = world.getWaterLevel(wx, wy, wz);
    // Only an *air* gap above makes a visible, lowered surface. Water or solid
    // (an underwater ceiling/overhang) above means the cell is full height.
    const openTop = world.getBlock(wx, wy + 1, wz) === AIR;
    const sh = openTop ? surfaceHeight(lvl) : 1.0;
    const [u0, v0, u1, v1] = world.atlas.uv("water");
    const UV = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

    // Top surface only where open to air above.
    if (openTop) {
      const y = wy + sh;
      this.pushQuad(buf, [[wx, y, wz], [wx + 1, y, wz], [wx + 1, y, wz + 1], [wx, y, wz + 1]],
        UV, WATER_LIGHT.top);
    }

    // Bottom (rare — only over open air).
    const belowId = world.getBlock(wx, wy - 1, wz);
    if (!isOpaque(belowId) && belowId !== W) {
      this.pushQuad(buf, [[wx, wy, wz + 1], [wx + 1, wy, wz + 1], [wx + 1, wy, wz], [wx, wy, wz]],
        UV, WATER_LIGHT.bottom);
    }

    // Sides.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const nb = world.getBlock(wx + dx, wy, wz + dz);
      if (isOpaque(nb)) continue;
      let by = 0;
      if (nb === W) {
        const nOpen = world.getBlock(wx + dx, wy + 1, wz + dz) === AIR;
        const nsh = nOpen ? surfaceHeight(world.getWaterLevel(wx + dx, wy, wz + dz)) : 1.0;
        if (sh - nsh <= 1e-4) continue;  // neighbour same height or taller -> hidden
        by = nsh;                         // draw only the exposed step
      }
      let x0, z0, x1, z1;
      if (dx === 1) { x0 = wx + 1; z0 = wz; x1 = wx + 1; z1 = wz + 1; }
      else if (dx === -1) { x0 = wx; z0 = wz + 1; x1 = wx; z1 = wz; }
      else if (dz === 1) { x0 = wx + 1; z0 = wz + 1; x1 = wx; z1 = wz + 1; }
      else { x0 = wx; z0 = wz; x1 = wx + 1; z1 = wz; }
      const yb = wy + by, yt = wy + sh;
      this.pushQuad(buf, [[x0, yb, z0], [x1, yb, z1], [x1, yt, z1], [x0, yt, z0]],
        UV, WATER_LIGHT.side);
    }
  }

  dispose() {
    if (!this.meshes) return;
    for (const key of ["opaque", "foliage", "water"]) {
      const m = this.meshes[key];
      if (m) m.geometry.dispose();
    }
    this.meshes = null;
  }
}

function newBuffer() {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function finalizeBuffer(buf) {
  if (buf.indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(buf.normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uvs, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
  g.setIndex(buf.indices);
  return g;
}
