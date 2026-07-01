// Amanatides & Woo voxel DDA traversal — extracted from Player so any system
// (targeting, entities, tools) can ray-walk the grid. Walks from `origin` along
// `dir` up to `reach` blocks and returns the first hit voxel
// `{ x, y, z, normal: {x,y,z}, block }`, or null. `getBlock(x,y,z)` and the
// `isHit(blockId)` predicate keep it world- and purpose-agnostic.
import { isSolid } from "./blocks.js";

export function raycastVoxels(getBlock, origin, dir, reach, isHit = isSolid) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const boundary = (s, o, c) => s > 0 ? (c + 1 - o) : (o - c);
  let tMaxX = dir.x !== 0 ? boundary(stepX, origin.x, x) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? boundary(stepY, origin.y, y) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? boundary(stepZ, origin.z, z) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= reach) {
    const block = getBlock(x, y, z);
    if (isHit(block)) return { x, y, z, normal: { x: nx, y: ny, z: nz }, block };
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
