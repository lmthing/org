/**
 * Parse free-text ingredient strings into structured objects.
 *
 * Handles common formats:
 *   "2 cups all-purpose flour"
 *   "1/2 tsp salt"
 *   "3 large eggs, beaten"
 *   "500g chicken breast, cubed"
 *   "a pinch of cayenne"
 *
 * Returns { quantity, unit, ingredient, notes, raw } for each line.
 * Lines that cannot be parsed keep quantity/unit as undefined.
 */

export interface ParsedIngredient {
  raw: string;
  quantity?: number;
  unit?: string;
  ingredient: string;
  notes?: string;
}

const UNITS = new Set([
  "tsp", "teaspoon", "teaspoons",
  "tbsp", "tablespoon", "tablespoons",
  "cup", "cups",
  "fl oz", "fluid ounce", "fluid ounces",
  "oz", "ounce", "ounces",
  "lb", "lbs", "pound", "pounds",
  "g", "gram", "grams",
  "kg", "kilogram", "kilograms",
  "ml", "milliliter", "milliliters", "millilitre", "millilitres",
  "l", "liter", "liters", "litre", "litres",
  "pinch", "pinches",
  "bunch", "bunches",
  "clove", "cloves",
  "slice", "slices",
  "piece", "pieces",
  "can", "cans",
  "jar", "jars",
  "packet", "packets",
  "sprig", "sprigs",
  "handful", "handfuls",
]);

function parseFraction(s: string): number | undefined {
  // "1/2" → 0.5, "1 1/2" → 1.5, "2" → 2
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]!, 10) + parseInt(mixed[2]!, 10) / parseInt(mixed[3]!, 10);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]!, 10) / parseInt(frac[2]!, 10);
  const num = parseFloat(s);
  return isNaN(num) ? undefined : num;
}

export function parseIngredients(text: string): ParsedIngredient[] {
  const lines = text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((raw) => {
    // Strip leading bullet / dash / asterisk
    const clean = raw.replace(/^[-•*]\s*/, "").trim();

    // Match: optional quantity (integer, decimal, fraction, mixed fraction)
    const qtyMatch = clean.match(
      /^((?:\d+\s+)?\d+(?:[./]\d+)?)\s*/,
    );
    let rest = clean;
    let quantity: number | undefined;

    if (qtyMatch) {
      quantity = parseFraction(qtyMatch[1]!.trim());
      rest = clean.slice(qtyMatch[0].length).trim();
    }

    // Match unit
    let unit: string | undefined;
    for (const u of UNITS) {
      const re = new RegExp(`^(${u})s?\\b\\s*`, "i");
      const m = rest.match(re);
      if (m) {
        unit = u;
        rest = rest.slice(m[0].length).trim();
        break;
      }
    }

    // Split ingredient name from parenthetical notes
    const commaIdx = rest.search(/,\s*| \(|\s+—\s+/);
    let ingredient = rest;
    let notes: string | undefined;
    if (commaIdx > 0) {
      ingredient = rest.slice(0, commaIdx).trim();
      notes = rest.slice(commaIdx).replace(/^[,(—\s]+/, "").trim() || undefined;
    }

    // "of" prefix — "a clove of garlic"
    ingredient = ingredient.replace(/^of\s+/i, "").trim();

    return { raw, quantity, unit, ingredient, notes };
  });
}
