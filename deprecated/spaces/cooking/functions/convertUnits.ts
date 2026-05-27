/**
 * Convert a quantity between cooking measurement units.
 *
 * Throws if either unit is not recognized or if conversion between
 * incompatible dimensions is requested (e.g. volume → mass without a
 * density — those require ingredient-specific lookup).
 *
 * Volume ↔ volume and mass ↔ mass conversions are always supported.
 */

type Unit = string;

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892,
  tbsp: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868,
  "fl oz": 29.5735, "fluid ounce": 29.5735, "fluid ounces": 29.5735,
  cup: 236.588, cups: 236.588,
  pint: 473.176, pints: 473.176,
  quart: 946.353, quarts: 946.353,
  gallon: 3785.41, gallons: 3785.41,
};

const MASS_TO_G: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
};

function normalize(unit: string): string {
  return unit.toLowerCase().trim();
}

export function convertUnits(quantity: number, fromUnit: Unit, toUnit: Unit): number {
  const from = normalize(fromUnit);
  const to = normalize(toUnit);

  if (from === to) return quantity;

  const fromVol = VOLUME_TO_ML[from];
  const toVol = VOLUME_TO_ML[to];
  if (fromVol !== undefined && toVol !== undefined) {
    return Math.round((quantity * fromVol / toVol) * 10000) / 10000;
  }

  const fromMass = MASS_TO_G[from];
  const toMass = MASS_TO_G[to];
  if (fromMass !== undefined && toMass !== undefined) {
    return Math.round((quantity * fromMass / toMass) * 10000) / 10000;
  }

  if ((fromVol !== undefined) !== (toVol !== undefined)) {
    throw new Error(
      `Cannot convert between volume (${fromUnit}) and mass (${toUnit}) without ingredient density. Use nutritionLookup() to get density data.`,
    );
  }

  throw new Error(`Unknown unit(s): "${fromUnit}", "${toUnit}"`);
}
