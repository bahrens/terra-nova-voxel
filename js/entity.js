// Entities: anything that lives in the world and moves under its own update —
// dropped items now, mobs/projectiles later. The base class owns AABB voxel
// physics (gravity + axis-separated collision, mirroring the player) so concrete
// entity types only add behaviour. EntityManager owns the list, ticks them, and
// adds/removes their meshes from the scene.
import * as THREE from "three";
import { isSolid } from "./blocks.js";
import { WORLD_HEIGHT, WATER_LEVEL } from "./chunk.js";
import { ITEMS, isBlockItem } from "./items.js";

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

// Geometry per item: a small cube for block items, a flat card for materials,
// with the item's tile mapped onto every face. Cached and shared across drops.
const itemGeoCache = new Map();
function itemGeometry(atlas, itemId) {
  let g = itemGeoCache.get(itemId);
  if (g) return g;
  const [u0, v0, u1, v1] = atlas.uv(ITEMS[itemId].tile);
  g = isBlockItem(itemId) ? new THREE.BoxGeometry(0.3, 0.3, 0.3)
                          : new THREE.BoxGeometry(0.32, 0.32, 0.04); // flat card
  const uv = g.attributes.uv; // every face uses unit-square uvs -> remap to the tile
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  itemGeoCache.set(itemId, g);
  return g;
}

// A dropped item: pops out, falls, settles with a bob/spin, then is vacuumed to
// the player when near. Despawns after `ttl` seconds as a safety.
export class ItemEntity extends Entity {
  constructor(world, x, y, z, itemId, atlas, material) {
    super(world, x, y, z, 0.13, 0.26);
    this.itemId = itemId;
    this.age = 0;
    this.ttl = 300;
    this.homing = false;
    this.phase = (x * 12.9898 + z * 78.233) % (Math.PI * 2); // deterministic-ish offset
    // Pop out with a little random scatter + upward kick.
    this.velocity.set(Math.cos(this.phase) * 1.6, 3.2, Math.sin(this.phase) * 1.6);
    this.mesh = new THREE.Mesh(itemGeometry(atlas, itemId), material);
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
      if (dx * dx + dy * dy + dz * dz < 0.16) { this.dead = true; this.collected = true; } // picked up
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

// A blocky quadruped "critter": body, head, snout, ears, tail, and four swinging
// legs. Geometries are shared; materials are per-mob so each can be tinted by the
// light where it stands.
let critterGeo = null;
function critterGeometry() {
  if (critterGeo) return critterGeo;
  const leg = new THREE.BoxGeometry(0.16, 0.4, 0.16);
  leg.translate(0, -0.2, 0); // origin at the hip so legs swing from the top
  critterGeo = {
    body: new THREE.BoxGeometry(0.5, 0.5, 0.95),
    head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    snout: new THREE.BoxGeometry(0.22, 0.18, 0.12),
    ear: new THREE.BoxGeometry(0.1, 0.14, 0.06),
    tail: new THREE.BoxGeometry(0.1, 0.1, 0.22),
    leg,
  };
  return critterGeo;
}
const CRITTER_BODY = 0xb6906a, CRITTER_HEAD = 0xc8a578, CRITTER_DARK = 0x6e5a3c;
function buildCritter() {
  const G = critterGeometry();
  const bodyMat = new THREE.MeshBasicMaterial({ color: CRITTER_BODY });
  const headMat = new THREE.MeshBasicMaterial({ color: CRITTER_HEAD });
  const darkMat = new THREE.MeshBasicMaterial({ color: CRITTER_DARK });
  const group = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
  add(G.body, bodyMat, 0, 0.6, 0);
  add(G.head, headMat, 0, 0.66, -0.58);
  add(G.snout, darkMat, 0, 0.6, -0.83);
  add(G.ear, headMat, -0.12, 0.9, -0.52);
  add(G.ear, headMat, 0.12, 0.9, -0.52);
  add(G.tail, bodyMat, 0, 0.62, 0.56);
  const legs = [];
  for (const [x, z] of [[-0.16, -0.32], [0.16, -0.32], [-0.16, 0.32], [0.16, 0.32]]) {
    legs.push(add(G.leg, darkMat, x, 0.4, z));
  }
  return { group, legs, mats: [[bodyMat, CRITTER_BODY], [headMat, CRITTER_HEAD], [darkMat, CRITTER_DARK]] };
}

const MOB_HOP = 8.5; // clears a full 1-block step (rise ~1.3 blocks, like the player)

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
    const { group, legs, mats } = buildCritter();
    this.mesh = group;
    this.legs = legs;
    this.mats = mats;
  }

  pickAI() {
    if (Math.random() < 0.35) { this.moving = false; this.aiTimer = 1 + Math.random() * 2.5; }
    else { this.moving = true; this.heading = Math.random() * Math.PI * 2; this.aiTimer = 2 + Math.random() * 4; }
  }

  // Tint the model by the light where it stands (same 0.8-per-level curve as the
  // world shader) so critters dim in caves and at night instead of glowing.
  applyLight(dayFactor) {
    const sx = Math.floor(this.position.x), sy = Math.floor(this.position.y + 0.5), sz = Math.floor(this.position.z);
    const sky = this.world.getSkyLight(sx, sy, sz) / 15;
    const blk = this.world.getBlockLight(sx, sy, sz) / 15;
    const lvl = Math.max(blk, sky * dayFactor);
    const b = Math.max(Math.pow(0.8, (1 - lvl) * 15), 0.12);
    for (const [m, c] of this.mats) m.color.setHex(c).multiplyScalar(b);
  }

  update(dt, ctx) {
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
      if (moved < this.speed * dt * 0.4) this.velocity.y = MOB_HOP; // blocked -> hop the step
      this.walk += dt * 7;
    }

    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.heading;
    const s = this.moving ? Math.sin(this.walk) * 0.5 : 0; // diagonal leg gait
    this.legs[0].rotation.x = s; this.legs[3].rotation.x = s;
    this.legs[1].rotation.x = -s; this.legs[2].rotation.x = -s;
    this.applyLight(ctx && ctx.dayFactor != null ? ctx.dayFactor : 1);
  }

  dispose(scene) {
    super.dispose(scene);
    for (const [m] of this.mats) m.dispose();
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
    this.onCollect = null; // callback(itemId) when a dropped item is picked up
    // Unlit cutout material so plant/leaf tiles keep their transparency.
    this.itemMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.3 });
  }

  spawnItem(x, y, z, itemId) {
    if (!itemId || !ITEMS[itemId]) return null;
    const e = new ItemEntity(this.world, x, y, z, itemId, this.atlas, this.itemMaterial);
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

  update(dt, player, dayFactor = 1) {
    this.time += dt;
    const ctx = { player, time: this.time, dayFactor };
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
      if (e.dead) {
        if (e.collected && this.onCollect) this.onCollect(e.itemId);
        e.dispose(this.scene); this.list.splice(i, 1);
      }
    }
  }
}
