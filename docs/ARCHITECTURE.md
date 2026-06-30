# Terra Nova — Architecture

A snapshot of how the base game is built today. This is the surface the future
"pluggable engine" will be carved out of, so it's worth keeping current. For
*where we're going*, see [ROADMAP.md](./ROADMAP.md).

## Stack

- Vanilla JS + ES modules, served statically. **No build step.**
- [Three.js](https://threejs.org/) vendored in `vendor/three.module.js` (pinned,
  no `npm install`). Wired via an import map in `index.html`.
- Zero image assets — every texture is drawn to a canvas at runtime.

## Module map

```
index.html        entry + import map (points at vendored Three.js)
styles.css        HUD, menu, crosshair, hotbar, inventory, touch, underwater overlay
js/
  main.js         entry: renderer, main loop, play/menu state machine, save/load, fog
  inventory.js    hotbar + creative palette + survival store + crafting (HUD + panel)
  world.js        chunk streaming, terrain/biome/cave gen, water sim, light orchestration, edit diffs
  chunk.js        voxel storage + per-block light (BFS) + mesher (face cull, AO, water heights)
  light.js        pure sky/block light propagation (accessor-driven; shared by chunk + world)
  player.js       FPS controls, AABB collision, DDA raycast, mining/placement, input
  blocks.js       block registry (data-driven) + helpers (isSolid/isOpaque/…)
  items.js        item/tool registry, block<->item mapping, drop tables
  recipes.js      crafting recipe registry + canCraft()
  entity.js       Entity/ItemEntity/MobEntity + EntityManager (drops, critters)
  biomes.js       biome registry (data-driven) + pickBiome()
  textures.js     procedural texture atlas + hotbar icon canvases
  noise.js        seedable Perlin + fBm + ridged noise
  sky.js          day/night cycle, sun/moon/stars, brightness scaling
  profiler.js     EMA per-section frame timings (toggleable overlay)
  touch.js        mobile touch controls (joystick, look pad, action buttons)
  version.js      build stamp (shown in menu/debug; overwritten at deploy)
vendor/three.module.js
```

## Key concepts

### Coordinates & storage
- `CHUNK_SIZE = 16`, `WORLD_HEIGHT = 112`, `WATER_LEVEL = 26` (`chunk.js`).
- A chunk is a `Uint8Array` of block ids, plus a parallel `Uint8Array` water-level
  field (0 none, 1–8 flowing, 9 source). Index: `x + SIZE*z + SIZE*SIZE*y`.
- `World` owns a `Map` of `"cx,cz" -> Chunk` and exposes world-space
  `getBlock/setBlock/getWaterLevel`.

### Generation pipeline (`world.js generateChunk`)
1. Per column: `baseHeight` (domain-warped 2D fBm + ridged mountains) gives a
   target surface; a 3D density field (`terrainSolid`) sculpts cliffs/overhangs
   around it; `caveAt` carves spaghetti tunnels + cheese caverns.
2. Material assignment is top-down and sky-aware: only the first sky-exposed run
   gets grass/subsurface; shadowed rock stays bare and may become ore.
3. `decorate` places trees/cacti/plants from the biome config.
4. `floodWater` — world-space BFS filling air connected to the open sea across
   chunk borders. `capIce` freezes surface water in freezing biomes.
5. `applyEdits` overlays the player's saved diffs for that chunk.

### Streaming (`world.js update`)
- Time-sliced: bounded ms budget for gen and for meshing per call, so no single
  frame stalls. Nearest-first ordering.
- Meshing waits until **all 8 neighbours exist** (`neighborsReady`) so border
  ambient-occlusion samples don't bake dark seams.
- Distant chunks unload (geometry disposed); `editsByChunk` survives unload.

### Meshing (`chunk.js buildGeometry`)
- Per-face culling against opaque neighbours; separate buffers for
  `opaque` / `foliage` (cross-quads, alpha-tested) / `water`.
- Ambient occlusion baked into vertex colours; quad triangulation flips along the
  AO gradient. Fake directional light per face direction.
- Water cells mesh with level-based surface heights (tapered flow, surface dip,
  exposed "step" faces).

### Lighting
- Per-voxel light is stored as packed nibbles (sky light + block light) and
  propagated by BFS. `light.js` is pure and accessor-driven; `chunk.js
  computeLight` runs it chunk-local, and `world.js` re-lights incrementally on
  edits. Smooth (per-vertex) light is baked into the mesh, and the world
  material's shader (patched via `onBeforeCompile`) scales by light × a
  time-of-day sky brightness. Wall/3D torches are the next lighting item.

### Player edits & saving
- Every break/place is recorded in `editsByChunk` (`"cx,cz" -> Map("x,y,z" -> id)`).
- Saves serialize only `{ seed, player, sky.t, edits }` to localStorage — small,
  because terrain is regenerated from the seed and only the diff is stored.

## Data-driven seams (relevant to pluggability)

These are already config rather than logic, and are the natural starting points
for the future engine/content split:

- **`blocks.js`** — `BLOCK` ids + `BLOCKS` definitions (faces, solid/opaque/
  transparent/liquid, render type). Add a block by adding data.
- **`biomes.js`** — `BIOME` registry; each biome is pure config (surface,
  subsurface, decorations, tree/plant tables). `pickBiome` is the only logic.
- **`textures.js`** — `TILE_PAINTERS` registry of per-tile canvas painters.

Still hard-coded (would need abstraction for true pluggability): terrain
generation constants and pipeline, the hotbar contents, controls, and the main
loop wiring in `main.js`.

## Refactoring roadmap (SRP & pluggability)

A 2026-06 responsibility review found the **data layer already in good shape** —
`blocks`, `items`, `recipes`, `biomes`, `noise`, `light`, `sky` are clean,
single-purpose, and mostly data-driven. The debt is concentrated in three "god
files" plus one missing seam.

**God files (too many responsibilities):**
- `main.js` (~600 → being trimmed): engine bootstrap + main loop + HUD/menu DOM +
  save/load + input + state machine. No engine/game/UI boundary, and there was no
  "state changed" event, so each action hand-called a scatter of UI refreshers
  (this bred the prof-init regression).
- `world.js` (~810, 9 concerns): terrain gen + water sim + decoration +
  meshing/light orchestration + materials + save, all fused.
- `player.js` (~350, 8 concerns): input + camera + physics + raycast + mining +
  placement + interaction meshes.

**Tiered plan** — extract for *real* seams, not maximal decomposition. The right
pluggable interface only reveals itself with a second consumer, so keep the data
registries data-driven now but defer engine-vs-game interfaces until we actually
build a second variant.

- **Tier 1 — soon, cheap, kills active fragility:**
  - ✅ `inventory.js` — hotbar/palette/store/crafting extracted from `main.js`
    behind a single internal `changed()` path (replaces the scattered refreshers).
  - ☐ `SaveManager` — pull localStorage save/load out of `main.js`; a natural
    place for a game to declare what it serializes.
  - ☐ `raycast` — extract the DDA voxel traversal from `player.js` into a reusable
    util.
- **Tier 2 — when it next bites:**
  - ☐ Unify input (`player.js` listeners + `main.js` keydown + `touch.js`) into one
    input layer.
  - ☐ Pull the debug/profiler overlay rendering out of `main.js`.
- **Tier 3 — defer until a real second use case (avoid premature abstraction):**
  - ☐ `world.js` → injectable `TerrainGenerator` / `FluidSimulator` / decorator.
  - ☐ Entity/mob registry + data-driven spawn/AI configs.
  - ☐ Ore tables, configurable noise registry, material/shader plugin.

---
*Keep this in sync with the code. If a refactor moves a seam, update this doc.*
