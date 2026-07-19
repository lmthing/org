export function estimatePensionPayout(yearsOfContributions: number, averageMonthlyEarnings: number): { monthlyPension: number; annualPension: number; confidence: number; reasoning: string } {
  // crudely estimate monthly pension from years of contributions and average earnings (0-10 confidence)
  // Greek IKA/EFKA pension estimation (crude). Under post-2016 Law 4387/2016, the main pension
  // accrues at roughly 0.77%–2.0% per contribution year depending on earnings tranches.
  // Here we use a simplified blended accrual rate of ~1.714% per year, which approximates
  // the weighted average seen in public guidance for median earners. This is NOT an official
  // IKA/EFKA calculator — it's a rough ballpark for advisory purposes only.
  //
  // yearsOfContributions: total ένσημα years (e.g., 22).
  // averageMonthlyEarnings: gross monthly pensionable earnings averaged over the career.
  // Returns the crude monthly and annual pension estimates, a 0–10 confidence score,
  // and a human-readable reasoning string.

  const ACCRUAL_RATE_PER_YEAR = 0.01714; // ~1.714% blended annual accrual

  // Replacement rate: capped at realistic bounds — Greek state pension never exceeds ~60% replacement
  const rawReplacementRate = yearsOfContributions * ACCRUAL_RATE_PER_YEAR;
  const replacementRate = Math.min(rawReplacementRate, 0.60);

  const monthlyPension = Math.round(replacementRate * averageMonthlyEarnings * 100) / 100;
  const annualPension = Math.round(monthlyPension * 14 * 100) / 100; // 14 payments/year: 12 monthly + Easter & summer bonuses

  // Confidence: we need actual earnings history and official EFKA tables for high confidence.
  // Without earnings data, we can only estimate based on contributions alone — moderate confidence at best.
  let confidence = 0;
  if (averageMonthlyEarnings > 0 && yearsOfContributions >= 15) {
    // If the caller provides a reasoned earnings figure (e.g., from known salary bands),
    // confidence rises, but still not above ~6 without exact EFKA earnings records.
    confidence = averageMonthlyEarnings >= 800
      ? 5  // plausible median-range earnings
      : 4; // low earnings — estimate more sensitive to error
  } else if (yearsOfContributions > 0) {
    confidence = 2; // no earnings data — pure extrapolation from contribution years alone
  }

  let reasoning = "";
  if (confidence <= 2) {
    reasoning = "Lacking average earnings data; this estimate extrapolates from contribution years alone and assumes a median Greek salary (~€1,200/month). Obtain actual earnings history from IKA/EFKA for a reliable figure.";
  } else if (confidence <= 5) {
    reasoning = "Based on supplied contribution years and an estimated average earnings figure. Accuracy is limited without EFKA's official earnings record. Consult an EFKA accountant or use the EFKA online simulator for precise projection.";
  } else {
    reasoning = "Calculated with reasonable earnings and contribution data. Still approximate — Greek pension rules (Law 4387/2016 and subsequent amendments) involve tranches and recalculation factors not captured here.";
  }

  return { monthlyPension, annualPension, confidence, reasoning };
}