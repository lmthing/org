import { describe, it, expect } from 'vitest'
import { remainingPct, type BudgetWindow } from './budget-math'

const w = (max_budget: number, spend: number | null): BudgetWindow => ({
  duration: '5h',
  max_budget,
  spend,
})

describe('remainingPct', () => {
  it('returns the percentage of budget still available', () => {
    expect(remainingPct(w(0.3, 0))).toBe(100)
    expect(remainingPct(w(2, 0.5))).toBe(75)
    expect(remainingPct(w(6, 6))).toBe(0)
  })

  it('clamps over-spend to 0 rather than going negative', () => {
    expect(remainingPct(w(2, 3))).toBe(0)
  })

  it('returns null when per-window spend is unknown', () => {
    expect(remainingPct(w(0.3, null))).toBeNull()
  })

  it('returns null for a zero or invalid budget cap (avoids divide-by-zero)', () => {
    expect(remainingPct(w(0, 0))).toBeNull()
  })
})
