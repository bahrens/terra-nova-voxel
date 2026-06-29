// Player: first-person controls, AABB voxel collision, gravity/flight, and
// DDA voxel raycasting for breaking and placing blocks.
import * as THREE from "three";
import { isSolid, blockHardness, blockTool, blockMinTier } from "./blocks.js";
import { BLOCK } from "./blocks.js";

const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const REACH = 6;

const WALK = 4.3;
const SPRINT = 7.5;
const FLY = 10;
const GRAVITY = 28;
const JUMP = 8.6;

export class Player {
  constructor(camera, world, scene) {
    this.camera = camera;
    this.world = world;
    this.scene = scene;

    this.position = new THREE.Vector3(8, 60, 8); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.flyFast = false;   // toggled by double-tapping W while flying
    this.lastWTap = -1e9;
    this.enabled = false;

    this.keys = new Set();
    this.moveX = 0; this.moveZ = 0; // analog move (touch joystick): strafe / forward, -1..1
    this.selected = 0; // hotbar index, set by main

    this.creative = false; // instant break (no mining) when true
    this.leftDown = false;
    this.mining = null;    // { x, y, z, progress } while breaking by hand
    this.toolInfo = null;  // { type, tier, speed } of the held tool, set by main

    this.highlight = this.makeHighlight();
    scene.add(this.highlight);
    this.crack = this.makeCrack();
    scene.add(this.crack);

    this.onSelect = null; // callback(deltaOrIndex) hook set by main
    this.onBreak = null;  // callback(x, y, z, blockId, harvest) when a block is broken
    this.onPlace = null;  // callback() after a block is placed (survival consumes)

    this.bindInput();
  }

  // A translucent crack overlay shown on the block being mined, fading in with
  // progress. A procedural crack texture keeps it asset-free.
  makeCrack() {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d");
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = 8, y = 8, a = (i / 5) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        a += (Math.random() - 0.5) * 1.3;
        x += Math.cos(a) * 3; y += Math.sin(a) * 3;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), mat);
    mesh.visible = false;
    return mesh;
  }

  makeHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(
      edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    line.visible = false;
    return line;
  }

  bindInput() {
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      const fresh = !this.keys.has(e.code); // ignore key-repeat events
      this.keys.add(e.code);
      if (!fresh) return;
      if (e.code === "KeyF") { this.flying = !this.flying; this.flyFast = false; }
      // Double-tap W toggles fast flight (stays on until toggled off).
      if (e.code === "KeyW" && this.flying) {
        const now = performance.now();
        if (now - this.lastWTap < 300) this.flyFast = !this.flyFast;
        this.lastWTap = now;
      }
      if (e.code.startsWith("Digit")) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9 && this.onSelect) this.onSelect(n - 1, true);
      }
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    document.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      this.lookDelta(e.movementX, e.movementY);
    });
    window.addEventListener("wheel", (e) => {
      if (!this.enabled || !this.onSelect) return;
      this.onSelect(Math.sign(e.deltaY), false);
    }, { passive: true });
    document.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.leftDown = true; if (this.creative) this.breakBlock(false); }
      else if (e.button === 2) this.placeBlock();
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) { this.leftDown = false; this.mining = null; }
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Apply a look delta (mouse movement or a touch drag) to yaw/pitch.
  lookDelta(dx, dy) {
    const s = 0.0022;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  forwardVector(includePitch = false) {
    const v = new THREE.Vector3(
      -Math.sin(this.yaw) * (includePitch ? Math.cos(this.pitch) : 1),
      includePitch ? Math.sin(this.pitch) : 0,
      -Math.cos(this.yaw) * (includePitch ? Math.cos(this.pitch) : 1),
    );
    return v.normalize();
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const forward = this.forwardVector(false);
    // Right-hand strafe vector: cross(forward, up).
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    // Combine keyboard (digital ±1) with analog touch joystick input.
    const wf = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) + this.moveZ;
    const ws = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0) + this.moveX;
    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, wf).addScaledVector(right, ws);
    if (wish.lengthSq() > 1) wish.normalize();

    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

    if (this.flying) {
      const speed = FLY * (this.flyFast ? 2.6 : 1);
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      let vy = 0;
      if (this.keys.has("Space")) vy += speed;
      // Shift (or Ctrl / C) descends while flying.
      if (sprint || this.keys.has("ControlLeft") || this.keys.has("KeyC")) vy -= speed;
      this.velocity.y = vy;
    } else {
      const speed = sprint ? SPRINT : WALK;
      // Snappy horizontal control.
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      this.velocity.y -= GRAVITY * dt;
      if (this.keys.has("Space") && this.onGround) {
        this.velocity.y = JUMP;
        this.onGround = false;
      }
    }

    // Integrate with substepped, axis-separated collision.
    const disp = this.velocity.clone().multiplyScalar(dt);
    const maxComp = Math.max(Math.abs(disp.x), Math.abs(disp.y), Math.abs(disp.z));
    const steps = Math.max(1, Math.ceil(maxComp / 0.18));
    const sx = disp.x / steps, sy = disp.y / steps, sz = disp.z / steps;

    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis("x", sx);
      this.moveAxis("z", sz);
      this.moveAxis("y", sy);
    }

    // Respawn safety if we somehow fall out of the world.
    if (this.position.y < -10) {
      this.position.set(this.position.x, 70, this.position.z);
      this.velocity.set(0, 0, 0);
    }

    // Place camera at the eyes.
    this.camera.position.set(this.position.x, this.position.y + EYE, this.position.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    this.updateHighlight();
    this.updateMining(dt);
  }

  // Hold-to-break mining: progress accumulates by the block's hardness, divided
  // by the held tool's speed when it matches the block's tool category. Harvest
  // (a drop) requires a matching tool of sufficient tier for gated blocks; else
  // the block still breaks but yields nothing. Creative (instant break) is on
  // mousedown instead. Resets if the target changes or the button is released.
  updateMining(dt) {
    if (!this.leftDown || this.creative) { this.mining = null; this.crack.visible = false; return; }
    const hit = this.raycast();
    if (!hit) { this.mining = null; this.crack.visible = false; return; }
    const hardness = blockHardness(hit.block);
    if (!isFinite(hardness)) { this.mining = null; this.crack.visible = false; return; } // unbreakable

    const tool = this.toolInfo;
    const matched = tool && tool.type === blockTool(hit.block);
    const speed = matched ? tool.speed : 1;

    if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z) {
      this.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
    }
    this.mining.progress += hardness > 0 ? (dt * speed) / hardness : 1;

    this.crack.visible = true;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.material.opacity = 0.15 + 0.55 * Math.min(1, this.mining.progress);

    if (this.mining.progress >= 1) {
      const minTier = blockMinTier(hit.block);
      const harvest = minTier === 0 || (matched && tool.tier >= minTier);
      this.breakBlock(harvest);
      this.mining = null;
      this.crack.visible = false;
    }
  }

  moveAxis(comp, amount) {
    if (amount === 0) return;
    this.position[comp] += amount;
    if (this.intersects()) {
      this.position[comp] -= amount;
      if (comp === "y") {
        if (amount < 0) this.onGround = true;
        this.velocity.y = 0;
      } else {
        this.velocity[comp] = 0;
      }
    }
  }

  intersects() {
    const { x, y, z } = this.position;
    const minX = Math.floor(x - HALF_WIDTH), maxX = Math.floor(x + HALF_WIDTH);
    const minY = Math.floor(y), maxY = Math.floor(y + HEIGHT - 1e-4);
    const minZ = Math.floor(z - HALF_WIDTH), maxZ = Math.floor(z + HALF_WIDTH);
    for (let by = minY; by <= maxY; by++)
      for (let bz = minZ; bz <= maxZ; bz++)
        for (let bx = minX; bx <= maxX; bx++)
          if (isSolid(this.world.getBlock(bx, by, bz))) return true;
    return false;
  }

  // ---- Block interaction ----
  raycast() {
    const origin = this.camera.position.clone();
    const dir = this.forwardVector(true);
    // Amanatides & Woo voxel traversal.
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
    while (t <= REACH) {
      const block = this.world.getBlock(x, y, z);
      if (isSolid(block)) {
        return { x, y, z, normal: { x: nx, y: ny, z: nz }, block };
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

  updateHighlight() {
    const hit = this.raycast();
    if (!hit) { this.highlight.visible = false; return; }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  breakBlock(harvest = true) {
    const hit = this.raycast();
    if (!hit) return;
    if (hit.block === BLOCK.BEDROCK) return;
    this.world.setBlock(hit.x, hit.y, hit.z, 0);
    if (this.onBreak) this.onBreak(hit.x, hit.y, hit.z, hit.block, harvest);
  }

  placeBlock() {
    const hit = this.raycast();
    if (!hit || !this.placeId) return;
    const px = hit.x + hit.normal.x;
    const py = hit.y + hit.normal.y;
    const pz = hit.z + hit.normal.z;
    const tgt = this.world.getBlock(px, py, pz);
    if (tgt !== 0 && tgt !== BLOCK.WATER) return; // can build into air or displace water
    if (this.overlapsPlayer(px, py, pz)) return;
    this.world.setBlock(px, py, pz, this.placeId);
    if (this.onPlace) this.onPlace(); // survival: consume one from the inventory
  }

  overlapsPlayer(bx, by, bz) {
    const { x, y, z } = this.position;
    return bx + 1 > x - HALF_WIDTH && bx < x + HALF_WIDTH &&
           bz + 1 > z - HALF_WIDTH && bz < z + HALF_WIDTH &&
           by + 1 > y && by < y + HEIGHT;
  }

  // Drop the player onto the surface at spawn.
  spawnAt(x, z) {
    let top = 0;
    for (let y = 120; y > 0; y--) {
      if (isSolid(this.world.getBlock(x, y, z))) { top = y + 1; break; }
    }
    this.position.set(x + 0.5, top + 0.5, z + 0.5);
    this.velocity.set(0, 0, 0);
  }
}
