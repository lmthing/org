/**
 * Cooking space — host-function bridge.
 *
 * The CLI driver dynamically imports this module and injects each entry of
 * `hostFunctions` as a QuickJS global. Everything else the agent needs lives
 * in the standard on-disk layout:
 *
 *   agents/<slug>/instruct.md   — agent role + instructions
 *   functions/*.ts              — auto-discovered → DTS overlay + host bridge
 *   components/{view,form}/*.tsx — auto-discovered → DTS overlay
 *   knowledge/<domain>/<field>/<option>.md — auto-loaded
 *   flows/<slug>/index.md + N.Step.md — the tasklist + sink declaration
 *
 * Cross-space access: agents in this space delegate to the `research` space
 * via Space.load("research") for web search and document reading.
 */

import { scaleRecipe } from "./functions/scaleRecipe.js";
import { parseIngredients } from "./functions/parseIngredients.js";
import { convertUnits } from "./functions/convertUnits.js";
import { nutritionLookup } from "./functions/nutritionLookup.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  scaleRecipe: (...a) => scaleRecipe(a[0] as never, a[1] as number),
  parseIngredients: (...a) => parseIngredients(a[0] as string),
  convertUnits: (...a) => convertUnits(a[0] as number, a[1] as string, a[2] as string),
  nutritionLookup: (...a) => nutritionLookup(a[0] as string, a[1] as never),
};
