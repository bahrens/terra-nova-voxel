// Item registry — items are distinct from blocks. An item is what lives in
// inventories/hotbars and drops in the world; a "block item" can be placed to
// create a block, while material items (coal, iron, gold; later tools/food)
// cannot. Blocks define the world voxels; items define what you carry and trade.
//
// Item ids are short strings (good for saves + future data/plugins). Every real
// block gets a block item named after it; the block<->item maps + the per-block
// drop table are the seams the rest of the game uses instead of raw block ids.
import { BLOCK, BLOCKS } from "./blocks.js";

export const ITEMS = {};
const blockToItem = {}; // blockId -> block-item id

function def(id, d) { ITEMS[id] = { id, maxStack: 64, place: null, ...d }; return id; }

// Block items: one per real block (id = lowercased BLOCK enum name).
for (const [name, blockId] of Object.entries(BLOCK)) {
  if (blockId === BLOCK.AIR) continue;
  const b = BLOCKS[blockId];
  if (!b) continue;
  if (b.variantOf != null) continue; // variant blocks (e.g. top slab) have no own item
  const id = name.toLowerCase();
  def(id, { name: b.name, tile: b.faces.side, place: blockId });
  blockToItem[blockId] = id;
}

// Material (non-block) items — proof that items aren't just blocks.
def("coal", { name: "Coal", tile: "coal_item" });
def("iron", { name: "Iron", tile: "iron_item" });
def("gold", { name: "Gold", tile: "gold_item" });
def("stick", { name: "Stick", tile: "stick_item" });

// Tools: pickaxe / axe / shovel in wood, stone, iron tiers. Matching tool +
// sufficient tier mines its block category faster and harvests gated blocks.
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const TOOL_TYPES = ["pickaxe", "axe", "shovel"];
const TOOL_TIERS = [
  { key: "wood", tier: 1, speed: 2 },
  { key: "stone", tier: 2, speed: 4 },
  { key: "iron", tier: 3, speed: 6 },
];
for (const type of TOOL_TYPES) {
  for (const t of TOOL_TIERS) {
    const id = `${t.key}_${type}`;
    def(id, { name: `${cap(t.key)} ${cap(type)}`, tile: id, tool: type, tier: t.tier, speed: t.speed, maxStack: 1 });
  }
}

// Mining stats of a held item, or null if it isn't a tool.
export function toolStats(itemId) {
  const i = ITEMS[itemId];
  return i && i.tool ? { type: i.tool, tier: i.tier, speed: i.speed } : null;
}

// What a broken block yields (item id), or null for nothing. Defaults to the
// block's own block item; overrides are where items diverge from blocks.
const DROPS = {
  [BLOCK.STONE]: "cobble",   // stone drops cobblestone
  [BLOCK.GRASS]: "dirt",     // grass drops dirt
  [BLOCK.COAL_ORE]: "coal",  // ores drop their material, not the ore block
  [BLOCK.IRON_ORE]: "iron",
  [BLOCK.GOLD_ORE]: "gold",
  [BLOCK.LEAVES]: null,      // leaves drop nothing (for now)
};

export function itemForBlock(blockId) { return blockToItem[blockId] ?? null; }
export function blockForItem(itemId) { return ITEMS[itemId]?.place ?? null; }
export function isBlockItem(itemId) { return ITEMS[itemId]?.place != null; }
export function itemTile(itemId) { return ITEMS[itemId]?.tile ?? null; }
export function itemName(itemId) { return ITEMS[itemId]?.name ?? itemId; }
export function dropForBlock(blockId) {
  if (blockId in DROPS) return DROPS[blockId];
  const v = BLOCKS[blockId]?.variantOf; // a variant drops its base block's item
  if (v != null) return blockToItem[v] ?? null;
  return blockToItem[blockId] ?? null;
}

// Default hotbar contents (item ids).
export const DEFAULT_HOTBAR = ["grass", "dirt", "stone", "sand", "log", "plank", "leaves", "glass", "torch"];
