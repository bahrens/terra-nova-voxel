// On-screen dev dashboards — the debug readout and the toggleable profiler —
// pulled out of main.js. Constructed with the long-lived game objects; the
// per-frame stats (fps, worst-frame ms) are passed into update()/copySnapshot()
// since they live in the render loop, not here.
import { BLOCKS } from "./blocks.js";
import { CHUNK_SIZE } from "./chunk.js";

export class Overlays {
  constructor({ player, world, entities, sky, prof, renderer, build, seed, worldName, toast }) {
    this.player = player; this.world = world; this.entities = entities;
    this.sky = sky; this.prof = prof; this.renderer = renderer;
    this.build = build; this.seed = seed; this.worldName = worldName;
    this.toast = toast || (() => {});
    this.debugEl = document.getElementById("debug");
    this.profilerEl = document.getElementById("profiler");
  }

  // Called every frame from the loop.
  update(fps, peakMs) {
    this._debug(fps);
    this._profiler(fps, peakMs);
  }

  _debug(fps) {
    if (!this.player.enabled) return;
    const p = this.player.position;
    const hit = this.player.raycast();
    const looking = hit ? `${BLOCKS[hit.block]?.name ?? hit.block} @ ${hit.x},${hit.y},${hit.z}` : "—";
    const mins = Math.floor(this.sky.t * 24 * 60);
    const clock24 = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    this.debugEl.textContent =
      `Terra Nova  build ${this.build}\n` +
      `world "${this.worldName}"  seed ${this.seed}\n` +
      `xyz  ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n` +
      `chunk ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}   chunks ${this.world.chunks.size}   ents ${this.entities.list.length}\n` +
      `fps  ${fps}   ${this.player.flying ? (this.player.flyFast ? "FLY·fast" : "FLY") : (this.player.onGround ? "ground" : "air")}\n` +
      `time ${clock24}   look ${looking}`;
  }

  _profiler(fps, peakMs) {
    const prof = this.prof;
    if (!prof.enabled) {
      if (this.profilerEl.classList.contains("active")) this.profilerEl.classList.remove("active");
      return;
    }
    this.profilerEl.classList.add("active");
    const info = this.renderer.info.render;
    const ms = (l) => prof.get(l).toFixed(2).padStart(6);
    const minFps = peakMs > 0 ? Math.round(1000 / peakMs) : fps;
    this.profilerEl.textContent =
      `PROFILER (P·V copy) fps ${fps}\n` +
      `real  ${ms("real")} ms  peak ${peakMs.toFixed(0)} (min ${minFps}fps)\n` +
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
      `chunks ${this.world.chunks.size}  ents ${this.entities.list.length}\n` +
      `meshQ ${this.world.meshQueue.length}  litQ ${this.world.lightQueue.size}`;
  }

  // Copy a compact, paste-ready profiler snapshot to the clipboard (V). The
  // caller resets its worst-frame hold after this; we only read the stats.
  copySnapshot(fps, peakMs) {
    const prof = this.prof;
    const ms = (l) => prof.get(l).toFixed(2);
    const info = this.renderer.info.render;
    const minFps = peakMs > 0 ? Math.round(1000 / peakMs) : fps;
    const text =
      `Terra Nova profiler @ ${fps} fps | real ${ms("real")}ms, worst ${peakMs.toFixed(0)}ms (min ${minFps}fps) | cpu-frame ${ms("frame")}ms\n` +
      `player ${ms("player")} | world ${ms("world")} (gen ${ms("gen")}, light ${ms("light")}, mesh ${ms("mesh")}) ` +
      `| entity ${ms("entity")} | sky ${ms("sky")} | render ${ms("render")}\n` +
      `draws ${info.calls} | tris ${info.triangles} | chunks ${this.world.chunks.size} | ` +
      `ents ${this.entities.list.length} | meshQ ${this.world.meshQueue.length} | litQ ${this.world.lightQueue.size}`;
    const ok = () => this.toast("Profiler copied — paste it to share");
    const fallback = () => { console.log(text); this.toast("Profiler logged to console (clipboard blocked)"); };
    try { navigator.clipboard.writeText(text).then(ok, fallback); }
    catch { fallback(); }
  }
}
