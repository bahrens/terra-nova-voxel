// Entities: anything that lives in the world and moves under its own update —
// dropped items now, mobs/projectiles later. The base class owns AABB voxel
// physics (gravity + axis-separated collision, mirroring the player) so concrete
// entity types only add behaviour. EntityManager owns the list, ticks them, and
// adds/removes their meshes from the scene.
import * as THREE from "three";
import { isSolid, BLOCKS } from "./blocks.js";

const GRAVITY = 28;

export class Entity {
  constructor(world, x, y, z, halfWidth = 0.15, height = 0.3) {
    this.world = world;
    this.position = new THREE.Vector3(x, y, z); // feet (AABB min in y)
    this.velocity = new THREE.Vector3();
    this.hw = halfWidth;
    this.h = height;
    this.onGround = false;
    this.dead = false;
    this.mesh = null;
  }

  // Gravity + substepped, axis-separated voxel collision (same scheme as Player).
  stepPhysics(dt) {
    dt = Math.min(dt, 0.05);
    this.velocity.y -= GRAVITY * dt;
    const dx = this.velocity.x * dt, dy = this.velocity.y * dt, dz = this.velocity.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.15));
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis("x", sx);
      this.moveAxis("z", sz);
      this.moveAxis("y", sy);
    }
    if (this.onGround) { this.velocity.x *= 0.6; this.velocity.z *= 0.6; } // ground friction
  }

  moveAxis(comp, amount) {
    if (amount === 0) return;
    this.position[comp] += amount;
    if (this.intersects()) {
      this.position[comp] -= amount;
      if (comp === "y") { if (amount < 0) this.onGround = true; this.velocity.y = 0; }
      else this.velocity[comp] = 0;
    }
  }

  intersects() {
    const { x, y, z } = this.position;
    const minX = Math.floor(x - this.hw), maxX = Math.floor(x + this.hw);
    const minY = Math.floor(y), maxY = Math.floor(y + this.h - 1e-4);
    const minZ = Math.floor(z - this.hw), maxZ = Math.floor(z + this.hw);
    for (let by = minY; by <= maxY; by++)
      for (let bz = minZ; bz <= maxZ; bz++)
        for (let bx = minX; bx <= maxX; bx++)
          if (isSolid(this.world.getBlock(bx, by, bz))) return true;
    return false;
  }

  update(dt, ctx) { this.stepPhysics(dt); }

  dispose(scene) { if (this.mesh) scene.remove(this.mesh); }
}

// Small textured cube geometries, one per block id, with the block's side tile
// mapped onto every face. Cached and shared across all drops of that block.
const itemGeoCache = new Map();
function itemGeometry(atlas, blockId) {
  let g = itemGeoCache.get(blockId);
  if (g) return g;
  const def = BLOCKS[blockId];
  const [u0, v0, u1, v1] = atlas.uv(def.faces.side);
  g = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const uv = g.attributes.uv; // every face uses unit-square uvs -> remap to the tile
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  itemGeoCache.set(blockId, g);
  return g;
}

// A dropped block: pops out, falls, settles with a bob/spin, then is vacuumed to
// the player when near. Despawns after `ttl` seconds as a safety.
export class ItemEntity extends Entity {
  constructor(world, x, y, z, blockId, atlas, material) {
    super(world, x, y, z, 0.13, 0.26);
    this.blockId = blockId;
    this.age = 0;
    this.ttl = 300;
    this.homing = false;
    this.phase = (x * 12.9898 + z * 78.233) % (Math.PI * 2); // deterministic-ish offset
    this.velocity.set((world ? 0 : 0), 0, 0);
    // Pop out with a little random scatter + upward kick.
    const a = this.phase;
    this.velocity.set(Math.cos(a) * 1.6, 3.2, Math.sin(a) * 1.6);
    this.mesh = new THREE.Mesh(itemGeometry(atlas, blockId), material);
  }

  update(dt, ctx) {
    this.age += dt;
    const player = ctx.player;
    if (this.homing) {
      const tx = player.position.x, ty = player.position.y + 0.6, tz = player.position.z;
      const k = Math.min(1, dt * 12);
      this.position.x += (tx - this.position.x) * k;
      this.position.y += (ty - this.position.y) * k;
      this.position.z += (tz - this.position.z) * k;
      const dx = tx - this.position.x, dy = ty - this.position.y, dz = tz - this.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.16) this.dead = true; // collected
    } else {
      this.stepPhysics(dt);
      if (player && this.age > 0.6) {
        const dx = player.position.x - this.position.x;
        const dy = player.position.y + 0.9 - this.position.y;
        const dz = player.position.z - this.position.z;
        if (dx * dx + dy * dy + dz * dz < 2.25) this.homing = true; // within ~1.5 blocks
      }
      if (this.age > this.ttl) this.dead = true;
    }
    // Render: hover slightly, bob, and spin.
    const t = ctx.time;
    this.mesh.position.set(
      this.position.x,
      this.position.y + 0.18 + Math.sin(t * 2 + this.phase) * 0.05,
      this.position.z);
    this.mesh.rotation.y = t * 1.5 + this.phase;
  }
}

export class EntityManager {
  constructor(scene, world, atlas) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.list = [];
    this.time = 0;
    // Unlit cutout material so plant/leaf tiles keep their transparency.
    this.itemMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.3 });
  }

  spawnItem(x, y, z, blockId) {
    if (!BLOCKS[blockId]) return null;
    const e = new ItemEntity(this.world, x, y, z, blockId, this.atlas, this.itemMaterial);
    this.scene.add(e.mesh);
    this.list.push(e);
    return e;
  }

  update(dt, player) {
    this.time += dt;
    const ctx = { player, time: this.time };
    for (const e of this.list) e.update(dt, ctx);
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].dead) { this.list[i].dispose(this.scene); this.list.splice(i, 1); }
    }
  }
}
