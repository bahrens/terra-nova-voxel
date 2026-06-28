# Terra Nova — Vision & Roadmap

> The planning doc that should never live only in a chat window again.
> Keep this current as priorities change. If we decide something, it goes here.

## Vision

1. **Build a solid Minecraft-like voxel game** as the base — terrain, biomes,
   caves, water, day/night, building, saving. This is the reference game and it
   needs to be genuinely fun/complete on its own.
2. **Turn the base into a foundation for *other* voxel games.** The long-term
   goal is to build multiple distinct voxel games on top of the same core, not
   just one Minecraft clone.
3. **Make it pluggable** once the base game is in place. Refactor the core so
   game-specific content (blocks, biomes, entities, rules, generation) is data /
   plugins layered over a reusable engine, rather than hard-coded into it.

### Sequencing principle

Finish the base game *first*, then extract the engine. We deliberately do **not**
build the plugin architecture up front — we let the base game tell us where the
seams should be. Data-driven registries that already exist (`blocks.js`,
`biomes.js`, the procedural texture atlas) are early seeds of that pluggability.

## Current status

Where things stand (see `git log` for specifics):

- ✅ Procedural 3D density terrain, biomes, caves, ores
- ✅ Flood-filled water + a flowing water simulation
- ✅ Procedural runtime texture atlas (no image assets)
- ✅ Day/night cycle with sun/moon/stars and brightness-based "lighting"
- ✅ First-person controls, collision, block break/place, fly mode
- 🔄 **Save / load** — localStorage edit-diff saves (seed + edits + position +
  time). This is the feature we were actively working on. See
  [Save state](#save-state-in-progress) for status and open threads.

## In progress

### Save state (in progress)

Implemented: localStorage save storing `{ seed, player, sky.t, edits }`,
auto-save every 15s + on tab hide/close, manual save (`K`), New World wipe.
Edits are stored as a per-chunk diff over procedural terrain so saves stay small.

Open threads / things to decide (FILL IN — partly reconstructed, confirm):
- [ ] Multiple named save slots vs. the single `terra-nova-save` key?
- [ ] Save-format versioning / migration story (there's a `version: 1` field but
      no migration path yet).
- [ ] Edit-diff compaction — re-placing then breaking a block leaves a redundant
      AIR entry; long sessions bloat the save.
- [ ] localStorage ~5MB quota — at what point do we move to IndexedDB?
- [ ] Should water-sim state persist, or always re-settle from the flood-fill on
      load? (Currently re-settles.)

## Base-game feature plan

The full set of work to get a credible Minecraft-like base game *before* the
engine/content split. Ordered into tiers by how foundational each piece is — a
feature earns a place in the base when building it forces a seam every downstream
voxel game should share. (Brainstormed 2026-06-28; reconstructs + extends the
lost short list. Items the original list explicitly named are marked ⭐.)

### Tier 1 — Foundational systems (define the seams; hard to retrofit)

- [ ] ⭐ **Lighting** — real block-light + skylight propagation, replacing today's
      global brightness scalar. Deep `chunk.js` change; torches are a *consumer*.
      **Design (decided 2026-06-28):**
  - Two channels per voxel: *skylight* (from open sky, dimmed by day/night) and
    *block light* (torches, constant). Surface brightness = `max(blockLight,
    skyLight × dayFactor)`, Minecraft-style. Stored packed one byte/voxel
    (hi nibble sky, lo nibble block) in a per-chunk `light` buffer.
  - **Day/night must not require re-meshing.** So the mesher encodes the vertex
    `color` attribute as `r = AO×face-shading` (static), `g = skyLight`,
    `b = blockLight`, and a small `onBeforeCompile` patch on the materials makes
    the fragment shader compute `tex × r × max(b, g × uSky)` with `uSky` a single
    uniform driven by `sky.js`. Day/night becomes a per-frame uniform update, zero
    re-meshing; torches stay constant through the night.
  - **Increments:** (1) light buffer + skylight BFS + mesher/shader plumbing;
    (2) block light + a TORCH block (emitter) in the hotbar; (3) cross-chunk
    propagation + relight on neighbour load (kill border seams); (4) incremental
    relight on edits instead of whole-chunk recompute.
  - Increments 1–2 are chunk-local (border seams accepted, like early AO/water);
    3 fixes seams, 4 is the perf pass. **Status: increments 1–2 done (skylight +
    block light/torches); 3–4 pending.** Known gaps: torch placement isn't
    validated for support (you can place a floating torch; it's only removed when
    its support is dug out), and block light doesn't cross chunk borders yet.
- [ ] ⭐ **Entities** — a generic entity system where **player, mobs, dropped
      items, and projectiles are all entities**. Build this general, not as
      "mobs" narrowly, or it gets redone. Greenfield. (Mobs = AI/spawning on top.)
- [ ] **Items as a first-class concept, distinct from blocks** — an item registry
      separate from the block registry (tools, food, materials, "block items").
      The single most important missing abstraction: inventory, crafting, drops,
      and mining all depend on it. Today *everything is a block*.
- [ ] **Inventory** — stacks/slots model, hotbar as a view into it, picking up
      dropped items. Prerequisite for survival, crafting, and mining-with-drops.

### Tier 2 — Core gameplay loop (sandbox → game)

- [ ] **Mining mechanics** — block hardness, break time, breaking animation/
      progress, and **blocks dropping items**. Today break is instant + yields
      nothing. Pairs with **tools** (pickaxe/axe/shovel tiers).
- [ ] **Crafting** — a **recipe registry** (crafting grid + smelting/furnace).
      Textbook pluggability seam — a data-driven table each downstream game redefines.
- [ ] **Survival vs creative mode** — the game-mode distinction and the rules that
      hang off it: health, fall damage, drowning, hunger. Also a pluggability
      concern ("game rules" are per-game config). **See open question below.**
- [ ] ⭐ **Mobs** — spawning rules (day/night), simple AI, pathfinding, despawn,
      save persistence. Builds on the entity system.
- [ ] **Combat** — attacking entities, mob health, knockback. Follows entities +
      survival.
- [ ] ⭐ **Torches** — placeable light emitters; consume the lighting system.
      Likely need the block-shape work below (wall-attached).

### Tier 3 — World & physics depth

- [ ] **Non-cube block shapes** — slabs, stairs, fences, attached torches. The
      mesher only knows full cubes + cross-quads today; this needs a block-shape/
      model abstraction settled before pluggability.
- [ ] **Block physics** — gravity-affected blocks (falling sand/gravel).
- [ ] **Plant placement & growth rules** — data-driven properties for what each
      plant can grow/be placed on (valid ground block types) and which biomes it
      appears in. Today decoration only rolls per-biome plant tables (`biomes.js`)
      with no ground-type constraint, and the player can place a plant on anything.
      Extend to a per-plant `growsOn` block-type list + biome filter, enforced in
      both generation (`World.decorate`) and player placement. Sibling of the
      `needsSupport` rule — both are "block placement constraint" data — and sets
      up later plant growth/spread over time.
- [ ] **Player water-physics** — today water isn't solid so the player **falls
      straight through it**: no swimming, buoyancy, or drowning. Add swim movement,
      buoyancy, slower speed, and a breath meter (ties into survival). This is a
      real gap independent of the flow-sim question below.
- [ ] ⭐ **Water basin filling** *(the recalled "water improvements" item)* — flow
      sim filling depressions/basins properly (e.g. player-placed or drained water
      settling to fill an enclosed basin, not just sea-connected flood). **Ben's
      recollection; not sure it's actually needed — revisit before scheduling.**

### Tier 4 — Presentation & shell

- [ ] **Audio** — there is currently **zero sound**. Block break/place, footsteps,
      ambient, mob sounds, music. Its own system/seam.
- [ ] **Multiple worlds + world-select UI** — today it's one hardcoded
      `localStorage` slot. Need a world list, create/delete, naming.
- [ ] **Seed input on world creation** — let the player type a seed for a
      reproducible world (and show the current world's seed). Today "New World"
      picks a random seed with no way to choose or view it. Pairs with the
      world-select UI above.
- [ ] **Settings menu** — render distance, mouse sensitivity, volume, FOV.
- [ ] **UI surfaces** — inventory screen, death/respawn screen, pause polish.

### Tier 5 — Tech foundation (enables scale; invisible to players)

- [ ] **Web-worker chunk gen/meshing** — get generation off the main thread before
      worlds get big. Matters more once entities + lighting raise per-frame cost.
- [ ] **Greedy meshing** — fewer triangles per chunk.
- [ ] **Chunk persistence beyond edits** — full chunk storage if procedural-only
      saves prove limiting.

### Open questions to decide before pluggability

Current lean (2026-06-28): **likely both survival and multiplayer in the base.**
Not final — we'll make the call when we get there, but plan seams as if both are in.

- [ ] **Multiplayer or not?** Not a feature — an architecture decision that colors
      everything (authoritative server, entity sync, deterministic gen). If *any*
      downstream game might be multiplayer, the engine seams must assume it early.
      *Leaning: in the base.* Decide explicitly when we reach it.
- [ ] **Does survival live in the base game, or is it a pluggable game on top?**
      I.e. is the base a creative sandbox with survival built on top, or does the
      base ship survival mechanics? *Leaning: survival in the base.* Final call
      deferred; affects Tier 2 priorities.

## Bugs & polish

- [x] **Floating plants** *(fixed)* — small cross-plants (tall grass, flowers,
      dead bush) no longer float when the block beneath them is dug out. Added a
      per-block `needsSupport` flag; `World.setBlock` clears unsupported blocks
      above an edit, recursing upward. Larger flora (cactus, logs) opt out and
      stay put by design. A future "block support" / block-physics pass can
      generalise this.
- [ ] **Block-destroy effects** — spawn particle/effect bursts when a block breaks
      (and likely a place effect + sound). Pairs naturally with the entity/particle
      work and audio. A reusable particle system is the real deliverable here.
- [ ] **Hotbar must stay 9 slots** — the hotbar maps to digit keys `1`–`9`, so it
      caps at 9. The torch currently overflows to a 10th slot (scroll-only) — not
      acceptable long-term. Need a real strategy for >9 placeable blocks: a full
      inventory with the hotbar as a 9-slot view (preferred — see Tier 1
      Inventory), or hotbar paging/categories. Until then keep the hotbar at 9.
- [ ] **Proper torch shape + wall mounting** — the torch is a flat cross billboard
      placeholder. Want a real 3D torch post, and the ability to place it on the
      *side* of a block (angled outward), like Minecraft. Depends on the non-cube
      block-shape work (Tier 3) and a placement rule for which faces accept it.
- [ ] **See-through flicker on block break** — for a fraction of a second after
      breaking a block you can see through the world until the chunk remesh lands.
      Cause: the edit marks the chunk dirty but the remesh runs later, behind the
      time-sliced mesh budget, so newly-exposed neighbour faces aren't drawn for a
      frame or two. Fix: remesh player-edited chunks immediately/synchronously (or
      at top priority, same frame) so there's no gap — edits are rare and local, so
      this won't blow the frame budget the way bulk streaming would.

## Engine/content split (the pluggability milestone)

The destination, not a near-term task. Extract a reusable core from game-specific
data and define the plugin/mod API surface. Existing data-driven registries
(`blocks.js`, `biomes.js`, `textures.js`) are the seeds. The base-game tiers above
are what prove the remaining seams (items, entities, recipes, light, block shapes,
game rules) before we freeze them into an API.

## How we work / conventions

- Vanilla JS, ES modules, **no build step**. Three.js is vendored in `vendor/`.
- Keep modules small and single-purpose; comments explain the *why*.
- Prefer data-driven registries over hard-coded logic — it pays off at the
  pluggability stage.
- **When we decide a plan, write it here.** Don't let the roadmap live only in a
  conversation.

---
*Last meaningful update: 2026-06-28. Reconstructed after a lost planning session —
sections marked NEEDS DETAIL need Ben's input to be authoritative.*
