// Terra Nova — entry point. Sets up rendering, the world, the player, the HUD,
// pointer-lock controls, and the main loop.
import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Sky } from "./sky.js";
import { CHUNK_SIZE } from "./chunk.js";
import { BLOCK } from "./blocks.js";
import { dropForBlock } from "./items.js";
import { EntityManager } from "./entity.js";
import { Inventory } from "./inventory.js";
import { SaveManager } from "./save.js";
import { Overlays } from "./overlays.js";
import { Profiler } from "./profiler.js";
import { setupTouch } from "./touch.js";
import { setupWorldsUI } from "./worlds-ui.js";
import { setupKeyboardMouse } from "./keyboard-mouse.js";
import { BUILD } from "./version.js";

const SKY = 0x9ad0f0;
const RENDER_DISTANCE = 10;

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight); // Three sets the canvas's inline px size (robust across mobile)
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

// ---- Saved game (localStorage) ----
// `started` gates saving, inventory, and input until the spawn area is primed.
// The snapshot to persist is assembled in collect() from the live game objects.
let started = false;
const save = new SaveManager({
  collect: () => ({
    version: 1,
    seed,
    player: {
      x: player.position.x, y: player.position.y, z: player.position.z,
      yaw: player.yaw, pitch: player.pitch, flying: player.flying,
    },
    sky: { t: sky.t },
    hotbar: ui.serialize(),
    drops: entities.serializeItems(),
    edits: world.serializeEdits(),
  }),
  canSave: () => started,
  toast,
});
const seed = save.seed;

const world = new World(scene, { seed, renderDistance: RENDER_DISTANCE });
if (save.data?.edits) world.loadEditsData(save.data.edits);
const player = new Player(camera, world, scene);
const entities = new EntityManager(scene, world, world.atlas);
// Breaking a block drops the block's item (stone->cobble, ore->material, etc.),
// but only when harvested with the right tool/tier (gated blocks yield nothing).
player.onBreak = (x, y, z, id, harvest) => {
  if (harvest) entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, dropForBlock(id));
};
const sky = new Sky(scene, world.materials, { dayLength: 1200 }); // 20 min, like Minecraft
if (save.data?.sky?.t != null) sky.t = save.data.sky.t;

// ---- Inventory / hotbar / crafting (HUD + panel) — owns its state; see inventory.js ----
const ui = new Inventory({ player, world, toast, savedHotbar: save.data?.hotbar });
player.onSelect = (arg, isIndex) => ui.select(arg, isIndex);
// Survival: placing consumes one of the held item; pickups add to the store.
player.onPlace = () => ui.consumeOnPlace();
entities.onCollect = (id) => ui.collect(id);

// ---- Play state / menu / inventory (works for pointer-lock and touch) ----
const menu = document.getElementById("menu");
const playBtn = document.getElementById("playBtn");
const crosshair = document.getElementById("crosshair");
const hud = document.getElementById("hud");
const debugEl = document.getElementById("debug");
const inventoryEl = document.getElementById("inventory");
const touchEl = document.getElementById("touch");
const buildInfoEl = document.getElementById("buildInfo");
if (buildInfoEl) buildInfoEl.textContent = "build " + BUILD;

// Mobile status-bar tint. Dark over menus/overlays, the live sky while playing.
const themeColorEl = document.getElementById("themeColor");
let _theme = "";
function setTheme(hex) { if (themeColorEl && hex !== _theme) { _theme = hex; themeColorEl.content = hex; } }

const isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
let inventoryOpen = false;
let touchPlaying = false; // touch: in the game (vs the menu)

// In the world (not a menu/inventory)? Desktop uses pointer lock; touch a flag.
function playing() {
  if (inventoryOpen) return false;
  return isTouch ? touchPlaying : document.pointerLockElement === canvas;
}
// Actually looking at the world (not a menu/inventory, and not the portrait
// rotate-prompt). Used to decide the status-bar tint.
function inWorld() {
  return playing() && !(isTouch && window.innerHeight > window.innerWidth);
}
// Single source of truth for what's visible and whether input is live.
function refreshUI() {
  const p = playing();
  player.enabled = p;
  document.body.classList.toggle("playing", p); // drives the portrait "rotate" hint (CSS)
  crosshair.classList.toggle("active", p);
  hud.classList.toggle("active", p);
  debugEl.classList.toggle("active", p);
  touchEl.classList.toggle("active", p && isTouch);
  inventoryEl.classList.toggle("active", inventoryOpen);
  menu.classList.toggle("hidden", p || inventoryOpen);
}

playBtn.addEventListener("click", () => {
  if (isTouch) {
    touchPlaying = true;
    // Go full-screen on the Play gesture (Android/iPad; iPhone Safari ignores it
    // for non-video — there, "Add to Home Screen" gives a full-screen PWA).
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    refreshUI();
  }
  else canvas.requestPointerLock();
});
setupWorldsUI(save); // the "Worlds…" menu button opens the world list / create screen

function openInventory() {
  if (!started || inventoryOpen) return;
  inventoryOpen = true;
  ui.setPanelOpen(true); // reflect drops collected/crafted while it was closed
  if (isTouch) refreshUI(); else document.exitPointerLock();
}
function closeInventory() {
  if (!inventoryOpen) return;
  inventoryOpen = false;
  ui.setPanelOpen(false);
  if (isTouch) refreshUI(); else canvas.requestPointerLock();
}
const invCloseXBtn = document.getElementById("invCloseX");
if (invCloseXBtn) invCloseXBtn.addEventListener("click", closeInventory);
// Tap the dimmed backdrop (outside the panel) to close — always available even
// when the touch controls are hidden.
inventoryEl.addEventListener("click", (e) => { if (e.target === inventoryEl) closeInventory(); });

// Desktop: pointer-lock changes drive the UI.
document.addEventListener("pointerlockchange", () => {
  if (isTouch) return;
  if (document.pointerLockElement === canvas) inventoryOpen = false;
  refreshUI();
});

// Desktop: keyboard + mouse. Always active (inert on touch-only devices).
setupKeyboardMouse(player, {
  isReady: () => started,
  onSave: () => save.save(),
  onToggleInventory: () => (inventoryOpen ? closeInventory() : openInventory()),
  onEscape: () => { if (inventoryOpen) closeInventory(); },
  onToggleMode: toggleMode,
  onToggleProfiler: toggleProfiler,
  onCopyProfiler: () => { overlays.copySnapshot(fps, peakRealMs); peakRealMs = 0; },
  onSpawnMob: spawnMobAhead,
  onToggleLight: toggleLightView,
});

// Touch: virtual joystick / look pad / action buttons.
if (isTouch) {
  document.body.classList.add("is-touch");
  setupTouch(player, {
    onInventory: () => (inventoryOpen ? closeInventory() : openInventory()),
    onPause: () => { touchPlaying = false; refreshUI(); },
  });
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h); // Three owns the canvas display size — guaranteed non-zero box
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
onResize(); // match the actual canvas box now
// iOS shows/hides the URL bar without a resize event — visualViewport catches it.
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

// ---- Prime the spawn area, then start ----
const loadingEl = document.getElementById("loading");
// Prime around the saved position if we have one, else the default spawn.
const spawn = save.data?.player
  ? new THREE.Vector3(save.data.player.x, save.data.player.y, save.data.player.z)
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
      if (save.data?.player) {
        const p = save.data.player;
        player.position.set(p.x, p.y, p.z);
        player.yaw = p.yaw ?? 0;
        player.pitch = p.pitch ?? 0;
        player.flying = !!p.flying;
        player.velocity.set(0, 0, 0);
      } else {
        player.spawnAt(8, 8);
      }
      entities.loadItems(save.data?.drops); // restore dropped items for this world
      loadingEl.classList.remove("active");
      started = true;
      start();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// Auto-save periodically and when the tab is hidden/closed (see save.js).
save.startAutosave();
// ---- Toggle actions (shared by keyboard shortcuts and the menu buttons) ----
function toggleMode() {
  player.creative = !player.creative;
  ui.refreshMode();
  toast(player.creative ? "Creative mode" : "Survival mode");
  updateOptLabels();
}
function toggleProfiler() {
  prof.enabled = !prof.enabled;
  toast(prof.enabled ? "Profiler: ON" : "Profiler: OFF");
  updateOptLabels();
}
function toggleLightView() {
  const u = world.materials.debugUniform;
  u.value = u.value > 0.5 ? 0 : 1;
  toast(u.value > 0.5 ? "Light view: ON (R=block, G=sky)" : "Light view: OFF");
  updateOptLabels();
}
function spawnMobAhead() {
  const f = player.forwardVector(false);
  entities.spawnMob(player.position.x + f.x * 2, player.position.y + 1, player.position.z + f.z * 2);
}

// Profiler must exist before updateOptLabels() runs below (it reads prof.enabled).
const prof = new Profiler();
// Debug + profiler HUD dashboards (see overlays.js).
const overlays = new Overlays({ player, world, entities, sky, prof, renderer, build: BUILD, seed: save.seed, worldName: save.currentName, toast });

// ---- Menu option buttons (so touch can reach the same toggles) ----
const optModeBtn = document.getElementById("optMode");
const optDayBtn = document.getElementById("optDay");
const optNightBtn = document.getElementById("optNight");
const optSaveBtn = document.getElementById("optSave");
const optProfilerBtn = document.getElementById("optProfiler");
const optLightBtn = document.getElementById("optLight");
const optMobBtn = document.getElementById("optMob");
function updateOptLabels() {
  if (optModeBtn) optModeBtn.textContent = "Mode: " + (player.creative ? "Creative" : "Survival");
  if (optProfilerBtn) optProfilerBtn.classList.toggle("on", prof.enabled);
  if (optLightBtn) optLightBtn.classList.toggle("on", world.materials.debugUniform.value > 0.5);
}
if (optModeBtn) optModeBtn.addEventListener("click", toggleMode);
if (optDayBtn) optDayBtn.addEventListener("click", () => { sky.t = 0.32; toast("Set to morning"); });
if (optNightBtn) optNightBtn.addEventListener("click", () => { sky.t = 0; toast("Set to midnight"); });
if (optSaveBtn) optSaveBtn.addEventListener("click", () => { if (save.save() === false) toast("Start the game first"); });
if (optProfilerBtn) optProfilerBtn.addEventListener("click", toggleProfiler);
if (optLightBtn) optLightBtn.addEventListener("click", toggleLightView);
if (optMobBtn) optMobBtn.addEventListener("click", spawnMobAhead);
updateOptLabels();

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
let peakRealMs = 0; // worst real frame time since last copy (captures stutters)

function start() {
  let waterAccum = 0;
  const loop = () => {
    const dt = clock.getDelta();
    // Real frame interval reflects true fps incl. GPU/present (clamped to ignore
    // load/tab-switch hitches); peak-held so a brief stutter survives until copied.
    const realMs = Math.min(dt * 1000, 250);
    prof.record("real", realMs);
    peakRealMs = Math.max(peakRealMs, realMs);
    const fStart = performance.now();
    if (player.enabled) prof.time("player", () => player.update(dt));
    prof.time("world", () => world.update(player.position));
    prof.record("gen", world.timings.gen);
    prof.record("light", world.timings.light);
    prof.record("mesh", world.timings.mesh);
    if (player.enabled) prof.time("entity", () => entities.update(dt, player, sky.brightness));
    // Step the fluid sim a few times a second so flow animates over ticks.
    waterAccum += dt;
    if (waterAccum >= 0.16) { world.simulateWater(2000); waterAccum = 0; }
    // Hold T to fast-forward time (handy for seeing the cycle / moon phases).
    prof.time("sky", () => sky.update(dt * (player.keys.has("KeyT") ? 80 : 1), camera));
    applySky();
    prof.time("render", () => renderer.render(scene, camera));
    prof.record("frame", performance.now() - fStart);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    overlays.update(fps, peakRealMs);

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
  // Status-bar tint: the live sky only when actually looking at the world; dark
  // (matching the menu / inventory / rotate overlays) otherwise. Runs every frame
  // in the loop, so it stays correct across every state.
  setTheme(inWorld() ? "#" + scene.background.getHexString() : "#0b1018");
}

prime();
