// Terra Nova — entry point. Sets up rendering, the world, the player, the HUD,
// pointer-lock controls, and the main loop.
import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Sky } from "./sky.js";
import { CHUNK_SIZE } from "./chunk.js";
import { BLOCKS, BLOCK } from "./blocks.js";
import { dropForBlock } from "./items.js";
import { EntityManager } from "./entity.js";
import { Inventory } from "./inventory.js";
import { Profiler } from "./profiler.js";
import { setupTouch } from "./touch.js";
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
const entities = new EntityManager(scene, world, world.atlas);
// Breaking a block drops the block's item (stone->cobble, ore->material, etc.),
// but only when harvested with the right tool/tier (gated blocks yield nothing).
player.onBreak = (x, y, z, id, harvest) => {
  if (harvest) entities.spawnItem(x + 0.5, y + 0.5, z + 0.5, dropForBlock(id));
};
const sky = new Sky(scene, world.materials, { dayLength: 1200 }); // 20 min, like Minecraft
if (saved?.sky?.t != null) sky.t = saved.sky.t;

// ---- Inventory / hotbar / crafting (HUD + panel) — owns its state; see inventory.js ----
const ui = new Inventory({ player, world, toast, savedHotbar: saved?.hotbar });
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
const newWorldBtn = document.getElementById("newWorldBtn");
if (newWorldBtn) newWorldBtn.addEventListener("click", () => {
  if (confirm("Start a new world? This deletes your saved world.")) newWorld();
});

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
const invCloseBtn = document.getElementById("invClose");
if (invCloseBtn) invCloseBtn.addEventListener("click", closeInventory);

// Desktop: pointer-lock changes drive the UI.
document.addEventListener("pointerlockchange", () => {
  if (isTouch) return;
  if (document.pointerLockElement === canvas) inventoryOpen = false;
  refreshUI();
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
    hotbar: ui.serialize(),
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

document.addEventListener("keydown", (e) => {
  if (!started) return;
  if (e.code === "KeyK") saveGame();
  if (e.code === "KeyE") { e.preventDefault(); inventoryOpen ? closeInventory() : openInventory(); }
  if (e.code === "Escape" && inventoryOpen) closeInventory();
  if (e.code === "KeyG") toggleMode();          // creative <-> survival
  if (e.code === "KeyP") toggleProfiler();
  if (e.code === "KeyV") copyProfilerSnapshot();
  if (e.code === "KeyM") spawnMobAhead();        // spawn a critter ahead
  if (e.code === "KeyL") toggleLightView();
});

// Profiler must exist before updateOptLabels() runs below (it reads prof.enabled).
const prof = new Profiler();

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
if (optSaveBtn) optSaveBtn.addEventListener("click", () => { if (saveGame() === false) toast("Start the game first"); });
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
    updateDebug();
    updateProfiler();

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

function updateDebug() {
  if (!player.enabled) return;
  const p = player.position;
  const hit = player.raycast();
  const looking = hit ? `${BLOCKS[hit.block]?.name ?? hit.block} @ ${hit.x},${hit.y},${hit.z}` : "—";
  const mins = Math.floor(sky.t * 24 * 60);
  const clock24 = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  debugEl.textContent =
    `Terra Nova  build ${BUILD}\n` +
    `xyz  ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
    `chunk ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}   chunks ${world.chunks.size}   ents ${entities.list.length}\n` +
    `fps  ${fps}   ${player.flying ? (player.flyFast ? "FLY·fast" : "FLY") : (player.onGround ? "ground" : "air")}\n` +
    `time ${clock24}   look ${looking}`;
}

// Toggleable profiler overlay: per-section frame timings + draw stats. A first-
// class dev tool — leave it in for whenever performance needs a look.
const profilerEl = document.getElementById("profiler");
function updateProfiler() {
  if (!prof.enabled) { if (profilerEl.classList.contains("active")) profilerEl.classList.remove("active"); return; }
  profilerEl.classList.add("active");
  const info = renderer.info.render;
  const ms = (l) => prof.get(l).toFixed(2).padStart(6);
  const minFps = peakRealMs > 0 ? Math.round(1000 / peakRealMs) : fps;
  profilerEl.textContent =
    `PROFILER (P·V copy) fps ${fps}\n` +
    `real  ${ms("real")} ms  peak ${peakRealMs.toFixed(0)} (min ${minFps}fps)\n` +
    `cpu   ${ms("frame")} ms\n` +
    ` player${ms("player")}\n` +
    ` world ${ms("world")}\n` +
    `   gen ${ms("gen")}\n` +
    `   lit ${ms("light")}\n` +
    `  mesh ${ms("mesh")}\n` +
    ` entity${ms("entity")}\n` +
    ` sky   ${ms("sky")}\n` +
    ` render${ms("render")}\n` +
    `draws ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k\n` +
    `chunks ${world.chunks.size}  ents ${entities.list.length}\n` +
    `meshQ ${world.meshQueue.length}  litQ ${world.lightQueue.size}`;
}

// Copy a compact, paste-ready profiler snapshot to the clipboard (V), so the
// numbers from a slow frame are one keypress + paste away.
function copyProfilerSnapshot() {
  const ms = (l) => prof.get(l).toFixed(2);
  const info = renderer.info.render;
  const minFps = peakRealMs > 0 ? Math.round(1000 / peakRealMs) : fps;
  const text =
    `Terra Nova profiler @ ${fps} fps | real ${ms("real")}ms, worst ${peakRealMs.toFixed(0)}ms (min ${minFps}fps) | cpu-frame ${ms("frame")}ms\n` +
    `player ${ms("player")} | world ${ms("world")} (gen ${ms("gen")}, light ${ms("light")}, mesh ${ms("mesh")}) ` +
    `| entity ${ms("entity")} | sky ${ms("sky")} | render ${ms("render")}\n` +
    `draws ${info.calls} | tris ${info.triangles} | chunks ${world.chunks.size} | ` +
    `ents ${entities.list.length} | meshQ ${world.meshQueue.length} | litQ ${world.lightQueue.size}`;
  const ok = () => toast("Profiler copied — paste it to share");
  const fallback = () => { console.log(text); toast("Profiler logged to console (clipboard blocked)"); };
  try { navigator.clipboard.writeText(text).then(ok, fallback); }
  catch { fallback(); }
  peakRealMs = 0; // reset the worst-frame hold for the next measurement window
}

prime();
