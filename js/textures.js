// Procedurally generated texture atlas. Every block tile is drawn pixel-by-pixel
// onto one canvas so the game ships with zero image assets.
import * as THREE from "three";

const TILE = 16;          // pixels per tile
const ATLAS_TILES_X = 8;  // tiles per row

// Deterministic per-tile pseudo-random so textures look the same each run.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, amt) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (hex & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// Painters: each fills one 16x16 tile. (ctx, x0, y0) is the tile origin.
const PAINTERS = {
  noisy: (base, spread) => (ctx, x0, y0, rng) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        ctx.fillStyle = shade(base, Math.floor((rng() - 0.5) * spread));
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
  },
};

function fillNoisy(ctx, x0, y0, rng, base, spread = 26) {
  PAINTERS.noisy(base, spread)(ctx, x0, y0, rng);
}

const TILE_PAINTERS = {
  stone:   (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0x8a8a8d, 22),
  dirt:    (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0x8a5a36, 26),
  sand:    (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0xe0d29a, 18),
  bedrock: (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0x474747, 40),
  plank: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0xb1854c, 16);
    ctx.fillStyle = "rgba(90,60,28,.55)";
    for (let y = 0; y < TILE; y += 4) ctx.fillRect(x0, y0 + y, TILE, 1);
    ctx.fillRect(x0 + 7, y0, 1, TILE);
  },
  cobble: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x7c7c7c, 30);
    ctx.fillStyle = "rgba(40,40,40,.6)";
    ctx.fillRect(x0, y0 + 5, TILE, 1);
    ctx.fillRect(x0, y0 + 11, TILE, 1);
    ctx.fillRect(x0 + 8, y0, 1, 5);
    ctx.fillRect(x0 + 4, y0 + 6, 1, 5);
    ctx.fillRect(x0 + 11, y0 + 12, 1, 4);
  },
  grass_top: (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0x5fae42, 24),
  grass_side: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x8a5a36, 26);          // dirt base
    for (let x = 0; x < TILE; x++) {                     // grassy lip
      const h = 3 + Math.floor(rng() * 4);
      for (let y = 0; y < h; y++) {
        ctx.fillStyle = shade(0x5fae42, Math.floor((rng() - 0.5) * 24));
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },
  snow:    (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0xf4f8ff, 12),
  snow_side: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x8a5a36, 26);
    for (let x = 0; x < TILE; x++) {
      const h = 4 + Math.floor(rng() * 3);
      for (let y = 0; y < h; y++) {
        ctx.fillStyle = shade(0xf4f8ff, Math.floor((rng() - 0.5) * 12));
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },
  log_top: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0xb9924f, 14);
    ctx.strokeStyle = "rgba(90,62,30,.7)";
    for (let r = 2; r < 8; r += 2) {
      ctx.beginPath();
      ctx.arc(x0 + 8, y0 + 8, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  log_side: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x6e4a26, 18);
    ctx.fillStyle = "rgba(40,26,12,.5)";
    for (let x = 2; x < TILE; x += 5) ctx.fillRect(x0 + x, y0, 1, TILE);
  },
  leaves: (ctx, x0, y0, rng) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        if (rng() < 0.12) { ctx.clearRect(x0 + x, y0 + y, 1, 1); continue; }
        ctx.fillStyle = shade(0x3f8a2e, Math.floor((rng() - 0.5) * 40));
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
  },
  water: (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0x2f6dd0, 14),
  glass: (ctx, x0, y0, rng) => {
    ctx.clearRect(x0, y0, TILE, TILE);
    ctx.strokeStyle = "rgba(200,230,255,.85)";
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, TILE - 1, TILE - 1);
    ctx.strokeStyle = "rgba(200,230,255,.35)";
    ctx.beginPath();
    ctx.moveTo(x0 + 3, y0 + 3); ctx.lineTo(x0 + 7, y0 + 7);
    ctx.moveTo(x0 + 11, y0 + 4); ctx.lineTo(x0 + 13, y0 + 6);
    ctx.stroke();
  },

  // ---- biome blocks ----
  gravel: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x8c8783, 30);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = shade(0x5f5b57, Math.floor((rng() - 0.5) * 20));
      ctx.fillRect(x0 + Math.floor(rng() * 14), y0 + Math.floor(rng() * 14), 2, 2);
    }
  },
  sandstone: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0xddcc8f, 12);
    ctx.fillStyle = "rgba(160,140,90,.5)";
    ctx.fillRect(x0, y0 + 4, TILE, 1);
    ctx.fillRect(x0, y0 + 11, TILE, 1);
  },
  sandstone_top: (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0xe4d49a, 12),
  red_sand: (ctx, x, y, rng) => fillNoisy(ctx, x, y, rng, 0xc06a32, 20),
  cactus_side: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x3f7a36, 14);
    ctx.fillStyle = "rgba(20,60,20,.6)";
    ctx.fillRect(x0 + 1, y0, 1, TILE);
    ctx.fillRect(x0 + TILE - 2, y0, 1, TILE);
    ctx.fillStyle = "rgba(220,240,180,.5)";
    for (let y = 2; y < TILE; y += 4) ctx.fillRect(x0 + 7, y0 + y, 2, 1);
  },
  cactus_top: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x4a8a3e, 12);
    ctx.fillStyle = "rgba(20,60,20,.6)";
    ctx.strokeStyle = "rgba(20,60,20,.6)";
    ctx.strokeRect(x0 + 2.5, y0 + 2.5, TILE - 5, TILE - 5);
  },
  coal_ore: oreTile(0x2b2b2b),
  iron_ore: oreTile(0xb08a6a),
  gold_ore: oreTile(0xf4d24a),
  ice: (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0xa9d6ef, 12);
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 11); ctx.lineTo(x0 + 9, y0 + 4);
    ctx.moveTo(x0 + 8, y0 + 14); ctx.lineTo(x0 + 14, y0 + 9);
    ctx.stroke();
  },

  // ---- cross-shaped plants (transparent background) ----
  tall_grass: (ctx, x0, y0, rng) => {
    ctx.clearRect(x0, y0, TILE, TILE);
    for (let x = 1; x < TILE - 1; x++) {
      if (rng() < 0.45) continue;
      const h = 5 + Math.floor(rng() * 7);
      for (let y = 0; y < h; y++) {
        ctx.fillStyle = shade(0x5fae42, Math.floor((rng() - 0.5) * 44));
        ctx.fillRect(x0 + x, y0 + (TILE - 1 - y), 1, 1);
      }
    }
  },
  flower_red: flowerTile("#d6453b"),
  flower_yellow: flowerTile("#e8c33a"),
  dead_bush: (ctx, x0, y0, rng) => {
    ctx.clearRect(x0, y0, TILE, TILE);
    const cx = x0 + 8;
    ctx.fillStyle = "#6e4f24";
    for (let y = 4; y < TILE - 1; y++) ctx.fillRect(cx, y0 + y, 1, 1);
    const twig = [[-2, 8], [-3, 7], [2, 9], [3, 8], [-1, 5], [1, 4], [-3, 10], [3, 11]];
    for (const [dx, dy] of twig) ctx.fillRect(cx + dx, y0 + dy, 1, 1);
  },
};

// Stone base with coloured ore speckles.
function oreTile(spec) {
  return (ctx, x0, y0, rng) => {
    fillNoisy(ctx, x0, y0, rng, 0x8a8a8d, 22);
    for (let i = 0; i < 6; i++) {
      const bx = x0 + 1 + Math.floor(rng() * 12);
      const by = y0 + 1 + Math.floor(rng() * 12);
      ctx.fillStyle = spec;
      ctx.fillRect(bx, by, 2, 2);
      ctx.fillRect(bx + 1, by + 2, 1, 1);
    }
  };
}

// Green stem with a coloured blossom on top.
function flowerTile(color) {
  return (ctx, x0, y0, rng) => {
    ctx.clearRect(x0, y0, TILE, TILE);
    const cx = x0 + 8;
    ctx.fillStyle = "#3f8a2e";
    for (let y = 6; y < TILE - 1; y++) ctx.fillRect(cx, y0 + y, 1, 1);
    ctx.fillRect(cx - 1, y0 + 10, 1, 1);
    ctx.fillRect(cx + 1, y0 + 8, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(cx - 2, y0 + 3, 5, 4);
    ctx.fillRect(cx - 1, y0 + 2, 3, 1);
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(cx, y0 + 4, 1, 2);
  };
}

export class TextureAtlas {
  constructor() {
    this.names = Object.keys(TILE_PAINTERS);
    const cols = ATLAS_TILES_X;
    const rows = Math.ceil(this.names.length / cols);
    this.cols = cols;
    this.rows = rows;

    const canvas = document.createElement("canvas");
    canvas.width = cols * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    this.index = {};
    this.names.forEach((name, i) => {
      const cx = (i % cols) * TILE;
      const cy = Math.floor(i / cols) * TILE;
      TILE_PAINTERS[name](ctx, cx, cy, makeRng(0x9e10 + i * 2654435761));
      this.index[name] = i;
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texture = tex;
    this.canvas = canvas;
  }

  // UV rect for a tile name: [u0, v0, u1, v1]. Insets slightly to avoid bleed.
  uv(name) {
    const i = this.index[name] ?? 0;
    const cols = this.cols, rows = this.rows;
    const cx = i % cols, cy = Math.floor(i / cols);
    const pad = 0.0005;
    const u0 = cx / cols + pad;
    const u1 = (cx + 1) / cols - pad;
    // canvas y grows downward; flip for GL UV space
    const v1 = 1 - (cy / rows) - pad;
    const v0 = 1 - ((cy + 1) / rows) + pad;
    return [u0, v0, u1, v1];
  }

  // Returns a small standalone canvas for a tile (used by the hotbar icons).
  iconCanvas(name, size = 38) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const i = this.index[name] ?? 0;
    const sx = (i % this.cols) * TILE;
    const sy = Math.floor(i / this.cols) * TILE;
    ctx.drawImage(this.canvas, sx, sy, TILE, TILE, 0, 0, size, size);
    return c;
  }
}
