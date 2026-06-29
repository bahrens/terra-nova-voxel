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
  - **Status: increments 1–4 done** (skylight, block light/torches, cross-chunk
    propagation, incremental edit relighting). Block edits now relight only the
    affected cells via a two-phase remove/add BFS in `light.js` (fuzz-tested vs
    full recompute over ~1.6k random edits) and remesh just the touched chunks.
    Streaming/chunk-load still uses full `computeLight` + the relight queue
    (time-budgeted; an optional further optimisation). Remaining gap: torch
    placement isn't support-validated (you can place a floating torch; it's only
    removed when its support is dug out — see the proper/wall-torch polish item).
  - **Increment 5 — smooth lighting (done):** the mesher now averages sky/block
    light *per vertex* over the 2×2 corner neighbourhood (reusing the AO samples)
    instead of one flat value per face, so the GPU interpolates a gradient — fixes
    the "blocky" per-face look (we were effectively "Minecraft Smooth Lighting:
    OFF"). The averaging is Minecraft-accurate: solid/hidden corner cells count
    as light 0 over a fixed ÷4, so the **AO darkening lives in the light average
    itself** (no separate AO multiply). An earlier version excluded solids and
    applied a separate AO term, which made concave corners ~2× too bright (inside
    edges "lit up"); fixed.
  - **Light curve (done):** the shader applies a multiplicative falloff (each
    level ≈0.8× the previous) per channel in level-space, dimming skylight by
    day/night *after* the curve so day (1.0) and night (0.26) surface brightness
    are unchanged while torch light rolls off naturally and shadow edges deepen.
    The 0.8 base is the tuning knob (higher = gentler/brighter falloff).
- [~] ⭐ **Entities** — a generic entity system where **player, mobs, dropped
      items, and projectiles are all entities**. Build this general, not as
      "mobs" narrowly, or it gets redone. (Mobs = AI/spawning on top.)
      *Increment 1 done (`js/entity.js`):* an `Entity` base with AABB voxel
      physics (gravity + axis-separated collision, mirroring the player) and an
      `EntityManager` that ticks the list and manages meshes. First concrete type
      is `ItemEntity` — breaking a block drops a small spinning cube that falls,
      settles, and is vacuumed to the player when near (proves the framework and
      seeds the mining→drops→inventory chain). *Known gaps / next:* drops aren't
      persisted in saves yet (transient); item cubes render full-bright (no world
      light) and use the side tile on all faces (plants look like cubes); pickup
      just despawns (no inventory counts until survival). Player isn't refactored
      onto `Entity` yet — its physics is mirrored; unifying is a later cleanup.
- [~] **Items as a first-class concept, distinct from blocks** — *increment 1 done
      (`js/items.js`):* an item registry separate from blocks. Every block gets a
      "block item" (placeable); plus non-block **material items** (coal, iron, gold)
      that can't be placed. Block↔item maps + a per-block **drop table** are the
      seams the game now uses instead of raw block ids: the hotbar/inventory hold
      item ids, placing maps item→block, and breaking a block drops its item
      (stone→cobble, ores→materials, grass→dirt, leaves→nothing). Dropped items
      render as a cube (block items) or a flat card (materials). *Remaining:* tools
      & food item types, stack/count semantics (with survival), and crafting that
      consumes/produces items.
- [~] **Inventory** — *increment 1 done:* a creative block palette (press `E`)
      with a customisable, persisted 9-slot hotbar — pick a slot, click a block to
      assign it, right-click to clear; the layout saves with the world. The hotbar
      is now a mutable array (was a hardcoded list) and any block is reachable, so
      the "9-slot cap / Sandstone dropped" limitation is resolved.
      *Increment 2 done — survival unification:* the hotbar reads the counted
      inventory in **survival** — slots show stack counts, placing **consumes** one
      (depleted slots grey out and can't place), tools/blocks only work if you have
      them, and collecting/crafting refills the held slot live. The infinite
      **creative palette is hidden in survival** (`G` toggles modes). *Remaining:*
      a true multi-slot inventory (multiple stacks per item, drag-and-drop, stack
      splitting) rather than one count-per-item store, and stack-size caps.

### Tier 2 — Core gameplay loop (sandbox → game)

- [~] **Mining mechanics** — *increment 1 done:* per-block **hardness**
      (`blockHardness`, Infinity = unbreakable), **hold-to-break** with progress
      accumulated by hardness, a procedural **crack overlay** that fades in, and
      block→item **drops** on completion (via the items work). A `G` toggle flips
      between survival (hold to mine) and creative (instant break) until the full
      mode system lands. *Increment 2 done — tools:* pickaxe/axe/shovel in wood/
      stone/iron tiers (`items.js`); each block has a preferred tool category +
      min-harvest-tier (`blocks.js`). A matching tool mines its category 2–6× faster
      (by tier), and gated blocks (stone→cobble, ores) only **drop** with a matching
      tool of sufficient tier — wrong/weak tool still breaks them but yields nothing
      (Minecraft-style). Held tool tracked via the hotbar selection. *Remaining:*
      tools should be **earnable** (needs crafting), tool durability, multi-stage
      crack texture, and a break sound (needs audio).
- [~] **Crafting** — *increment 1 done (`js/recipes.js`):* a data-driven recipe
      registry (shapeless for now) + a **counted inventory** (item id → count) fed
      by **picking up drops**, plus a crafting UI in the inventory screen (`E`):
      shows your item counts and the recipe list, craftable rows light up, clicking
      consumes inputs and produces the output. Starter recipes: planks, sticks,
      torches, and the wood/stone/iron tools — so the survival loop *mine → drops →
      collect → craft tools* now closes. Collected/crafted items can be clicked
      onto the hotbar to use them. (Survival placing now **consumes counts** — see
      the Inventory item.) *Remaining:* grid-shaped recipes, and smelting/furnace.
- [ ] **Survival vs creative mode** — the game-mode distinction and the rules that
      hang off it: health, fall damage, drowning, hunger. Also a pluggability
      concern ("game rules" are per-game config). **See open question below.**
- [~] ⭐ **Mobs** — builds on the entity system. *Increment 1 done:* a passive
      wandering "critter" (`MobEntity`) — blocky quadruped with swinging-leg
      animation, idle/stroll AI, hops over 1-block steps when blocked, ambient
      spawning on loaded surfaces around the player (cap 8) and despawn when far.
      Debug `M` spawns one ahead. *Polish done:* critters are now world-lit
      (tinted by local sky/block light + day/night, same curve as the world),
      have a snout/ears/tail, and climb 1-block steps reliably (hop height raised
      so they no longer clip into the step). *Remaining:* day/night + biome spawn
      rules, hostile mobs + smarter AI/pathfinding, save persistence (mobs are
      transient), proper textures (still flat-colour), and combat (needs survival).
      *Known cosmetic (won't-fix for now):* the model (long body + protruding
      snout/head) clips through block edges when passing them, because the hitbox
      is a smaller axis-aligned box — same as Minecraft; the critter never enters
      solid blocks. A tighter hitbox would cause more snagging for little gain.
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

- [ ] **Mobile / touch support** — the game is desktop-only today (pointer-lock +
      keyboard/mouse). Add a touch input layer: virtual move joystick, drag-to-look,
      tap/hold to break + place, and on-screen buttons (jump/fly/inventory/mode),
      plus a touch-friendly responsive UI (the inventory/crafting/hotbar). Ben wants
      to **test on mobile** too, so this matters for the dev loop, not just players.
      Touch the input abstraction now-ish so it doesn't calcify around pointer-lock.

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

- [~] **Performance — in progress.** Profiler (`P`, `js/profiler.js`) added as a
      permanent dev tool (per-section ms, draws, tris, queues, worst-frame hold).
      **Diagnosis (2026-06-29):** two distinct regimes —
      (1) *Flying fast → CPU-bound on meshing* (mesh ~10ms/frame, meshQ ~84, 192ms
      spikes). **Improved:** the mesher now snapshots the chunk + its 1-block border
      into reusable flat arrays once, then meshes from array reads instead of ~38
      cross-chunk Map lookups per face — meshQ now drains far faster (84→36) and
      spikes shrank. Residual: when you out-fly the streamer, all three budgets
      (gen/light/mesh ≈ 4/4/6ms) saturate, so the frame caps ~42fps — but normal
      play doesn't saturate them, so it's not felt in gameplay.
      (2) *Standing still → GPU-bound* (~800k triangles, ~700 draws).
      **Status: paused by choice (2026-06-29)** — current state is fine in normal
      play; the two big levers are documented for when more game elements actually
      stress the frame (mobs/effects/etc.). Pull them then, profiler ready:
      • **Web-worker gen/mesh/light** — raises the streaming ceiling (regime 1).
      • **Greedy meshing** — cuts triangle count (regime 2); smooth-lighting limits
        merges to faces with matching corner light.
- [ ] **Web-worker chunk gen/meshing** — get generation off the main thread before
      worlds get big. Matters more once entities + lighting raise per-frame cost.
      Strongest lever for the 30-fps drops above.
- [ ] **Greedy meshing** — fewer triangles per chunk.
- [ ] **Chunk persistence beyond edits** — full chunk storage if procedural-only
      saves prove limiting.

### Open questions to decide before pluggability

- [x] **Survival vs creative — DECIDED (2026-06-29):** the base game ships **both
      creative and survival** modes. It's only a question of *timing* — survival
      mechanics (health/hunger/stacks/mining-costs) land when sequencing makes
      sense. Build systems mode-agnostic: e.g. items already carry `maxStack` for
      later count semantics; creative ignores counts, survival enforces them.
- [ ] **Multiplayer or not?** Not a feature — an architecture decision that colors
      everything (authoritative server, entity sync, deterministic gen). If *any*
      downstream game might be multiplayer, the engine seams must assume it early.
      *Leaning: in the base.* Decide explicitly when we reach it.

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
- [x] **>9 placeable blocks need a real home** *(fixed)* — the inventory palette
      (`E`) now lets any block be assigned to the 9-slot hotbar, so the digit-key
      cap no longer limits which blocks are reachable. Sandstone (and everything
      else) is placeable again via the inventory. See Tier 1 Inventory.
- [ ] **Proper torch shape + wall mounting** — the torch is a flat cross billboard
      placeholder. Want a real 3D torch post, and the ability to place it on the
      *side* of a block (angled outward), like Minecraft. Depends on the non-cube
      block-shape work (Tier 3) and a placement rule for which faces accept it.
- [ ] **Placeable water is janky** — placing Water from the creative palette
      calls `setBlock`, which makes a WATER block at level 0 (not a source), so it
      renders as a thin non-flowing sliver instead of spreading. Real fix ties to
      placeable water **sources / buckets** and the water-physics/improvements work
      (Tier 3). Quick stopgaps if wanted sooner: make creative water placement
      create a source (level 9) and wake the sim, or filter Water/Bedrock out of
      the palette. Deferred for now.
- [~] **Concave-corner shading** — two parts:
      (a) *Triangular / over-dark corner shadow (fixed):* at an L/concave corner the
      AO contact shadow was a hard, near-black triangle on one block's face, worst
      on light blocks (sand) and at night. Two causes, both fixed in
      `chunk.emitFace`: (1) AO was baked into the light value and then run through
      the steep light curve, crushing shadowed corners from ~0.25 to ~0.08 (~6× too
      dark vs Minecraft's ~0.5) — now AO is a gentle separate multiply (0.5–1.0)
      applied *after* the curve, with the light average falling back to the face
      cell's light for solid neighbours; (2) the quad-triangulation flip was
      inverted (0fps AO-anisotropy rule), trapping a lone dark corner in one
      triangle — now corrected so the shadow spreads smoothly.
      (b) *No visible edge between adjacent blocks (open):* coplanar same-texture
      faces still blend into one surface, so a stack/pile of blocks lacks per-block
      definition. Future: subtle per-block contact/edge darkening, more inter-tile
      texture variation, or a faint cube outline.
- [ ] **Visual polish pass (future)** — a dedicated shading/look-and-feel sweep
      once gameplay systems are further along. Candidates: the per-block edge
      definition above, AO depth/curve tuning, mob + dropped-item textures (both
      flat-colour/single-tile now), water rendering, and overall colour/contrast.
      Deferred by choice — current look is "good for now" (Ben, 2026-06-29).
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
