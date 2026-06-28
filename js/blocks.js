// Block definitions. Each block maps its faces to texture tile names.
// `top` / `bottom` default to `side` when omitted.
//
// Render types:
//   "cube"  (default) — a normal full voxel cube.
//   "cross" — two diagonal billboard quads (grass tufts, flowers, bushes).

export const AIR = 0;

// Block ids
export const BLOCK = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  WATER: 7,
  PLANK: 8,
  GLASS: 9,
  COBBLE: 10,
  BEDROCK: 11,
  SNOW: 12,
  // --- biome additions ---
  GRAVEL: 13,
  SANDSTONE: 14,
  RED_SAND: 15,
  CACTUS: 16,
  COAL_ORE: 17,
  IRON_ORE: 18,
  GOLD_ORE: 19,
  ICE: 20,
  // cross-shaped plants
  TALL_GRASS: 21,
  FLOWER_RED: 22,
  FLOWER_YELLOW: 23,
  DEAD_BUSH: 24,
  // light sources
  TORCH: 25,
};

// Per-block definitions.
//   solid:       blocks movement / collision
//   transparent: don't cull neighbour faces against it (glass, leaves, water)
//   opaque:      false for blocks that should not hide faces behind them
//   render:      "cube" | "cross"
//   needsSupport: destroyed if the solid block beneath it is removed. Small
//                 ground plants set this; larger flora (cactus, logs) do not.
//   light:       block-light emission level (0-15); torches glow, most blocks 0.
const PLANT = { solid: false, transparent: true, opaque: false, render: "cross", needsSupport: true };

export const BLOCKS = {
  [BLOCK.STONE]:   { name: "Stone",       tiles: { all: "stone" } },
  [BLOCK.DIRT]:    { name: "Dirt",        tiles: { all: "dirt" } },
  [BLOCK.GRASS]:   { name: "Grass",       tiles: { top: "grass_top", side: "grass_side", bottom: "dirt" } },
  [BLOCK.SAND]:    { name: "Sand",        tiles: { all: "sand" } },
  [BLOCK.LOG]:     { name: "Wood",        tiles: { top: "log_top", side: "log_side", bottom: "log_top" } },
  [BLOCK.LEAVES]:  { name: "Leaves",      tiles: { all: "leaves" }, transparent: true, opaque: false },
  [BLOCK.WATER]:   { name: "Water",       tiles: { all: "water" }, solid: false, transparent: true, opaque: false, liquid: true },
  [BLOCK.PLANK]:   { name: "Planks",      tiles: { all: "plank" } },
  [BLOCK.GLASS]:   { name: "Glass",       tiles: { all: "glass" }, transparent: true, opaque: false },
  [BLOCK.COBBLE]:  { name: "Cobblestone", tiles: { all: "cobble" } },
  [BLOCK.BEDROCK]: { name: "Bedrock",     tiles: { all: "bedrock" } },
  [BLOCK.SNOW]:    { name: "Snow",        tiles: { top: "snow", side: "snow_side", bottom: "dirt" } },

  [BLOCK.GRAVEL]:    { name: "Gravel",     tiles: { all: "gravel" } },
  [BLOCK.SANDSTONE]: { name: "Sandstone",  tiles: { top: "sandstone_top", side: "sandstone", bottom: "sandstone_top" } },
  [BLOCK.RED_SAND]:  { name: "Red Sand",   tiles: { all: "red_sand" } },
  [BLOCK.CACTUS]:    { name: "Cactus",     tiles: { top: "cactus_top", side: "cactus_side", bottom: "cactus_top" }, transparent: true, opaque: false },
  [BLOCK.COAL_ORE]:  { name: "Coal Ore",   tiles: { all: "coal_ore" } },
  [BLOCK.IRON_ORE]:  { name: "Iron Ore",   tiles: { all: "iron_ore" } },
  [BLOCK.GOLD_ORE]:  { name: "Gold Ore",   tiles: { all: "gold_ore" } },
  [BLOCK.ICE]:       { name: "Ice",        tiles: { all: "ice" } },

  [BLOCK.TALL_GRASS]:    { name: "Tall Grass",    tiles: { all: "tall_grass" },    ...PLANT },
  [BLOCK.FLOWER_RED]:    { name: "Red Flower",    tiles: { all: "flower_red" },    ...PLANT },
  [BLOCK.FLOWER_YELLOW]: { name: "Yellow Flower", tiles: { all: "flower_yellow" }, ...PLANT },
  [BLOCK.DEAD_BUSH]:     { name: "Dead Bush",     tiles: { all: "dead_bush" },     ...PLANT },

  [BLOCK.TORCH]:         { name: "Torch",         tiles: { all: "torch" },         ...PLANT, light: 14 },
};

// Fill in defaults.
for (const id in BLOCKS) {
  const b = BLOCKS[id];
  if (b.solid === undefined) b.solid = true;
  if (b.transparent === undefined) b.transparent = false;
  if (b.opaque === undefined) b.opaque = true;
  if (b.render === undefined) b.render = "cube";
  if (b.needsSupport === undefined) b.needsSupport = false;
  if (b.light === undefined) b.light = 0;
  const t = b.tiles;
  b.faces = {
    top: t.top || t.side || t.all,
    bottom: t.bottom || t.side || t.all,
    side: t.side || t.all,
  };
}

export function isSolid(id) {
  if (id === AIR) return false;
  const b = BLOCKS[id];
  return b ? b.solid : true;
}

export function isOpaque(id) {
  if (id === AIR) return false;
  const b = BLOCKS[id];
  return b ? b.opaque : true;
}

export function isLiquid(id) {
  const b = BLOCKS[id];
  return b ? !!b.liquid : false;
}

export function isCross(id) {
  const b = BLOCKS[id];
  return b ? b.render === "cross" : false;
}

// True for blocks that fall (are destroyed) when the block beneath them goes
// away — the small cross-plants. Used to clear floating plants after a dig.
// Per-block, so larger flora (cactus, logs) can opt out and stay put.
export function needsSupport(id) {
  const b = BLOCKS[id];
  return b ? !!b.needsSupport : false;
}

// The blocks offered in the hotbar, in order.
export const HOTBAR = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.SANDSTONE, BLOCK.LOG, BLOCK.PLANK, BLOCK.LEAVES, BLOCK.GLASS,
  BLOCK.TORCH,
];
