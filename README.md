# Terra Nova

A browser-based, Minecraft-style voxel sandbox built with vanilla JavaScript and [Three.js](https://threejs.org/). Procedurally generated 3D terrain, biomes, caves, and flowing water — no build step and no image assets (textures are drawn at runtime).

## How to run

The game uses native ES modules, so it must be served over HTTP (opening `index.html` directly via `file://` won't work). Three.js is **vendored** in `vendor/`, so there's nothing to `npm install`.

Pick any static file server:

**Node (recommended):**
```bash
npm start          # runs: npx serve -l 5173 .
```

**Python 3:**
```bash
python -m http.server 5173
```

Then open **http://localhost:5173/** and click **Play**.

> Tip: if you change files, hard-refresh the tab (Ctrl/Cmd+Shift+R) so the browser reloads the modules.

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | Mouse |
| Jump | `Space` |
| Sprint | `Shift` |
| Break block | Left click |
| Place block | Right click |
| Select block | `1`–`9` or scroll wheel |
| Toggle fly | `F` |
| Fly up / down | `Space` / `Shift` |
| Fast fly (while flying) | double-tap `W` |
| Fast-forward time | hold `T` |
| Pause / menu | `Esc` |

## Features

- **3D density terrain** — mountains, cliffs, and overhangs (no contour terracing).
- **Biomes** — ocean, beach, desert, plains, forest, savanna, tundra, mountain, each data-driven.
- **Caves** — winding tunnels and caverns with natural surface entrances; ores by depth.
- **Water** — flood-filled oceans/lakes, an underwater tint, and a flowing simulation (gravity, spread, drain, reflow when you dig).
- **Procedural textures** — every block tile is drawn to a canvas at runtime (zero image files).

## Project layout

```
index.html        # entry + import map (points at vendored Three.js)
styles.css        # HUD, menu, crosshair, hotbar
js/
  main.js         # renderer, HUD, pointer lock, main loop
  world.js        # chunk streaming, terrain/biome/cave gen, water sim
  chunk.js        # voxel storage + mesher (face culling, AO, water)
  player.js       # controls, physics/collision, block raycast
  blocks.js       # block + biome-block registry
  biomes.js       # data-driven biome definitions
  textures.js     # procedural texture atlas
  noise.js        # Perlin / fBm / ridged noise
vendor/
  three.module.js # pinned Three.js build (no install needed)
```

## License

MIT
