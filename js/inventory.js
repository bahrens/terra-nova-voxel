// Inventory: the 9-slot hotbar, the creative palette, the counted survival store,
// and crafting — plus all their DOM. Extracted from main.js so there is a single
// owner of inventory state and a single "changed" path, instead of every action
// hand-calling a scatter of refresh functions (which is what bred bugs).
import { ITEMS, blockForItem, toolStats, DEFAULT_HOTBAR } from "./items.js";
import { RECIPES, canCraft } from "./recipes.js";

// A saved hotbar is only trusted slot-by-slot (ids must still exist as items).
function sanitizeHotbar(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (let i = 0; i < 9; i++) { const v = arr[i]; out.push(v != null && ITEMS[v] ? v : null); }
  return out;
}

export class Inventory {
  // deps: { player, atlas, toast, savedHotbar }
  //  - player: read .creative; written .toolInfo/.placeId (what's held)
  //  - atlas:  for atlas.iconCanvas(tile, px) item icons
  //  - toast:  transient message fn (crafting feedback)
  constructor({ player, atlas, toast, savedHotbar }) {
    this.player = player;
    this.atlas = atlas;
    this.toast = toast || (() => {});
    this.hotbar = sanitizeHotbar(savedHotbar) || [...DEFAULT_HOTBAR];
    this.selected = 0;
    this.counts = new Map(); // item id -> count (survival store)
    this.panelOpen = false;  // is the inventory panel visible? (gates panel renders)

    const $ = (id) => document.getElementById(id);
    this.hotbarEl = $("hotbar");          // HUD hotbar
    this.invHotbarEl = $("invHotbar");    // hotbar copy inside the inventory panel
    this.invGridEl = $("invGrid");        // creative palette grid
    this.invItemsEl = $("invItems");      // survival store grid
    this.invItemsEmptyEl = $("invItemsEmpty");
    this.invCraftingEl = $("invCrafting");
    this.invPaletteEl = $("invPalette");  // palette wrapper (hidden in survival)

    this.buildPalette();
    this.refreshMode(); // palette visibility + initial hotbar render + held sync
  }

  // ---- public API (called from main.js) ----

  serialize() { return this.hotbar.slice(); }
  count(id) { return this.counts.get(id) || 0; }

  // Change the selected slot. isIndex true: absolute index; else a +/- scroll delta.
  // Cheap: no DOM rebuild, just re-sync what's held and move the highlight.
  select(arg, isIndex) {
    const len = this.hotbar.length;
    this.selected = isIndex
      ? Math.max(0, Math.min(len - 1, arg))
      : (this.selected + arg + len) % len;
    this.syncHeld();
    this.applySelection();
  }

  // A picked-up drop entered the world inventory.
  collect(id) { this.add(id, 1); this.changed(); }

  // Survival: consume one of the held item after a successful place.
  consumeOnPlace() {
    if (this.player.creative) return;
    const item = this.hotbar[this.selected];
    if (!item || !blockForItem(item)) return;
    this.add(item, -1);
    this.changed();
  }

  craft(recipe) {
    if (!canCraft(recipe, this.counts)) return;
    for (const id in recipe.in) this.add(id, -recipe.in[id]);
    this.add(recipe.out.id, recipe.out.n);
    this.changed();
    this.toast(`Crafted ${ITEMS[recipe.out.id].name}`);
  }

  // Game-mode change: show/hide the infinite creative palette, then refresh.
  refreshMode() {
    this.invPaletteEl.style.display = this.player.creative ? "" : "none";
    document.body.classList.toggle("creative", this.player.creative); // two-col only in creative
    this.changed();
  }

  // The inventory panel opened/closed; render its grids when it opens so they
  // reflect anything collected/crafted while it was closed.
  setPanelOpen(open) {
    this.panelOpen = open;
    if (open) {
      this.invPaletteEl.style.display = this.player.creative ? "" : "none";
      this.renderPanel();
    }
  }

  // ---- internals ----

  add(id, n) { this.counts.set(id, Math.max(0, (this.counts.get(id) || 0) + n)); }

  // The single "inventory changed" path: sync what the player holds, re-render
  // the hotbar, and (only if visible) the panel. Replaces the old scattered calls.
  changed() {
    this.syncHeld();
    this.renderHotbar();
    if (this.panelOpen) this.renderPanel();
  }

  // Sync the player's held tool/placeable to the selected slot. Creative wields
  // freely; survival only lets you use an item you actually have a count of.
  syncHeld() {
    const item = this.hotbar[this.selected];
    const have = this.player.creative || this.count(item) > 0;
    this.player.toolInfo = have ? toolStats(item) : null;
    this.player.placeId = have ? (blockForItem(item) ?? 0) : 0;
  }

  renderHotbar() {
    this.renderSlots(this.hotbarEl, false);
    this.renderSlots(this.invHotbarEl, true);
  }

  renderPanel() { this.renderItems(); this.renderCrafting(); }

  applySelection() {
    [this.hotbarEl, this.invHotbarEl].forEach((el) =>
      [...el.children].forEach((c, i) => c.classList.toggle("selected", i === this.selected)));
  }

  assignToSelected(id) { this.hotbar[this.selected] = id; this.changed(); }

  // Render the 9 hotbar slots into `el`. Clicking any slot selects it; when
  // clickable (the inventory copy), right-clicking a slot clears it.
  renderSlots(el, clickable) {
    el.innerHTML = "";
    this.hotbar.forEach((id, i) => {
      const def = id != null ? ITEMS[id] : null;
      const slot = document.createElement("div");
      slot.className = "slot" + (i === this.selected ? " selected" : "");
      if (def) slot.appendChild(this.atlas.iconCanvas(def.tile, 38));
      const num = document.createElement("span");
      num.className = "num"; num.textContent = i + 1; slot.appendChild(num);
      if (def) {
        const label = document.createElement("span");
        label.className = "label"; label.textContent = def.name; slot.appendChild(label);
      }
      // Survival: show the stack count and grey out depleted slots.
      if (def && !this.player.creative) {
        const c = this.count(id);
        if (c === 0) slot.classList.add("empty");
        const badge = document.createElement("span");
        badge.className = "count"; badge.textContent = c; slot.appendChild(badge);
      }
      slot.addEventListener("click", () => this.select(i, true));
      if (clickable) {
        slot.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.hotbar[i] = null;
          this.changed();
        });
      }
      el.appendChild(slot);
    });
  }

  // Creative palette: one cell per item; click assigns it to the selected slot.
  buildPalette() {
    this.invGridEl.innerHTML = "";
    Object.keys(ITEMS).forEach((id) => {
      const def = ITEMS[id];
      const cell = document.createElement("div");
      cell.className = "inv-item"; cell.title = def.name;
      cell.appendChild(this.atlas.iconCanvas(def.tile, 34));
      const name = document.createElement("span");
      name.className = "inv-name"; name.textContent = def.name; cell.appendChild(name);
      cell.addEventListener("click", () => this.assignToSelected(id));
      this.invGridEl.appendChild(cell);
    });
  }

  // Survival store: the items you've actually collected, with counts.
  renderItems() {
    this.invItemsEl.innerHTML = "";
    const entries = [...this.counts.entries()].filter(([, n]) => n > 0);
    this.invItemsEmptyEl.style.display = entries.length ? "none" : "";
    for (const [id, n] of entries) {
      const def = ITEMS[id]; if (!def) continue;
      const cell = document.createElement("div");
      cell.className = "inv-item"; cell.title = def.name;
      cell.appendChild(this.atlas.iconCanvas(def.tile, 34));
      const cnt = document.createElement("span");
      cnt.className = "inv-count"; cnt.textContent = n; cell.appendChild(cnt);
      cell.addEventListener("click", () => this.assignToSelected(id));
      this.invItemsEl.appendChild(cell);
    }
  }

  renderCrafting() {
    this.invCraftingEl.innerHTML = "";
    for (const recipe of RECIPES) {
      const out = ITEMS[recipe.out.id];
      const craftable = canCraft(recipe, this.counts);
      const row = document.createElement("div");
      row.className = "inv-recipe" + (craftable ? " craftable" : "");
      row.appendChild(this.atlas.iconCanvas(out.tile, 30));
      const o = document.createElement("span");
      o.className = "r-out"; o.textContent = out.name + (recipe.out.n > 1 ? " ×" + recipe.out.n : "");
      row.appendChild(o);
      const ins = Object.keys(recipe.in).map((id) => `${ITEMS[id]?.name ?? id} ×${recipe.in[id]}`).join(", ");
      const inEl = document.createElement("span");
      inEl.className = "r-in"; inEl.textContent = "needs " + ins; row.appendChild(inEl);
      if (craftable) row.addEventListener("click", () => this.craft(recipe));
      this.invCraftingEl.appendChild(row);
    }
  }
}
