// A chunk is a CHUNK_SIZE × WORLD_HEIGHT × CHUNK_SIZE column of voxels — the
// headless storage (block ids, water level, packed light, metadata) plus the
// two-phase light BFS. It has no Three.js/DOM deps so it runs in Node (server).
// Turning voxels into geometry lives in mesher.js (the render side).
import { AIR, BLOCKS, isOpaque } from "./blocks.js";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 112;
export const WATER_LEVEL = 26;

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
    // Per-voxel metadata (block state: e.g. stair facing). 0 for most blocks.
    this.meta = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
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

  getMeta(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.meta[Chunk.idx(x, y, z)];
  }

  setMeta(x, y, z, m) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.meta[Chunk.idx(x, y, z)] = m;
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

  dispose() {
    if (!this.meshes) return;
    for (const key of ["opaque", "foliage", "water"]) {
      const m = this.meshes[key];
      if (m) m.geometry.dispose();
    }
    this.meshes = null;
  }
}
