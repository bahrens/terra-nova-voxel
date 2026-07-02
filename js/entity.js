// Entities (sim): anything that lives in the world and moves under its own update
// — dropped items now, mobs/projectiles later. The base class owns AABB voxel
// physics (gravity + axis-separated collision, mirroring the player). This is the
// headless simulation — no Three.js/DOM, so it runs in Node. The meshes that
// visualise these entities live in entity-renderer.js, synced from their state.
import { isSolid } from "./blocks.js";
import { WORLD_HEIGHT, WATER_LEVEL } from "./chunk.js";
import { ITEMS } from "./items.js";
import { Vec3 } from "./vec3.js";

const GRAVITY = 28;

export class Entity {
  constructor(world, x, y, z, halfWidth = 0.15, height = 0.3) {
    this.world = world;
    this.position = new Vec3(x, y, z); // feet (AABB min in y)
    this.velocity = new Vec3();
    this.hw = halfWidth;
    this.h = height;
    this.onGround = false;
    this.dead = false;
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
}

// A dropped item: pops out, falls, settles, then is vacuumed to the player when
// near. Despawns after `ttl` seconds as a safety. `phase` seeds the render bob/spin.
export class ItemEntity extends Entity {
  constructor(world, x, y, z, itemId) {
    super(world, x, y, z, 0.13, 0.26);
    this.itemId = itemId;
    this.age = 0;
    this.ttl = 300;
    this.homing = false;
    this.collected = false;
    this.phase = (x * 12.9898 + z * 78.233) % (Math.PI * 2); // deterministic-ish offset
    // Pop out with a little random scatter + upward kick.
    this.velocity.set(Math.cos(this.phase) * 1.6, 3.2, Math.sin(this.phase) * 1.6);
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
  }
}

const MOB_HOP = 8.5; // clears a full 1-block step (rise ~1.3 blocks, like the player)

// A passive wandering creature: idles and strolls in random headings, and hops
// over 1-block steps when blocked. The leg-swing + light-tint are render-only.
export class MobEntity extends Entity {
  constructor(world, x, y, z) {
    super(world, x, y, z, 0.3, 0.9);
    this.isMob = true;
    this.speed = 1.6;
    this.heading = Math.random() * Math.PI * 2;
    this.moving = false;
    this.aiTimer = 0;
  }

  pickAI() {
    if (Math.random() < 0.35) { this.moving = false; this.aiTimer = 1 + Math.random() * 2.5; }
    else { this.moving = true; this.heading = Math.random() * Math.PI * 2; this.aiTimer = 2 + Math.random() * 4; }
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
    }
  }
}

export class EntityManager {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.spawnTimer = 3;
    this.maxMobs = 8;
    this.onCollect = null; // callback(itemId) when a dropped item is picked up
  }

  spawnItem(x, y, z, itemId) {
    if (!itemId || !ITEMS[itemId]) return null;
    const e = new ItemEntity(this.world, x, y, z, itemId);
    this.list.push(e);
    return e;
  }

  spawnMob(x, y, z) {
    const e = new MobEntity(this.world, x, y, z);
    this.list.push(e);
    return e;
  }

  // Persist / restore dropped items so they survive a reload (mobs aren't saved —
  // they respawn). Age is kept so a restored drop keeps counting toward its TTL.
  serializeItems() {
    return this.list
      .filter((e) => e.itemId != null)
      .map((e) => ({ x: e.position.x, y: e.position.y, z: e.position.z, item: e.itemId, age: Math.round(e.age || 0) }));
  }
  loadItems(arr) {
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const e = this.spawnItem(d.x, d.y, d.z, d.item);
      if (e) { e.velocity.set(0, 0, 0); e.age = d.age || 0; } // land in place, don't pop
    }
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
    const ctx = { player };
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
        this.list.splice(i, 1);
      }
    }
  }
}
