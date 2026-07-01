# Terra Nova — Multiplayer architecture plan

Multiplayer was a founding requirement. End state = **Minecraft-like**: an
authoritative server that clients connect to over **LAN and the internet**, with
single-player as an **integrated server** running in-process. This doc plans the
work; see [ROADMAP.md](./ROADMAP.md) for status.

## Guiding pattern: the integrated server

There is **one** authoritative server implementation. It runs in three contexts:

- **Single-player** → in-process (the browser hosts itself). No backend; stays a
  static site.
- **LAN** → someone runs the server process; others connect over the local network.
- **Central / internet** → the same server, deployed somewhere; clients connect by
  address.

Consequence: the server must run **headless (Node, no Three.js / no DOM)**. So the
core architectural work is **splitting the simulation from the rendering** — which
is also the engine/client separation the "pluggable base" has always wanted.

## The boundary

**Sim core** — authoritative world state + simulation + the tick. Runs in Node
*and* the browser. **No `three`, no DOM.**

**Client** — rendering, input, UI. Runs only in the browser (`three` + DOM). Reads
sim state to draw it; sends *intents* to the server.

### Module split

| Module | Today | Becomes |
|---|---|---|
| `blocks`, `light`, `noise`, `biomes`, `items`, `recipes`, `raycast`, `profiler`, `version` | pure | **sim** — no change |
| `chunk.js` | data/light/meta storage **+** meshing (Three) | **sim**: storage + `computeLight`. **client**: extract meshing → `mesher.js` |
| `world.js` | chunks/gen/water/edits/light-orchestration/get·set (sim) **+** materials/meshes/scene (Three) | **sim**: `World`. **client**: `world-renderer.js` (materials, per-chunk meshes, atlas) |
| `entity.js` | physics/AI (sim) **+** meshes (Three) | **sim**: entity simulation. **client**: entity renderer (meshes synced from positions) |
| `player.js` | physics/collision/raycast/mining/placement (sim) **+** camera/highlight/crack (Three) | **sim**: `player-sim` (physics + action intents — runs client-side for *prediction* and server-side for *authority*). **client**: camera + highlight/crack |
| `sky.js` | time `t` + brightness (sim value) **+** sun/moon/stars/uniforms (Three) | **sim**: time-of-day value (tiny). **client**: sky renderer |
| `textures.js` | atlas (Three) | **client** |
| `main`, `inventory`, `keyboard-mouse`, `touch`, `overlays`, `worlds-ui` | DOM/render | **client** |
| `save.js` | localStorage (client persistence of sim data) | **client persistence** now; a server-side persistence seam later |

## Protocol (what crosses the boundary)

Designed to be JSON- or Transferable-serializable, so the *same* messages work
in-process (SP), across a Worker, or over WebSocket — the transport is swappable.

**Client → Server (intents):**
- `input` — move/look/jump/fly/crouch/sprint state
- `place(pos, item)` / `break(pos)` / `selectSlot(i)`
- session: `join`, `leave`

**Server → Client (state):**
- `chunkData(cx, cz, {blocks, light, meta, water})` — typed arrays (Transferable),
  on load / when dirty
- `chunkUnload(cx, cz)`
- `blockChange(pos, id, meta)` — small deltas (or just re-flag the chunk dirty)
- `entities([...])`, `players([...])` — snapshots/deltas of positions & state
- `time(t)`

The client **meshes locally** from the chunk arrays it's sent (needs the atlas UVs,
which are client-side). The server never meshes. Light is **server-authoritative**
(computed in the sim, shipped as arrays) because it needs cross-chunk propagation.

## Phased plan (single-player works at every step)

**Phase 1 — split sim from render** *(same thread, direct calls — no networking yet)*
1. Extract the mesher from `chunk.js` → `mesher.js`; `Chunk` becomes data-only.
2. Extract materials + per-chunk meshes from `world.js` → `world-renderer.js`;
   `World` goes headless.
3. Split `entity.js` → entity-sim + entity-renderer.
4. Split `player.js` → `player-sim` + player-view.
5. Split `sky.js` → time (sim) + sky-renderer.
- **Gate:** every sim module passes `node --check` *and* imports+runs in Node with
  no `three`/DOM. This is the big, front-loaded, highest-risk refactor.

**Phase 2 — integrated server** — wrap the sim in a `Server` (tick loop + action/
query API). The client talks to it through a `LocalConnection` (in-process). SP
behaves identically; the client no longer touches sim internals directly.

**Phase 3 — message boundary + transports** — move the `Server` into a **Web
Worker** for SP (so SP and MP share the *identical* message path), and add a Node
**`server.js`** + `WebSocketConnection`. **LAN works here.** Chunk arrays go as
Transferables.

**Phase 4 — sync + prediction** — join snapshot (seed + edit-diffs, reusing
`SaveManager`), entity/player interpolation, and **client-side prediction +
server reconciliation** for the local player's movement.

**Phase 5 — central hosting** — deploy the Node server; address-based connect;
server-side persistence, rooms/worlds, and auth niceties.

## Key decisions

- **Transport: WebSocket**, not WebRTC (browsers can't do raw TCP; WS is the
  equivalent and serves LAN + central identically). In-process channel for SP.
- **Integrated SP server in a Worker from day one** — forces SP to be a real
  client/server relationship so the boundary can't be cheated.
- **Determinism / authority**: gen from seed (already true); server-authoritative
  light; seedable RNG; tick-based water & entities.
- **Chunk data as Transferable typed arrays** — cheap to sync.
- **Actions as intents through one seam** — also buys SP undo/replay/testability.
- **No build step preserved**: sim runs in Node ESM directly; the client keeps the
  import map for `three`. Sim modules must never `import "three"`.

## Deployment

- **Client**: static site (GitHub Pages) — unchanged.
- **Single-player**: no server (Worker-hosted integrated server) — stays static.
- **Multiplayer**: a separate small Node process — run locally for LAN, deployed
  for central.

## Risks

- **Phase 1 is the risk.** Mitigate by splitting **per system**, keeping SP working
  and verified at each step, and gating on "sim runs in Node."
- **Meshing throughput** when fed over a channel — validate early (phase 3).
- **Prediction/reconciliation jank** — expected; iterative (phase 4).
