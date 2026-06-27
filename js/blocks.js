// Block definitions. Each block maps its faces to texture tile names.
// `top` / `bottom` default to `side` when omitted.

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
};

// Per-block definitions.
//   solid:       blocks movement / collision
//   transparent: don't cull neighbour faces against it (glass, leaves, water)
//   opaque:      false for blocks that should not hide faces behind them
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
};

// Fill in defaults.
for (const id in BLOCKS) {
  const b = BLOCKS[id];
  if (b.solid === undefined) b.solid = true;
  if (b.transparent === undefined) b.transparent = false;
  if (b.opaque === undefined) b.opaque = true;
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

// The blocks offered in the hotbar, in order.
export const HOTBAR = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE,
  BLOCK.SAND, BLOCK.LOG, BLOCK.PLANK, BLOCK.LEAVES, BLOCK.GLASS,
];
