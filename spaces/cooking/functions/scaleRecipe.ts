/**
 * Scale a recipe's ingredient quantities by a multiplier.
 *
 * Pass the ingredient list and a ratio (e.g. 2 for double, 0.5 for half).
 * Returns a new array with quantities multiplied; units are preserved as-is.
 * Fractional quantities are rounded to 2 decimal places.
 */

export interface RecipeIngredient {
  raw: string;
  quantity?: number;
  unit?: string;
  ingredient: string;
  notes?: string;
}

export interface ScaledIngredient extends RecipeIngredient {
  scaledQuantity: number;
}

export function scaleRecipe(
  ingredients: RecipeIngredient[],
  multiplier: number,
): ScaledIngredient[] {
  if (!Array.isArray(ingredients)) return [];
  const ratio = Math.max(0.01, multiplier);
  return ingredients.map((ing) => ({
    ...ing,
    scaledQuantity: ing.quantity != null
      ? Math.round(ing.quantity * ratio * 100) / 100
      : 0,
    quantity: ing.quantity != null
      ? Math.round(ing.quantity * ratio * 100) / 100
      : undefined,
  }));
}
