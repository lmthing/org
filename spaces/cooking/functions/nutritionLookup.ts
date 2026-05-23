/**
 * Look up nutritional information for a food item.
 *
 * Uses the USDA FoodData Central API (free, no key required for basic lookups)
 * with a fallback to Open Food Facts. Returns per-100g macros and common micros.
 *
 * Set USDA_API_KEY env var for higher rate limits (https://fdc.nal.usda.gov/api-guide.html).
 */

export interface NutritionData {
  food: string;
  per: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sugar_g: number;
  sodium_mg: number;
  source: "usda" | "openfoodfacts" | "unavailable";
}

export interface NutritionLookupOpts {
  per?: "100g" | "serving";
  servingG?: number;
}

const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org/cgi/search.pl";

function nutrientVal(
  nutrients: Array<{ nutrientId?: number; nutrientName?: string; value?: number }>,
  ...ids: number[]
): number {
  for (const id of ids) {
    const n = nutrients.find((n) => n.nutrientId === id);
    if (n?.value != null) return n.value;
  }
  return 0;
}

async function lookupUSDA(query: string, opts: NutritionLookupOpts): Promise<NutritionData | null> {
  const key = process.env["USDA_API_KEY"] ?? "DEMO_KEY";
  const searchUrl =
    `${USDA_BASE}/foods/search?query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=1&api_key=${key}`;

  const res = await fetch(searchUrl);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    foods?: Array<{
      description?: string;
      foodNutrients?: Array<{ nutrientId?: number; nutrientName?: string; value?: number }>;
    }>;
  };

  const food = data.foods?.[0];
  if (!food) return null;

  const n = food.foodNutrients ?? [];
  const per100g: NutritionData = {
    food: food.description ?? query,
    per: "100g",
    // USDA nutrient IDs: 1008=energy, 1003=protein, 1005=carbs, 1004=fat, 1079=fibre, 2000=sugar, 1093=sodium
    calories: nutrientVal(n, 1008),
    protein_g: nutrientVal(n, 1003),
    carbs_g: nutrientVal(n, 1005),
    fat_g: nutrientVal(n, 1004),
    fibre_g: nutrientVal(n, 1079),
    sugar_g: nutrientVal(n, 2000),
    sodium_mg: nutrientVal(n, 1093),
    source: "usda",
  };

  if (opts.per === "serving" && opts.servingG) {
    const ratio = opts.servingG / 100;
    return {
      ...per100g,
      per: `${opts.servingG}g serving`,
      calories: Math.round(per100g.calories * ratio),
      protein_g: Math.round(per100g.protein_g * ratio * 10) / 10,
      carbs_g: Math.round(per100g.carbs_g * ratio * 10) / 10,
      fat_g: Math.round(per100g.fat_g * ratio * 10) / 10,
      fibre_g: Math.round(per100g.fibre_g * ratio * 10) / 10,
      sugar_g: Math.round(per100g.sugar_g * ratio * 10) / 10,
      sodium_mg: Math.round(per100g.sodium_mg * ratio),
    };
  }

  return per100g;
}

async function lookupOpenFoodFacts(query: string): Promise<NutritionData | null> {
  const url =
    `${OFF_BASE}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;

  const res = await fetch(url, { headers: { "User-Agent": "lmthing-cooking/1.0" } });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    products?: Array<{
      product_name?: string;
      nutriments?: {
        "energy-kcal_100g"?: number;
        proteins_100g?: number;
        carbohydrates_100g?: number;
        fat_100g?: number;
        fiber_100g?: number;
        sugars_100g?: number;
        sodium_100g?: number;
      };
    }>;
  };

  const product = data.products?.[0];
  if (!product?.nutriments) return null;

  const nm = product.nutriments;
  return {
    food: product.product_name ?? query,
    per: "100g",
    calories: nm["energy-kcal_100g"] ?? 0,
    protein_g: nm.proteins_100g ?? 0,
    carbs_g: nm.carbohydrates_100g ?? 0,
    fat_g: nm.fat_100g ?? 0,
    fibre_g: nm.fiber_100g ?? 0,
    sugar_g: nm.sugars_100g ?? 0,
    sodium_mg: (nm.sodium_100g ?? 0) * 1000,
    source: "openfoodfacts",
  };
}

export async function nutritionLookup(
  food: string,
  opts: NutritionLookupOpts = {},
): Promise<NutritionData> {
  const usda = await lookupUSDA(food, opts).catch(() => null);
  if (usda) return usda;

  const off = await lookupOpenFoodFacts(food).catch(() => null);
  if (off) return off;

  return {
    food,
    per: "100g",
    calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
    fibre_g: 0, sugar_g: 0, sodium_mg: 0,
    source: "unavailable",
  };
}
