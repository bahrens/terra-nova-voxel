// Crafting recipes — a data-driven registry that turns items into other items.
// Each recipe consumes `in` (item id -> count) and produces `out` ({ id, n }).
// This is the seam each downstream game redefines; the crafting UI just renders
// it and the inventory enforces the costs. Shapeless for now (no grid layout).
export const RECIPES = [
  { out: { id: "plank", n: 4 }, in: { log: 1 } },
  { out: { id: "stick", n: 4 }, in: { plank: 2 } },
  { out: { id: "torch", n: 4 }, in: { coal: 1, stick: 1 } },

  { out: { id: "wood_pickaxe", n: 1 }, in: { plank: 3, stick: 2 } },
  { out: { id: "wood_axe", n: 1 }, in: { plank: 3, stick: 2 } },
  { out: { id: "wood_shovel", n: 1 }, in: { plank: 1, stick: 2 } },

  { out: { id: "stone_pickaxe", n: 1 }, in: { cobble: 3, stick: 2 } },
  { out: { id: "stone_axe", n: 1 }, in: { cobble: 3, stick: 2 } },
  { out: { id: "stone_shovel", n: 1 }, in: { cobble: 1, stick: 2 } },

  { out: { id: "iron_pickaxe", n: 1 }, in: { iron: 3, stick: 2 } },
  { out: { id: "iron_axe", n: 1 }, in: { iron: 3, stick: 2 } },
  { out: { id: "iron_shovel", n: 1 }, in: { iron: 1, stick: 2 } },
];

// True if the inventory map (item id -> count) has every input in the amounts
// the recipe needs.
export function canCraft(recipe, inv) {
  for (const item in recipe.in) {
    if ((inv.get(item) || 0) < recipe.in[item]) return false;
  }
  return true;
}
