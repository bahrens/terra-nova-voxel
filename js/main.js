// Terra Nova — entry point. Sets up rendering, the world, the player, the HUD,
// pointer-lock controls, and the main loop.
import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Sky } from "./sky.js";
import { CHUNK_SIZE } from "./chunk.js";
import { HOTBAR, BLOCKS, BLOCK } from "./blocks.js";

const SKY = 0x9ad0f0;
const RENDER_DISTANCE = 10;

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(SKY);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
// Keep distant terrain visible: fog only bites near the edge of view range.
const fogFar = (RENDER_DISTANCE - 1) * CHUNK_SIZE;
const fogNear = fogFar * 0.55;
scene.fog = new THREE.Fog(SKY, fogNear, fogFar);

// Underwater look: tighter, bluer fog so the world gets murky when submerged.
const UNDERWATER_COLOR = new THREE.Color(0x2a5f9e);

const camera = new THREE.PerspectiveCamera(
  72, window.innerWidth / window.innerHeight, 0.1, (RENDER_DISTANCE + 2) * CHUNK_SIZE);

// ---- Saved game (localStorage): seed + player edits + position + time ----
const SAVE_KEY = "terra-nova-save";
const DEFAULT_SEED = 24601;
function loadSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
const saved = loadSave();
const seed = saved?.seed ?? DEFAULT_SEED;

const world = new World(scene, { seed, renderDistance: RENDER_DISTANCE });
if (saved?.edits) world.loadEditsData(saved.edits);
const player = new Player(camera, world, scene);
const sky = new Sky(scene, world.materials, { dayLength: 1200 }); // 20 min, like Minecraft
if (saved?.sky?.t != null) sky.t = saved.sky.t;

// ---- Hotbar + inventory ----
// The hotbar is 9 mutable slots (a block id or null), customised from the
// inventory and persisted in the save; it defaults to the built-in HOTBAR.
function sanitizeHotbar(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (let i = 0; i < 9; i++) { const v = arr[i]; out.push(v != null && BLOCKS[v] ? v : null); }
  return out;
}
let hotbar = sanitizeHotbar(saved?.hotbar) || [...HOTBAR];
let selected = 0;

const hotbarEl = document.getElementById("hotbar");
const invHotbarEl = document.getElementById("invHotbar");
const invGridEl = document.getElementById("invGrid");

// Render the 9 hotbar slots into `el`; when clickable (the inventory copy),
// clicking selects a slot and right-clicking clears it.
function renderSlots(el, clickable) {
  el.innerHTML = "";
  hotbar.forEach((id, i) => {
    const def = id != null ? BLOCKS[id] : null;
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " selected" : "");
    if (def) slot.appendChild(world.atlas.iconCanvas(def.faces.side, 38));
    const num = document.createElement("span");
    num.className = "num"; num.textContent = i + 1; slot.appendChild(num);
    if (def) {
      const label = document.createElement("span");
      label.className = "label"; label.textContent = def.name; slot.appendChild(label);
    }
    if (clickable) {
      slot.addEventListener("click", () => setSelected(i, true));
      slot.addEventListener("contextmenu", (e) => {
        e.preventDefault(); hotbar[i] = null;
        if (i === selected) player.placeId = 0;
        buildHotbars();
      });
    }
    el.appendChild(slot);
  });
}
function buildHotbars() { renderSlots(hotbarEl, false); renderSlots(invHotbarEl, true); }
function applySelection() {
  [hotbarEl, invHotbarEl].forEach((el) =>
    [...el.children].forEach((c, i) => c.classList.toggle("selected", i === selected)));
}
function setSelected(arg, isIndex) {
  const len = hotbar.length;
  selected = isIndex ? Math.max(0, Math.min(len - 1, arg)) : (selected + arg + len) % len;
  player.placeId = hotbar[selected] ?? 0;
  applySelection();
}
player.onSelect = setSelected;

// Creative palette: one cell per block; click assigns it to the selected slot.
function buildPalette() {
  invGridEl.innerHTML = "";
  Object.keys(BLOCKS).map(Number).forEach((id) => {
    const def = BLOCKS[id];
    const cell = document.createElement("div");
    cell.className = "inv-item"; cell.title = def.name;
    cell.appendChild(world.atlas.iconCanvas(def.faces.side, 34));
    const name = document.createElement("span");
    name.className = "inv-name"; name.textContent = def.name; cell.appendChild(name);
    cell.addEventListener("click", () => {
      hotbar[selected] = id; player.placeId = id; buildHotbars();
    });
    invGridEl.appendChild(cell);
  });
}
buildPalette();
buildHotbars();
setSelected(0, true);

// ---- Pointer lock / menu ----
const menu = document.getElementById("menu");
const playBtn = document.getElementById("playBtn");
const crosshair = document.getElementById("crosshair");
const hud = document.getElementById("hud");
const debugEl = document.getElementById("debug");

playBtn.addEventListener("click", () => canvas.requestPointerLock());
const newWorldBtn = document.getElementById("newWorldBtn");
if (newWorldBtn) newWorldBtn.addEventListener("click", () => {
  if (confirm("Start a new world? This deletes your saved world.")) newWorld();
});
// Inventory overlay: opening exits pointer lock (so the cursor works); closing
// re-locks. pointerlockchange decides whether an unlock means "inventory" or
// the pause menu.
const inventoryEl = document.getElementById("inventory");
let inventoryOpen = false;
function openInventory() { if (!started || inventoryOpen) return; inventoryOpen = true; document.exitPointerLock(); }
function closeInventory() { if (!inventoryOpen) return; inventoryOpen = false; inventoryEl.classList.remove("active"); canvas.requestPointerLock(); }

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  player.enabled = locked;
  crosshair.classList.toggle("active", locked);
  hud.classList.toggle("active", locked);
  debugEl.classList.toggle("active", locked);
  if (locked) {
    menu.classList.add("hidden");
    inventoryEl.classList.remove("active");
    inventoryOpen = false;
  } else {
    // Unlocked: show the inventory if that's why we unlocked, else the pause menu.
    inventoryEl.classList.toggle("active", inventoryOpen);
    menu.classList.toggle("hidden", inventoryOpen);
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Prime the spawn area, then start ----
const loadingEl = document.getElementById("loading");
// Prime around the saved position if we have one, else the default spawn.
const spawn = saved?.player
  ? new THREE.Vector3(saved.player.x, saved.player.y, saved.player.z)
  : new THREE.Vector3(8, 70, 8);

function prime() {
  loadingEl.classList.add("active");
  let frames = 0;
  const tick = () => {
    world.update(spawn, { genMs: 22, meshMs: 22 }); // load fast under the loading screen
    frames++;
    const ready = world.isReady(spawn) && world.meshQueue.length === 0 && frames > 6;
    renderer.render(scene, camera);
    if (ready) {
      if (saved?.player) {
        const p = saved.player;
        player.position.set(p.x, p.y, p.z);
        player.yaw = p.yaw ?? 0;
        player.pitch = p.pitch ?? 0;
        player.flying = !!p.flying;
        player.velocity.set(0, 0, 0);
      } else {
        player.spawnAt(8, 8);
      }
      loadingEl.classList.remove("active");
      started = true;
      start();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// ---- Save game ----
let started = false;
let wiping = false; // true while discarding the world for "New World"
function saveGame() {
  if (!started || wiping) return false;
  const data = {
    version: 1,
    seed,
    player: {
      x: player.position.x, y: player.position.y, z: player.position.z,
      yaw: player.yaw, pitch: player.pitch, flying: player.flying,
    },
    sky: { t: sky.t },
    hotbar: hotbar.slice(),
    edits: world.serializeEdits(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    toast("Saved");
    return true;
  } catch (e) {
    toast("Save failed (storage full?)");
    return false;
  }
}
function newWorld() {
  // Block the pagehide/beforeunload auto-save below from rewriting the world
  // we're discarding, then seed a fresh random world for the reload to load.
  wiping = true;
  try {
    const freshSeed = (Math.random() * 0x7fffffff) >>> 0;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, seed: freshSeed }));
  } catch {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
  }
  location.reload();
}

// Auto-save periodically and when the tab is hidden/closed.
setInterval(() => { if (started) saveGame(); }, 15000);
window.addEventListener("pagehide", () => saveGame());
window.addEventListener("beforeunload", () => saveGame());
document.addEventListener("keydown", (e) => {
  if (!started) return;
  if (e.code === "KeyK") saveGame();
  if (e.code === "KeyE") { e.preventDefault(); inventoryOpen ? closeInventory() : openInventory(); }
  if (e.code === "Escape" && inventoryOpen) closeInventory();
  // Debug: toggle the raw light view (R = block light, G = skylight).
  if (e.code === "KeyL") {
    const u = world.materials.debugUniform;
    u.value = u.value > 0.5 ? 0 : 1;
    toast(u.value > 0.5 ? "Light view: ON (R=block, G=sky)" : "Light view: OFF");
  }
});

// Transient on-screen message.
const toastEl = document.getElementById("toast");
let toastTimer = 0;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

// ---- Main loop ----
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, fps = 0;

function start() {
  let waterAccum = 0;
  const loop = () => {
    const dt = clock.getDelta();
    if (player.enabled) player.update(dt);
    world.update(player.position);
    // Step the fluid sim a few times a second so flow animates over ticks.
    waterAccum += dt;
    if (waterAccum >= 0.16) { world.simulateWater(2000); waterAccum = 0; }
    // Hold T to fast-forward time (handy for seeing the cycle / moon phases).
    sky.update(dt * (player.keys.has("KeyT") ? 80 : 1), camera);
    applySky();
    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    updateDebug();

    requestAnimationFrame(loop);
  };
  loop();
}

// Drive fog/background from the time of day, with an underwater override.
const underwaterEl = document.getElementById("underwater");
const _uw = new THREE.Color();
let wasUnderwater = false;
function applySky() {
  const c = camera.position;
  const submerged = world.getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)) === BLOCK.WATER;
  if (submerged !== wasUnderwater) {
    wasUnderwater = submerged;
    underwaterEl.classList.toggle("active", submerged);
    scene.fog.near = submerged ? 0.1 : fogNear;
    scene.fog.far = submerged ? 26 : fogFar;
  }
  if (submerged) {
    // Underwater blue, dimmed at night to match the world brightness.
    _uw.copy(UNDERWATER_COLOR).multiplyScalar(0.45 + 0.55 * sky.brightness);
    scene.fog.color.copy(_uw);
    scene.background.copy(_uw);
  } else {
    scene.fog.color.copy(sky.skyColor);
    scene.background.copy(sky.skyColor);
  }
}

function updateDebug() {
  if (!player.enabled) return;
  const p = player.position;
  const hit = player.raycast();
  const looking = hit ? `${BLOCKS[hit.block]?.name ?? hit.block} @ ${hit.x},${hit.y},${hit.z}` : "—";
  const mins = Math.floor(sky.t * 24 * 60);
  const clock24 = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  debugEl.textContent =
    `Terra Nova\n` +
    `xyz  ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
    `chunk ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}   chunks ${world.chunks.size}\n` +
    `fps  ${fps}   ${player.flying ? (player.flyFast ? "FLY·fast" : "FLY") : (player.onGround ? "ground" : "air")}\n` +
    `time ${clock24}   look ${looking}`;
}

prime();
