import { describe, it, expect } from 'vitest'
import { applyFormat, autoTone, formatBound, humanize, relativeTime, resolveTone, toneTokens } from './format'

describe('the format modifier — absorbing five apps` format.ts', () => {
  it('currency uses the ISO code and falls back rather than throwing', () => {
    expect(applyFormat(1234.5, 'currency', 'EUR')).toMatch(/1,?234[.,]50/)
    expect(applyFormat(10, 'currency', 'nonsense')).toMatch(/10/)
    expect(applyFormat('not a number', 'currency')).toBe('not a number')
  })

  it('currencyField resolves per row — the two multi-currency apps', () => {
    const scope = { self: { amount: 20, currency: 'GBP' } }
    expect(formatBound(20, { format: 'currency', currencyField: '$.currency' }, scope)).toContain('20')
  })

  it('percent accepts a ratio OR an already-percent number', () => {
    expect(applyFormat(0.42, 'percent')).toMatch(/42/)
    expect(applyFormat(42, 'percent')).toMatch(/42/)
  })

  it('humanize turns a database value into a label', () => {
    expect(humanize('self_care')).toBe('Self Care')
    expect(humanize('needsReview')).toBe('Needs Review')
    expect(humanize('in-progress')).toBe('In Progress')
  })

  it('relative-time reads as prose in both directions', () => {
    const now = Date.now()
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe('5 minutes ago')
    expect(relativeTime(new Date(now + 2 * 86_400_000), now)).toBe('in 2 days')
    expect(relativeTime(new Date(now - 10_000), now)).toBe('just now')
  })

  it('an unparseable date is shown as written rather than as `Invalid Date`', () => {
    expect(applyFormat('sometime', 'date')).toBe('sometime')
  })

  it('no format is a passthrough', () => {
    expect(applyFormat('Ragu')).toBe('Ragu')
    expect(applyFormat(null)).toBe('')
  })
})

describe('tone — never a colour, always a token', () => {
  it('every tone maps to design tokens and never a raw colour', () => {
    for (const tone of ['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const) {
      const t = toneTokens(tone)
      for (const value of [t.fg, t.bg, t.border]) {
        expect(value.startsWith('$')).toBe(true)
      }
    }
  })

  it('toneMap WINS over a literal tone — the model declared what the value means', () => {
    const toned = { tone: 'neutral' as const, toneMap: { emergency: 'danger' as const } }
    expect(resolveTone(toned, 'emergency', {})).toBe('danger')
    // and the literal is the fallback for values the map does not list
    expect(resolveTone(toned, 'routine', {})).toBe('neutral')
  })

  it('toneOf keys the map on another field — a surface tinted by $.severity', () => {
    const scope = { self: { severity: 'critical' } }
    expect(resolveTone({ toneOf: '$.severity', toneMap: { critical: 'danger' } }, 'ignored', scope)).toBe('danger')
  })

  it("`auto` settles the obvious statuses and stays neutral on anything with domain meaning", () => {
    expect(autoTone('completed')).toBe('success')
    expect(autoTone('overdue')).toBe('danger')
    expect(autoTone('pending')).toBe('warning')
    // The whole reason `toneMap` is load-bearing: `auto` cannot know this one.
    expect(autoTone('self_care')).toBe('neutral')
  })

  it('no tone modifier at all is neutral', () => {
    expect(resolveTone(undefined, 'anything', {})).toBe('neutral')
  })
})
