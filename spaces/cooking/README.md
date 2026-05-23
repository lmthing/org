# Cooking Space

A full-featured cooking assistant space for the LMThing agent runtime.

## Agents

| Agent | Role | Model hint |
|-------|------|-----------|
| `chef` | Primary orchestrator — answers questions, runs all flows | L (full coverage) |
| `nutritionist` | Nutritional analysis, dietary fit checks | M (multi-step) |
| `pantry-manager` | Inventory, substitutions, shopping lists | S (fast, narrow) |
| `recipe-researcher` | Web recipe search and extraction via `research` space | M (moderate reasoning) |

## Flows

| Flow | Description | Cycles |
|------|-------------|--------|
| `cook_recipe` | Guided step-by-step cooking session | 3 |
| `meal_plan` | Personalised weekly meal plan + shopping list | 3 |
| `recipe_discovery` | Find, compare, and save recipes from the web | 2 |

## Functions (host-bridged globals)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `scaleRecipe` | `(ingredients, multiplier) → ScaledIngredient[]` | Scale quantities by serving multiplier |
| `parseIngredients` | `(text) → ParsedIngredient[]` | Parse free-text ingredient strings into structured objects |
| `convertUnits` | `(quantity, fromUnit, toUnit) → number` | Convert between volume and mass units |
| `nutritionLookup` | `(food, opts?) → Promise<NutritionData>` | USDA FoodData Central + Open Food Facts lookup |

## Knowledge

| Domain | Field | Options |
|--------|-------|---------|
| `cuisine` | `style` | `italian`, `french`, `asian`, `mexican` |
| `technique` | `method` | `roasting`, `braising`, `sauteing`, `baking` |
| `dietary` | `restriction` | `vegan`, `gluten_free`, `keto` |

## Cross-space delegation

This space uses the `research` space for web-based recipe research:

```ts
const research = Space.load("research");
research.loadAgent("searcher");
research.loadAgent("reader");
await inspect();

const hits = research.agents.searcher.search(
  { strategy: { mode: "broad" } },
  "authentic ramen broth recipe",
);
await inspect(hits);
```

## Model alias conventions

When forking, embed the desired model alias in the instruction prefix:

```ts
fork({ instruction: "[model:XS] ..." })  // classification, boolean
fork({ instruction: "[model:S] ..." })   // fast, narrow single-step
fork({ instruction: "[model:M] ..." })   // multi-step reasoning
fork({ instruction: "[model:L] ..." })   // full coverage, complex
fork({ instruction: "[model:M_R] ..." }) // M + extended reasoning
fork({ instruction: "[model:L_R] ..." }) // L + extended reasoning
```

The router reads this prefix at `new_message` and `post_inspect` to assign the correct executor tier.

## Start

```bash
llm-repl --space cooking --agent chef
```
