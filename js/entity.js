// Entities: anything that lives in the world and moves under its own update —
// dropped items now, mobs/projectiles later. The base class owns AABB voxel
// physics (gravity + axis-separated collision, mirroring the player) so concrete
// entity types only add behaviour. EntityManager owns the list, ticks them, and
// adds/removes their meshes from the scene.
import * as THREE from "three";
import { isSolid, BLOCKS } from "./blocks.js";
import { WORLD_HEIGHT, WATER_LEVEL } from "./chunk.js";

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

// A blocky quadruped "critter": body + head + four swinging legs, built from
// shared geometries/materials (one Group per mob so each animates independently).
let critterParts = null;
function critterFactory() {
  if (critterParts) return critterParts;
  const legGeo = new THREE.BoxGeometry(0.16, 0.4, 0.16);
  legGeo.translate(0, -0.2, 0); // move origin to the hip so legs swing from the top
  critterParts = {
    bodyGeo: new THREE.BoxGeometry(0.5, 0.5, 0.95),
    headGeo: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    legGeo,
    bodyMat: new THREE.MeshBasicMaterial({ color: 0xb6906a }),
    headMat: new THREE.MeshBasicMaterial({ color: 0xc8a578 }),
    legMat: new THREE.MeshBasicMaterial({ color: 0x6e5a3c }),
  };
  return critterParts;
}
function buildCritter() {
  const p = critterFactory();
  const group = new THREE.Group();
  const body = new THREE.Mesh(p.bodyGeo, p.bodyMat); body.position.set(0, 0.6, 0); group.add(body);
  const head = new THREE.Mesh(p.headGeo, p.headMat); head.position.set(0, 0.66, -0.58); group.add(head);
  const legs = [];
  for (const [x, z] of [[-0.16, -0.32], [0.16, -0.32], [-0.16, 0.32], [0.16, 0.32]]) {
    const leg = new THREE.Mesh(p.legGeo, p.legMat);
    leg.position.set(x, 0.4, z);
    group.add(leg); legs.push(leg);
  }
  return { group, legs };
}

// A passive wandering creature: idles and strolls in random headings, hops over
// 1-block steps when blocked, and swings its legs while walking.
export class MobEntity extends Entity {
  constructor(world, x, y, z) {
    super(world, x, y, z, 0.3, 0.9);
    this.isMob = true;
    this.speed = 1.6;
    this.heading = Math.random() * Math.PI * 2;
    this.moving = false;
    this.aiTimer = 0;
    this.walk = 0;
    const { group, legs } = buildCritter();
    this.mesh = group;
    this.legs = legs;
  }

  pickAI() {
    if (Math.random() < 0.35) { this.moving = false; this.aiTimer = 1 + Math.random() * 2.5; }
    else { this.moving = true; this.heading = Math.random() * Math.PI * 2; this.aiTimer = 2 + Math.random() * 4; }
  }

  update(dt) {
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) this.pickAI();
    if (this.moving) {
      this.velocity.x = -Math.sin(this.heading) * this.speed; // forward = -z when heading 0
      this.velocity.z = -Math.cos(this.heading) * this.speed;
    } else { this.velocity.x = 0; this.velocity.z = 0; }

    const px = this.position.x, pz = this.position.z;
    this.stepPhysics(dt);
    if (this.moving && this.onGround) {
      const moved = Math.hypot(this.position.x - px, this.position.z - pz);
      if (moved < this.speed * dt * 0.4) this.velocity.y = 7; // blocked -> hop a step
      this.walk += dt * 7;
    }

    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.heading;
    const s = this.moving ? Math.sin(this.walk) * 0.5 : 0; // diagonal leg gait
    this.legs[0].rotation.x = s; this.legs[3].rotation.x = s;
    this.legs[1].rotation.x = -s; this.legs[2].rotation.x = -s;
  }
}

export class EntityManager {
  constructor(scene, world, atlas) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.list = [];
    this.time = 0;
    this.spawnTimer = 3;
    this.maxMobs = 8;
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

  spawnMob(x, y, z) {
    const e = new MobEntity(this.world, x, y, z);
    this.scene.add(e.mesh);
    this.list.push(e);
    return e;
  }

  // Topmost solid block with 2 air above (standing room) over sea level, or null
  // if the column isn't loaded / has no surface.
  findSurface(wx, wz) {
    for (let y = WORLD_HEIGHT - 2; y > WATER_LEVEL; y--) {
      if (isSolid(this.world.getBlock(wx, y, wz)) &&
          !isSolid(this.world.getBlock(wx, y + 1, wz)) &&
          !isSolid(this.world.getBlock(wx, y + 2, wz))) return y + 1;
    }
    return null;
  }

  trySpawnMob(player) {
    if (this.list.reduce((n, e) => n + (e.isMob ? 1 : 0), 0) >= this.maxMobs) return;
    for (let t = 0; t < 6; t++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 14 + Math.random() * 18;
      const wx = Math.floor(player.position.x + Math.cos(ang) * dist);
      const wz = Math.floor(player.position.z + Math.sin(ang) * dist);
      const y = this.findSurface(wx, wz);
      if (y != null) { this.spawnMob(wx + 0.5, y, wz + 0.5); return; }
    }
  }

  update(dt, player) {
    this.time += dt;
    const ctx = { player, time: this.time };
    for (const e of this.list) e.update(dt, ctx);

    // Ambient mob spawning around the player.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 5; this.trySpawnMob(player); }

    // Despawn far-away mobs, then remove the dead.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.isMob && !e.dead) {
        const dx = e.position.x - player.position.x, dz = e.position.z - player.position.z;
        if (dx * dx + dz * dz > 70 * 70) e.dead = true;
      }
      if (e.dead) { e.dispose(this.scene); this.list.splice(i, 1); }
    }
  }
}
