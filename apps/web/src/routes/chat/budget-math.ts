/** One rolling budget window as returned by the cloud gateway `/api/billing/usage`.
 *  `spend` is best-effort — `null` when the LiteLLM image doesn't expose per-window spend. */
export interface BudgetWindow {
  duration: string
  max_budget: number
  spend: number | null
}

export interface Usage {
  tier: string
  spend: number
  budgets: BudgetWindow[]
  models: string[]
}

/** Percentage of a window's budget still available (0–100), or `null` when the
 *  per-window spend is unknown. Clamped so over-spend reads as 0, not negative. */
export function remainingPct(w: BudgetWindow): number | null {
  if (w.spend == null || !(w.max_budget > 0)) return null
  const remaining = (w.max_budget - w.spend) / w.max_budget
  return Math.max(0, Math.min(1, remaining)) * 100
}
