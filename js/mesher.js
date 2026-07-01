// Chunk mesher (client / render side). Reads a chunk's voxel data + light + meta
// (and neighbour blocks via the world) and builds the opaque / foliage / water
// BufferGeometries. Culls hidden faces, bakes directional light + AO into vertex
// colours, and handles cross-quads, non-cube shapes, and level-based water.
//
// This is the render half split out of the (headless) chunk storage: it's the
// only place chunk voxels turn into Three.js geometry.
import * as THREE from "three";
import { AIR, BLOCK, BLOCKS, isOpaque, shapeFor } from "./blocks.js";
import { Chunk, CHUNK_SIZE, WORLD_HEIGHT } from "./chunk.js";

// Rendered top height of an *open* (air above) water cell: a surface source sits
// slightly below the block top; flowing water tapers with its level. Cells capped
// by water or solid above always render full height (1.0).
function surfaceHeight(level) {
  if (level >= 9) return 0.875;              // source
  return Math.max(0.12, (level / 8) * 0.85); // flowing 1-8
}

// Water is shaded almost uniformly so vertical faces read as water, not dark walls.
const WATER_LIGHT = { top: 1.0, side: 0.94, bottom: 0.88 };

// Face base brightness (fake directional light).
const FACE_LIGHT = { top: 1.0, bottom: 0.55, x: 0.68, z: 0.82 };

// 6 face directions with tangent axes chosen so u × v = normal (correct winding).
const FACES = [
  { dir: [ 1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], light: FACE_LIGHT.x,     tile: "side"   }, // +X
  { dir: [-1, 0, 0], u: [0, 0,  1], v: [0, 1, 0], light: FACE_LIGHT.x,     tile: "side"   }, // -X
  { dir: [ 0, 1, 0], u: [0, 0,  1], v: [1, 0, 0], light: FACE_LIGHT.top,   tile: "top"    }, // +Y
  { dir: [ 0,-1, 0], u: [1, 0,  0], v: [0, 0, 1], light: FACE_LIGHT.bottom, tile: "bottom"}, // -Y
  { dir: [ 0, 0, 1], u: [1, 0,  0], v: [0, 1, 0], light: FACE_LIGHT.z,     tile: "side"   }, // +Z
  { dir: [ 0, 0,-1], u: [-1,0,  0], v: [0, 1, 0], light: FACE_LIGHT.z,     tile: "side"   }, // -Z
];

const AO_LEVELS = [0.5, 0.66, 0.82, 1.0];

// Reusable snapshot scratch for meshing: the chunk + a 1-block border, so the
// mesher reads blocks/light/water by array index instead of cross-chunk Map
// lookups. Meshing is synchronous (one chunk at a time) so a shared buffer is
// safe — every cell is rewritten each build. Sized (SIZE+2)² × height.
const SNAP_PX = CHUNK_SIZE + 2;
const SNAP_N = SNAP_PX * SNAP_PX * WORLD_HEIGHT;
const _snapB = new Uint8Array(SNAP_N);   // block ids
const _snapLs = new Uint8Array(SNAP_N);  // skylight
const _snapLb = new Uint8Array(SNAP_N);  // block light
const _snapW = new Uint8Array(SNAP_N);   // water level
const _snapM = new Uint8Array(SNAP_N);   // metadata (block state)
const snapIdx = (lx, y, lz) => (lx + 1) + SNAP_PX * (lz + 1) + SNAP_PX * SNAP_PX * y;

function aoValue(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

// Build BufferGeometries for a chunk. `world` resolves neighbour blocks (including
// across chunk borders). Returns { opaque, foliage, water } (each null if empty).
export function meshChunk(chunk, world, atlas) {
  const S = CHUNK_SIZE, H = WORLD_HEIGHT;
  const ox = chunk.cx * S, oz = chunk.cz * S;

  // --- Snapshot the chunk + 1-block border into flat scratch arrays. The interior
  // is copied straight from this chunk's buffers; only the border ring touches
  // neighbour chunks via the world. ---
  for (let y = 0; y < H; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const ci = Chunk.idx(x, y, z), pi = snapIdx(x, y, z);
        _snapB[pi] = chunk.data[ci];
        const l = chunk.light[ci]; _snapLs[pi] = (l >> 4) & 15; _snapLb[pi] = l & 15;
        _snapW[pi] = chunk.water[ci];
        _snapM[pi] = chunk.meta[ci];
      }
  const fillBorder = (lx, lz) => {
    const wx = ox + lx, wz = oz + lz;
    for (let y = 0; y < H; y++) {
      const pi = snapIdx(lx, y, lz);
      _snapB[pi] = world.getBlock(wx, y, wz);
      _snapLs[pi] = world.getSkyLight(wx, y, wz);
      _snapLb[pi] = world.getBlockLight(wx, y, wz);
      _snapW[pi] = world.getWaterLevel(wx, y, wz);
      _snapM[pi] = world.getMeta(wx, y, wz);
    }
  };
  for (let z = -1; z <= S; z++) { fillBorder(-1, z); fillBorder(S, z); }
  for (let x = 0; x < S; x++) { fillBorder(x, -1); fillBorder(x, S); }

  // A `world`-shaped view over the snapshot; the emit helpers use it unchanged.
  const sample = (arr, wx, wy, wz, def) => {
    if (wy < 0 || wy >= H) return def;
    const lx = wx - ox, lz = wz - oz;
    if (lx < -1 || lx > S || lz < -1 || lz > S) return def;
    return arr[snapIdx(lx, wy, lz)];
  };
  const view = {
    atlas,
    getBlock: (wx, wy, wz) => sample(_snapB, wx, wy, wz, AIR),
    getSkyLight: (wx, wy, wz) => (wy >= H ? 15 : sample(_snapLs, wx, wy, wz, 0)),
    getBlockLight: (wx, wy, wz) => sample(_snapLb, wx, wy, wz, 0),
    getWaterLevel: (wx, wy, wz) => sample(_snapW, wx, wy, wz, 0),
    getMeta: (wx, wy, wz) => sample(_snapM, wx, wy, wz, 0),
  };

  const buffers = { opaque: newBuffer(), foliage: newBuffer(), water: newBuffer() };
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const id = _snapB[snapIdx(x, y, z)];
        if (id === AIR) continue;
        const def = BLOCKS[id];
        const wx = ox + x, wy = y, wz = oz + z;

        // Cross-shaped plants are billboards, not cubes.
        if (def.render === "cross") { emitCross(buffers.foliage, view, wx, wy, wz, def); continue; }
        // Water is meshed with level-based heights (tapered flow / surface dip).
        if (def.liquid) { emitWaterCell(buffers.water, view, wx, wy, wz); continue; }

        const target = def.transparent ? buffers.foliage : buffers.opaque;
        // Non-cube shapes (slabs, stairs, …) mesh their sub-boxes; the shape is
        // selected/rotated by the voxel's metadata.
        if (def.shape) {
          emitShape(target, view, wx, wy, wz, def, id, shapeFor(id, view.getMeta(wx, wy, wz)));
          continue;
        }
        for (const face of FACES) {
          const neighbor = view.getBlock(wx + face.dir[0], wy + face.dir[1], wz + face.dir[2]);
          // Cull faces hidden by an opaque neighbour, and internal faces between
          // two of the same transparent block (glass/water/leaves).
          if (isOpaque(neighbor)) continue;
          if (neighbor === id && def.transparent) continue;
          emitFace(target, view, wx, wy, wz, face, def);
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

function emitFace(buf, world, wx, wy, wz, face, def) {
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
    // The three neighbours sharing this corner in the layer in front of the face
    // (edge1, edge2, diagonal) — reused for both AO and smooth lighting.
    const e1x = wx + dx + su * u[0], e1y = wy + dy + su * u[1], e1z = wz + dz + su * u[2];
    const e2x = wx + dx + sv * v[0], e2y = wy + dy + sv * v[1], e2z = wz + dz + sv * v[2];
    const ccx = wx + dx + su * u[0] + sv * v[0],
          ccy = wy + dy + su * u[1] + sv * v[1],
          ccz = wz + dz + su * u[2] + sv * v[2];
    const s1 = isOpaque(world.getBlock(e1x, e1y, e1z));
    const s2 = isOpaque(world.getBlock(e2x, e2y, e2z));
    const cnr = isOpaque(world.getBlock(ccx, ccy, ccz));
    ao.push(aoValue(s1 ? 1 : 0, s2 ? 1 : 0, cnr ? 1 : 0));

    // Smooth lighting: average the face cell with its three corner neighbours over
    // a fixed divisor of 4. Solid/hidden cells fall back to the FACE cell's light
    // (not 0) so the value tracks the real propagated light without baking in any
    // darkening — AO is applied separately below (r channel), AFTER the curve.
    const occluded = cnr || (s1 && s2);
    const eS1 = s1 ? fSky : world.getSkyLight(e1x, e1y, e1z);
    const eS2 = s2 ? fSky : world.getSkyLight(e2x, e2y, e2z);
    const cS = occluded ? fSky : world.getSkyLight(ccx, ccy, ccz);
    skyV.push((fSky + eS1 + eS2 + cS) / 4 / 15);
    const eB1 = s1 ? fBlock : world.getBlockLight(e1x, e1y, e1z);
    const eB2 = s2 ? fBlock : world.getBlockLight(e2x, e2y, e2z);
    const cB = occluded ? fBlock : world.getBlockLight(ccx, ccy, ccz);
    blockV.push((fBlock + eB1 + eB2 + cB) / 4 / 15);
  }

  const baseIndex = buf.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    buf.positions.push(positions[i][0], positions[i][1], positions[i][2]);
    buf.normals.push(dx, dy, dz);
    buf.uvs.push(uvCoords[i][0], uvCoords[i][1]);
    // r = directional face shading × gentle ambient occlusion (0.5–1.0), multiplied
    // onto the curved light in the shader so AO stays a mild corner dim.
    buf.colors.push(light * AO_LEVELS[ao[i]], skyV[i], blockV[i]);
  }

  // Split the quad along the diagonal through the darker pair of corners, so a lone
  // dark (concave-corner) vertex spreads into a smooth shadow instead of a wedge.
  if (ao[0] + ao[2] > ao[1] + ao[3]) {
    buf.indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 3,
                     baseIndex + 1, baseIndex + 3, baseIndex);
  } else {
    buf.indices.push(baseIndex, baseIndex + 1, baseIndex + 2,
                     baseIndex, baseIndex + 2, baseIndex + 3);
  }
}

// Non-cube shapes (slabs, stairs, fences): emit each sub-box's faces. `shape` is
// the voxel's meta-resolved boxes.
function emitShape(buf, world, wx, wy, wz, def, id, shape) {
  for (const box of shape)
    for (const face of FACES) emitBoxFace(buf, world, wx, wy, wz, face, def, box, id);
}

// One face of a sub-box. Flat-lit (no smooth-lighting/AO — that stays on the
// full-cube path); full-tile UVs. A face flush with the voxel edge culls against
// an opaque or same-block neighbour; interior faces (e.g. a slab's top) emit.
function emitBoxFace(buf, world, wx, wy, wz, face, def, box, id) {
  const [dx, dy, dz] = face.dir;
  const a = dx !== 0 ? 0 : (dy !== 0 ? 1 : 2); // normal axis
  const pos = dx + dy + dz > 0;                // facing the +axis side?
  const boundary = pos ? box[a + 3] === 1 : box[a] === 0;
  if (boundary) {
    const nb = world.getBlock(wx + dx, wy + dy, wz + dz);
    // Hidden by an opaque neighbour, or by an identical block+state (culls the
    // z-fighting seam between two identical slabs/stairs without hiding the faces
    // of a differently-oriented same-block neighbour).
    const same = nb === id && world.getMeta(wx + dx, wy + dy, wz + dz) === world.getMeta(wx, wy, wz);
    if (isOpaque(nb) || same) return;
  }
  const u = face.u, v = face.v;
  const uAxis = u[0] ? 0 : (u[1] ? 1 : 2);
  const vAxis = v[0] ? 0 : (v[1] ? 1 : 2);
  const na = pos ? box[a + 3] : box[a];
  const cU = (box[uAxis] + box[uAxis + 3]) / 2, hU = (box[uAxis + 3] - box[uAxis]) / 2;
  const cV = (box[vAxis] + box[vAxis + 3]) / 2, hV = (box[vAxis + 3] - box[vAxis]) / 2;
  const C = [0, 0, 0]; C[a] = na; C[uAxis] = cU; C[vAxis] = cV;

  // Flat light of the cell the face opens into: neighbour for edge faces, the
  // block's own (non-opaque) voxel for interior faces like a slab top.
  const lx = boundary ? wx + dx : wx, ly = boundary ? wy + dy : wy, lz = boundary ? wz + dz : wz;
  const sky = world.getSkyLight(lx, ly, lz) / 15;
  const blk = world.getBlockLight(lx, ly, lz) / 15;
  const shade = face.light;

  const [u0, v0, u1, v1] = world.atlas.uv(def.faces[face.tile]);
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const uvC = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const base = buf.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    const su = signs[i][0], sv = signs[i][1];
    buf.positions.push(
      wx + C[0] + su * hU * u[0] + sv * hV * v[0],
      wy + C[1] + su * hU * u[1] + sv * hV * v[1],
      wz + C[2] + su * hU * u[2] + sv * hV * v[2],
    );
    buf.normals.push(dx, dy, dz);
    buf.uvs.push(uvC[i][0], uvC[i][1]);
    buf.colors.push(shade, sky, blk); // flat, no AO
  }
  buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Emit two diagonal billboard quads forming an "X" (grass tufts, flowers).
function emitCross(buf, world, wx, wy, wz, def) {
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

function pushQuad(buf, verts, uv, light) {
  const base = buf.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    buf.positions.push(verts[i][0], verts[i][1], verts[i][2]);
    buf.normals.push(0, 1, 0);
    buf.uvs.push(uv[i][0], uv[i][1]);
    buf.colors.push(light, light, light);
  }
  buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Mesh a water cell using its surface height. Interior (submerged) cells emit
// nothing; the surface dips slightly and flowing water tapers, with small "step"
// faces where neighbouring water is shallower.
function emitWaterCell(buf, world, wx, wy, wz) {
  const W = BLOCK.WATER;
  const lvl = world.getWaterLevel(wx, wy, wz);
  // Only an *air* gap above makes a visible, lowered surface. Water or solid above
  // (an underwater ceiling/overhang) means the cell is full height.
  const openTop = world.getBlock(wx, wy + 1, wz) === AIR;
  const sh = openTop ? surfaceHeight(lvl) : 1.0;
  const [u0, v0, u1, v1] = world.atlas.uv("water");
  const UV = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

  // Top surface only where open to air above.
  if (openTop) {
    const y = wy + sh;
    pushQuad(buf, [[wx, y, wz], [wx + 1, y, wz], [wx + 1, y, wz + 1], [wx, y, wz + 1]],
      UV, WATER_LIGHT.top);
  }

  // Bottom (rare — only over open air).
  const belowId = world.getBlock(wx, wy - 1, wz);
  if (!isOpaque(belowId) && belowId !== W) {
    pushQuad(buf, [[wx, wy, wz + 1], [wx + 1, wy, wz + 1], [wx + 1, wy, wz], [wx, wy, wz]],
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
    pushQuad(buf, [[x0, yb, z0], [x1, yb, z1], [x1, yt, z1], [x0, yt, z0]],
      UV, WATER_LIGHT.side);
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
