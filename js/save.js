// SaveManager: localStorage persistence with multiple named worlds.
//
// An index (terra-nova-worlds) tracks the world list + which one is current;
// each world's snapshot lives under terra-nova-world:<id>. The game loads ONE
// world per page load (the current one) — switching / creating / deleting the
// active world updates the index and reloads, which avoids tearing down the
// World/player/entities mid-session. The game injects collect()/canSave(), so
// what a snapshot holds stays the game's concern, not this module's.
const INDEX_KEY = "terra-nova-worlds";
const WORLD_PREFIX = "terra-nova-world:";
const LEGACY_KEY = "terra-nova-save"; // pre-multi-world single slot
export const DEFAULT_SEED = 24601;

const randomSeed = () => (Math.random() * 0x7fffffff) >>> 0;

// Turn a user seed input into a numeric seed: blank = random, digits used as-is,
// anything else hashed to a uint32 (so words work as seeds, like Minecraft).
export function parseSeed(input) {
  const s = String(input ?? "").trim();
  if (s === "") return randomSeed();
  if (/^-?\d+$/.test(s)) return (parseInt(s, 10) >>> 0) || 1;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class SaveManager {
  constructor({ collect, canSave, toast } = {}) {
    this.collect = collect || (() => ({}));
    this.canSave = canSave || (() => true);
    this.toast = toast || (() => {});
    this.wiping = false; // suppress autosave while reloading into another world

    this._migrateLegacy();
    let idx = this._index();
    if (!idx.worlds.length) {
      // Fresh install: seed a default world so there's always something to load.
      this._create({ name: "World", seed: DEFAULT_SEED, makeCurrent: true, reload: false });
      idx = this._index();
    }
    // Pick a valid current world.
    this.currentId = (idx.currentId && idx.worlds.some((w) => w.id === idx.currentId))
      ? idx.currentId : idx.worlds[0].id;
    if (this.currentId !== idx.currentId) { idx.currentId = this.currentId; this._saveIndex(idx); }
    this.data = this._loadWorld(this.currentId); // this world's snapshot (null if just created)
  }

  // ---- info the game reads ----
  get seed() { return this.data?.seed ?? DEFAULT_SEED; }
  get currentName() { const w = this._index().worlds.find((w) => w.id === this.currentId); return w?.name ?? "World"; }
  // Worlds newest-played first (for the select UI).
  listWorlds() {
    return this._index().worlds.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }

  // ---- persistence ----
  save() {
    if (this.wiping || !this.canSave() || !this.currentId) return false;
    try {
      localStorage.setItem(WORLD_PREFIX + this.currentId, JSON.stringify(this.collect()));
      const idx = this._index();
      const w = idx.worlds.find((w) => w.id === this.currentId);
      if (w) { w.lastPlayed = Date.now(); this._saveIndex(idx); }
      this.toast("Saved");
      return true;
    } catch {
      this.toast("Save failed (storage full?)");
      return false;
    }
  }

  startAutosave(intervalMs = 15000) {
    setInterval(() => this.save(), intervalMs);
    window.addEventListener("pagehide", () => this.save());
    window.addEventListener("beforeunload", () => this.save());
  }

  // ---- world management (each reloads into the resulting current world) ----
  createWorld({ name, seed } = {}) {
    this.save();        // persist the world we're leaving before reloading
    this.wiping = true;
    this._create({ name: (name || "").trim() || "World", seed: parseSeed(seed), makeCurrent: true, reload: true });
  }

  switchTo(id) {
    if (id === this.currentId) return;
    if (!this._index().worlds.some((w) => w.id === id)) return;
    this.save();        // persist the world we're leaving before reloading
    this.wiping = true;
    const idx = this._index();
    idx.currentId = id; this._saveIndex(idx);
    location.reload();
  }

  // Returns true if it reloaded (deleted the active world), false if it just
  // dropped an inactive world (caller should re-render the list).
  deleteWorld(id) {
    const idx = this._index();
    idx.worlds = idx.worlds.filter((w) => w.id !== id);
    try { localStorage.removeItem(WORLD_PREFIX + id); } catch {}
    if (this.currentId === id) {
      this.wiping = true;
      if (idx.worlds.length) {
        idx.worlds.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        idx.currentId = idx.worlds[0].id;
        this._saveIndex(idx);
      } else {
        this._saveIndex(idx);
        this._create({ name: "World", seed: DEFAULT_SEED, makeCurrent: true, reload: false });
      }
      location.reload();
      return true;
    }
    this._saveIndex(idx);
    return false;
  }

  // ---- internals ----
  _index() {
    try {
      const o = JSON.parse(localStorage.getItem(INDEX_KEY));
      if (o && Array.isArray(o.worlds)) return o;
    } catch {}
    return { worlds: [], currentId: null };
  }
  _saveIndex(idx) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch {} }
  _loadWorld(id) {
    try { const s = localStorage.getItem(WORLD_PREFIX + id); return s ? JSON.parse(s) : null; }
    catch { return null; }
  }
  _newId() {
    return Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
  }
  _create({ name, seed, makeCurrent, reload }) {
    const idx = this._index();
    const id = this._newId();
    try { localStorage.setItem(WORLD_PREFIX + id, JSON.stringify({ version: 1, seed })); } catch {}
    idx.worlds.push({ id, name, seed, createdAt: Date.now(), lastPlayed: Date.now() });
    if (makeCurrent) idx.currentId = id;
    this._saveIndex(idx);
    if (reload) location.reload();
    return id;
  }
  // Move a pre-multi-world single save into a world entry (once).
  _migrateLegacy() {
    let legacy;
    try { legacy = localStorage.getItem(LEGACY_KEY); } catch { return; }
    if (!legacy) return;
    const idx = this._index();
    if (idx.worlds.length) { try { localStorage.removeItem(LEGACY_KEY); } catch {} return; }
    try {
      const data = JSON.parse(legacy);
      const id = this._newId();
      localStorage.setItem(WORLD_PREFIX + id, legacy);
      idx.worlds.push({ id, name: "World", seed: data.seed ?? DEFAULT_SEED, createdAt: Date.now(), lastPlayed: Date.now() });
      idx.currentId = id;
      this._saveIndex(idx);
      localStorage.removeItem(LEGACY_KEY);
    } catch {}
  }
}
