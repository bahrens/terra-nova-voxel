// Data-driven biome registry. A biome is pure configuration describing how a
// column of terrain is surfaced and decorated — no logic baked into the world
// generator, so new biomes can be added (or swapped per game) as data.
import { BLOCK } from "./blocks.js";

// Biome fields:
//   surface     — top block on land
//   subsurface  — the few layers directly beneath the surface
//   underwater  — surface block when the column is below sea level
//   snowCap     — if true, high columns get a snow surface
//   tree        — { type: "oak" | "cactus", chance } or null
//   plants      — [{ block, chance }] rolled on the surface when no tree
export const BIOME = {
  OCEAN: {
    name: "Ocean", surface: BLOCK.SAND, subsurface: BLOCK.SAND,
    underwater: BLOCK.GRAVEL, tree: null, plants: [],
  },
  BEACH: {
    name: "Beach", surface: BLOCK.SAND, subsurface: BLOCK.SAND,
    underwater: BLOCK.SAND, tree: null,
    plants: [{ block: BLOCK.DEAD_BUSH, chance: 0.004 }],
  },
  DESERT: {
    name: "Desert", surface: BLOCK.SAND, subsurface: BLOCK.SANDSTONE,
    underwater: BLOCK.SAND, tree: { type: "cactus", chance: 0.02 },
    plants: [{ block: BLOCK.DEAD_BUSH, chance: 0.02 }],
  },
  PLAINS: {
    name: "Plains", surface: BLOCK.GRASS, subsurface: BLOCK.DIRT,
    underwater: BLOCK.DIRT, tree: { type: "oak", chance: 0.004 },
    plants: [
      { block: BLOCK.TALL_GRASS, chance: 0.18 },
      { block: BLOCK.FLOWER_YELLOW, chance: 0.02 },
      { block: BLOCK.FLOWER_RED, chance: 0.015 },
    ],
  },
  FOREST: {
    name: "Forest", surface: BLOCK.GRASS, subsurface: BLOCK.DIRT,
    underwater: BLOCK.DIRT, tree: { type: "oak", chance: 0.04 },
    plants: [
      { block: BLOCK.TALL_GRASS, chance: 0.12 },
      { block: BLOCK.FLOWER_RED, chance: 0.01 },
    ],
  },
  SAVANNA: {
    name: "Savanna", surface: BLOCK.GRASS, subsurface: BLOCK.DIRT,
    underwater: BLOCK.DIRT, tree: { type: "oak", chance: 0.008 },
    plants: [
      { block: BLOCK.TALL_GRASS, chance: 0.14 },
      { block: BLOCK.DEAD_BUSH, chance: 0.01 },
    ],
  },
  TUNDRA: {
    name: "Tundra", surface: BLOCK.SNOW, subsurface: BLOCK.DIRT,
    underwater: BLOCK.GRAVEL, freezesWater: true,
    tree: { type: "oak", chance: 0.006 },
    plants: [{ block: BLOCK.DEAD_BUSH, chance: 0.004 }],
  },
  MOUNTAIN: {
    name: "Mountain", surface: BLOCK.STONE, subsurface: BLOCK.STONE,
    underwater: BLOCK.GRAVEL, snowCap: true, tree: null,
    plants: [{ block: BLOCK.TALL_GRASS, chance: 0.02 }],
  },
};

// Choose a biome from climate + elevation. Height/water decide the broad zone;
// temperature/humidity decide the land biome. `mountainElev` is the elevation
// used for the rock-line test — pass height + noise jitter so the boundary
// wobbles naturally instead of following an exact contour.
export function pickBiome(temp, humidity, height, waterLevel, mountainElev = height) {
  if (height <= waterLevel - 1) return BIOME.OCEAN;
  if (height <= waterLevel + 1) return BIOME.BEACH;
  if (mountainElev >= 56) return BIOME.MOUNTAIN;

  if (temp < -0.35) return BIOME.TUNDRA;
  if (temp > 0.35 && humidity < -0.05) return BIOME.DESERT;
  if (temp > 0.2 && humidity < 0.15) return BIOME.SAVANNA;
  if (humidity > 0.15) return BIOME.FOREST;
  return BIOME.PLAINS;
}
