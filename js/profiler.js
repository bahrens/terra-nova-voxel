// A lightweight, always-on frame profiler. Records smoothed (EMA) per-section
// timings so a toggleable overlay can show where each frame's time goes. Cheap
// enough to leave running every frame; only the overlay display is toggled.
//
// Usage:
//   prof.time("render", () => renderer.render(...));  // measures + runs
//   prof.record("mesh", world.timings.mesh);          // record a measured ms
//   prof.get("render");                                // smoothed ms
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Profiler {
  constructor() {
    this.ema = {};   // label -> exponentially-smoothed ms
    this.enabled = false;
  }

  record(label, ms) {
    if (this.ema[label] === undefined) this.ema[label] = ms;
    else this.ema[label] += (ms - this.ema[label]) * 0.1; // ~10-frame smoothing
  }

  // Time fn, record it under `label`, and return fn's result.
  time(label, fn) {
    const t = now();
    const r = fn();
    this.record(label, now() - t);
    return r;
  }

  get(label) { return this.ema[label] || 0; }
}
