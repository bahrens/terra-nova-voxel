// Terra Nova — entry point. Sets up rendering, the world, the player, the HUD,
// pointer-lock controls, and the main loop.
import * as THREE from "three";
import { World } from "./world.js";
import { Player } from "./player.js";
import { CHUNK_SIZE } from "./chunk.js";
import { HOTBAR, BLOCKS } from "./blocks.js";

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
scene.fog = new THREE.Fog(SKY, fogFar * 0.55, fogFar);

const camera = new THREE.PerspectiveCamera(
  72, window.innerWidth / window.innerHeight, 0.1, (RENDER_DISTANCE + 2) * CHUNK_SIZE);

const world = new World(scene, { seed: 24601, renderDistance: RENDER_DISTANCE });
const player = new Player(camera, world, scene);

// ---- Hotbar ----
let selected = 0;
const hotbarEl = document.getElementById("hotbar");
function buildHotbar() {
  hotbarEl.innerHTML = "";
  HOTBAR.forEach((id, i) => {
    const def = BLOCKS[id];
    const slot = document.createElement("div");
    slot.className = "slot" + (i === selected ? " selected" : "");
    const icon = world.atlas.iconCanvas(def.faces.side, 38);
    slot.appendChild(icon);
    const num = document.createElement("span");
    num.className = "num"; num.textContent = i + 1;
    slot.appendChild(num);
    const label = document.createElement("span");
    label.className = "label"; label.textContent = def.name;
    slot.appendChild(label);
    hotbarEl.appendChild(slot);
  });
}
function setSelected(arg, isIndex) {
  const len = HOTBAR.length;
  selected = isIndex ? Math.max(0, Math.min(len - 1, arg))
                     : (selected + arg + len) % len;
  player.placeId = HOTBAR[selected];
  [...hotbarEl.children].forEach((el, i) => el.classList.toggle("selected", i === selected));
}
player.onSelect = setSelected;
buildHotbar();
setSelected(0, true);

// ---- Pointer lock / menu ----
const menu = document.getElementById("menu");
const playBtn = document.getElementById("playBtn");
const crosshair = document.getElementById("crosshair");
const hud = document.getElementById("hud");
const debugEl = document.getElementById("debug");

playBtn.addEventListener("click", () => canvas.requestPointerLock());
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  player.enabled = locked;
  menu.classList.toggle("hidden", locked);
  crosshair.classList.toggle("active", locked);
  hud.classList.toggle("active", locked);
  debugEl.classList.toggle("active", locked);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Prime the spawn area, then start ----
const loadingEl = document.getElementById("loading");
const spawn = new THREE.Vector3(8, 70, 8);

function prime() {
  loadingEl.classList.add("active");
  let frames = 0;
  const tick = () => {
    world.update(spawn, { gen: 8, mesh: 6 });
    frames++;
    const ready = world.isReady(spawn) && world.meshQueue.length === 0 && frames > 6;
    renderer.render(scene, camera);
    if (ready) {
      player.spawnAt(8, 8);
      loadingEl.classList.remove("active");
      start();
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// ---- Main loop ----
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, fps = 0;

function start() {
  const loop = () => {
    const dt = clock.getDelta();
    if (player.enabled) player.update(dt);
    world.update(player.position);
    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    updateDebug();

    requestAnimationFrame(loop);
  };
  loop();
}

function updateDebug() {
  if (!player.enabled) return;
  const p = player.position;
  const hit = player.raycast();
  const looking = hit ? `${BLOCKS[hit.block]?.name ?? hit.block} @ ${hit.x},${hit.y},${hit.z}` : "—";
  debugEl.textContent =
    `Terra Nova\n` +
    `xyz  ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
    `chunk ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}   chunks ${world.chunks.size}\n` +
    `fps  ${fps}   ${player.flying ? (player.flyFast ? "FLY·fast" : "FLY") : (player.onGround ? "ground" : "air")}\n` +
    `look ${looking}`;
}

prime();
