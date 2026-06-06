---
title: Keto
description: Ketogenic diet rules — strict carbohydrate limits, fat-forward cooking, and net carb calculation
---

## Definition

The ketogenic diet maintains **metabolic ketosis** by severely restricting carbohydrates (typically < 20–50g net carbs/day) and deriving the majority of calories from fat (65–80%) with moderate protein (15–30%). Net carbs = total carbs − dietary fibre − sugar alcohols.

## Macro targets (standard keto)

| Macro | % of calories | Notes |
|-------|--------------|-------|
| Fat | 65–80% | Primary energy source |
| Protein | 15–30% | Excess protein can be gluconeogenic |
| Carbohydrates | 5–10% | Net carbs only; fibre doesn't count |

## Disqualifying ingredients (flag these)

| Ingredient | Net carbs / 100g | Substitute |
|-----------|-----------------|-----------|
| Sugar (all forms) | ~100g | Erythritol, allulose, monk fruit, stevia |
| Bread / flour (wheat) | ~60–70g | Almond flour, coconut flour, lupin flour |
| Rice | ~28g (cooked) | Cauliflower rice, shirataki rice |
| Pasta | ~25g (cooked) | Shirataki noodles, zucchini noodles, hearts of palm pasta |
| Potatoes | ~15–17g | Cauliflower mash, turnip, celeriac |
| Corn | ~14g (cooked) | Omit; no direct keto substitute |
| Beans/legumes | ~8–14g | Omit or use in very small amounts |
| Fruit (most) | ~10–20g | Berries in small amounts (strawberry, raspberry: ~5–7g/100g) |
| Milk | ~5g | Heavy cream, unsweetened almond/coconut milk |
| Beer | ~3–10g | Dry wine (small serving), spirits |

## Keto-friendly ingredients

- **Fats**: butter, ghee, lard, tallow, olive oil, coconut oil, avocado oil
- **Proteins**: all meat, fish, shellfish, eggs (0 net carbs)
- **Dairy**: heavy cream, full-fat cheese, sour cream, cream cheese, mascarpone
- **Vegetables**: leafy greens, broccoli, cauliflower, zucchini, asparagus, bell peppers, mushrooms
- **Nuts/seeds**: macadamia, pecan, walnut, almond, chia, flaxseed (check net carbs; cashews are borderline)
- **Berries**: in moderation — raspberries, blackberries, strawberries (< 7g net carbs / 100g)

## Net carb calculation

```
net_carbs = total_carbohydrates_g − dietary_fibre_g − sugar_alcohols_g
```

- **Erythritol**: subtract fully (GI ~0, not metabolised).
- **Other sugar alcohols** (maltitol, sorbitol): subtract only 50% — they are partially metabolised and spike blood glucose in quantity.
- **Allulose**: subtract fully.

## Cooking techniques for keto

- **Fat-forward sauces**: pan sauces finished with butter or cream replace flour-thickened gravies (xanthan gum at 0.1–0.2% by weight achieves similar thickness without carbs).
- **Cheese-crust pizza**: mozzarella + cream cheese + almond flour for fathead dough.
- **Cauliflower substitutions**: riced, mashed, or roasted cauliflower stands in for rice and potato; it absorbs fat and seasoning well.
- **Egg-based baking**: keto cakes and bread rely heavily on eggs for structure (almond flour lacks gluten; eggs provide the protein network).

## Fit-check rules

A recipe **fails** the keto check if any single serving contains > 10g net carbs from the ingredient list, or if any disqualifying high-carb ingredient appears without a noted keto substitute. Calculate net carbs using `nutritionLookup()` data — do not estimate.
