// SaveManager: localStorage persistence for the world. Owns the save key, the
// load-at-startup snapshot, the autosave timers, and the "New World" wipe. The
// game injects `collect()` (returns the snapshot object to persist) and a
// `canSave()` guard, so *what* a save contains stays the game's concern, not
// this module's — a natural seam for other voxel games built on the base.
const SAVE_KEY = "terra-nova-save";
export const DEFAULT_SEED = 24601;

export class SaveManager {
  constructor({ collect, canSave, toast } = {}) {
    this.collect = collect || (() => ({}));
    this.canSave = canSave || (() => true);
    this.toast = toast || (() => {});
    this.wiping = false;       // discarding the world for New World — suppress autosave
    this.data = this._load();  // the snapshot read at startup (null if none)
  }

  _load() {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; }
    catch { return null; }
  }

  get seed() { return this.data?.seed ?? DEFAULT_SEED; }

  save() {
    if (this.wiping || !this.canSave()) return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.collect()));
      this.toast("Saved");
      return true;
    } catch {
      this.toast("Save failed (storage full?)");
      return false;
    }
  }

  // Discard the saved world: stamp a fresh random seed and reload into it. Sets
  // `wiping` first so the pagehide/beforeunload save can't rewrite the old world.
  newWorld() {
    this.wiping = true;
    try {
      const freshSeed = (Math.random() * 0x7fffffff) >>> 0;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, seed: freshSeed }));
    } catch {
      try { localStorage.removeItem(SAVE_KEY); } catch {}
    }
    location.reload();
  }

  // Save periodically and when the tab is hidden/closed (save() self-guards).
  startAutosave(intervalMs = 15000) {
    setInterval(() => this.save(), intervalMs);
    window.addEventListener("pagehide", () => this.save());
    window.addEventListener("beforeunload", () => this.save());
  }
}
