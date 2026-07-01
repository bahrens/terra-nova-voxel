// Amanatides & Woo voxel DDA traversal — extracted from Player so any system
// (targeting, entities, tools) can ray-walk the grid. Walks from `origin` along
// `dir` up to `reach` blocks and returns the first hit voxel
// `{ x, y, z, normal: {x,y,z}, block }`, or null. `getBlock(x,y,z)` and the
// `isHit(blockId)` predicate keep it world- and purpose-agnostic.
//
// Full cubes hit on the DDA entry face. Shaped blocks (slabs, …) are tested
// sub-voxel against their actual boxes, so the ray passes through their empty
// space and the returned normal matches the box face — correct targeting/placing.
import { isSolid, BLOCKS } from "./blocks.js";

export function raycastVoxels(getBlock, origin, dir, reach, isHit = isSolid) {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  const boundary = (s, o, c) => s > 0 ? (c + 1 - o) : (o - c);
  let tMaxX = dx !== 0 ? boundary(stepX, ox, x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? boundary(stepY, oy, y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? boundary(stepZ, oz, z) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= reach) {
    const block = getBlock(x, y, z);
    if (isHit(block)) {
      const shape = BLOCKS[block]?.shape;
      if (!shape) return { x, y, z, normal: { x: nx, y: ny, z: nz }, block };
      // Sub-voxel: only a hit if the ray actually crosses one of the boxes.
      const h = rayShape(ox, oy, oz, dx, dy, dz, x, y, z, shape, reach);
      if (h) return { x, y, z, normal: h.normal, block };
      // else fall through and keep stepping past this voxel
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

// Nearest entry of the ray into any of a shaped block's boxes (world = voxel+box).
function rayShape(ox, oy, oz, dx, dy, dz, vx, vy, vz, shape, reach) {
  let best = null;
  for (const b of shape) {
    const h = rayBox(ox, oy, oz, dx, dy, dz, vx + b[0], vy + b[1], vz + b[2], vx + b[3], vy + b[4], vz + b[5]);
    if (h && h.t >= 0 && h.t <= reach && (!best || h.t < best.t)) best = h;
  }
  return best;
}

// Ray vs AABB (slab method). Returns { t, normal } of the entry face, or null.
function rayBox(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz) {
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [minx, miny, minz], mx = [maxx, maxy, maxz];
  let tmin = -Infinity, tmax = Infinity, hitAxis = -1, hitSign = 0;
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null; // parallel and outside the slab
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (mn[a] - o[a]) * inv;
    let t2 = (mx[a] - o[a]) * inv;
    let s = -1; // entering through the min face → outward normal is -axis
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; } // entering the max face → +axis
    if (t1 > tmin) { tmin = t1; hitAxis = a; hitSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null; // box entirely behind the ray
  const normal = { x: 0, y: 0, z: 0 };
  if (hitAxis === 0) normal.x = hitSign;
  else if (hitAxis === 1) normal.y = hitSign;
  else normal.z = hitSign;
  return { t: tmin, normal };
}
