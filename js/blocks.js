// Block definitions. Each block maps its faces to texture tile names.
// `top` / `bottom` default to `side` when omitted.
//
// Render types:
//   "cube"  (default) — a normal full voxel cube.
//   "cross" — two diagonal billboard quads (grass tufts, flowers, bushes).
//   shape   — optional list of sub-boxes [x0,y0,z0,x1,y1,z1] in 0..1 voxel space
//             for non-cube blocks (slabs, later stairs/fences). Drives the mesher
//             and collision; such blocks are non-opaque so light flows around them.

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
  // non-cube shapes
  STONE_SLAB: 26,
  STONE_SLAB_TOP: 27, // top-half variant of STONE_SLAB (chosen at placement time)
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
// Shared config for stone slabs (bottom + top variants). `full` = the block a
// doubled slab becomes.
const SLAB = { tiles: { all: "stone" }, opaque: false, full: BLOCK.STONE };

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

  // Half-height slabs. Non-opaque so light flows around them (no hard shadow).
  // `full` = the block a doubled slab becomes; `topVariant` = the top-half id to
  // place when clicking the upper half of a face; `variantOf` = the base slab
  // (the variant has no item and drops the base's item).
  [BLOCK.STONE_SLAB]:     { name: "Stone Slab", ...SLAB, shape: [[0, 0, 0, 1, 0.5, 1]], topVariant: BLOCK.STONE_SLAB_TOP },
  [BLOCK.STONE_SLAB_TOP]: { name: "Stone Slab", ...SLAB, shape: [[0, 0.5, 0, 1, 1, 1]], variantOf: BLOCK.STONE_SLAB },
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
  if (b.shape === undefined) b.shape = null; // null = full cube
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

// Mining time in seconds at base (no-tool) speed. Infinity = unbreakable.
// Tools will later divide this; creative mode ignores it (instant break).
const HARDNESS = {
  [BLOCK.SNOW]: 0.2, [BLOCK.LEAVES]: 0.2, [BLOCK.GLASS]: 0.3, [BLOCK.CACTUS]: 0.4,
  [BLOCK.DIRT]: 0.6, [BLOCK.SAND]: 0.6, [BLOCK.RED_SAND]: 0.6, [BLOCK.GRASS]: 0.7,
  [BLOCK.GRAVEL]: 0.8, [BLOCK.ICE]: 0.6,
  [BLOCK.LOG]: 2.0, [BLOCK.PLANK]: 2.0, [BLOCK.SANDSTONE]: 1.8,
  [BLOCK.STONE]: 3.5, [BLOCK.COBBLE]: 3.5, [BLOCK.STONE_SLAB]: 2.5,
  [BLOCK.COAL_ORE]: 4.0, [BLOCK.IRON_ORE]: 4.5, [BLOCK.GOLD_ORE]: 4.5,
  [BLOCK.BEDROCK]: Infinity,
};
export function blockHardness(id) {
  if (id in HARDNESS) return HARDNESS[id];
  const b = BLOCKS[id];
  if (b?.variantOf != null) return blockHardness(b.variantOf);
  if (b && b.render === "cross") return 0; // plants/torches pop instantly
  return 1.0;
}

// The tool type that mines a block fastest (and, for gated blocks, is required
// to harvest it). null = no preferred tool (hands are fine).
const BLOCK_TOOL = {
  [BLOCK.STONE]: "pickaxe", [BLOCK.COBBLE]: "pickaxe", [BLOCK.SANDSTONE]: "pickaxe", [BLOCK.STONE_SLAB]: "pickaxe",
  [BLOCK.COAL_ORE]: "pickaxe", [BLOCK.IRON_ORE]: "pickaxe", [BLOCK.GOLD_ORE]: "pickaxe", [BLOCK.ICE]: "pickaxe",
  [BLOCK.LOG]: "axe", [BLOCK.PLANK]: "axe",
  [BLOCK.DIRT]: "shovel", [BLOCK.GRASS]: "shovel", [BLOCK.SAND]: "shovel",
  [BLOCK.RED_SAND]: "shovel", [BLOCK.GRAVEL]: "shovel", [BLOCK.SNOW]: "shovel",
};
// Minimum matching-tool tier (wood 1, stone 2, iron 3) needed to get a drop.
// 0 = harvestable by hand. Mining a gated block with too weak/wrong a tool still
// breaks it but yields nothing.
const BLOCK_MIN_TIER = {
  [BLOCK.STONE]: 1, [BLOCK.COBBLE]: 1, [BLOCK.SANDSTONE]: 1, [BLOCK.COAL_ORE]: 1, [BLOCK.STONE_SLAB]: 1,
  [BLOCK.IRON_ORE]: 2, [BLOCK.GOLD_ORE]: 3,
};
export function blockTool(id) {
  if (id in BLOCK_TOOL) return BLOCK_TOOL[id];
  const v = BLOCKS[id]?.variantOf;
  return v != null ? blockTool(v) : null;
}
export function blockMinTier(id) {
  if (id in BLOCK_MIN_TIER) return BLOCK_MIN_TIER[id];
  const v = BLOCKS[id]?.variantOf;
  return v != null ? blockMinTier(v) : 0;
}

// The blocks offered in the hotbar, in order.
// Kept at 9 so it maps cleanly to digit keys 1-9. (A proper >9-block solution —
// a full inventory with the hotbar as a 9-slot view — is a roadmap item.)
export const HOTBAR = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.LOG, BLOCK.PLANK, BLOCK.LEAVES, BLOCK.GLASS, BLOCK.TORCH,
];
