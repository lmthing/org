import { describe, it, expect } from 'vitest'
import {
  applyFormat,
  autoTone,
  booleanLabel,
  formatBound,
  humanize,
  inferFormat,
  relativeTime,
  resolveTone,
  toneTokens,
} from './format'

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

  it('a BOOLEAN is a yes/no fact in every slot, with or without a format', () => {
    expect(booleanLabel(true)).toBe('Yes')
    // No format at all — the case scenario 30 shipped, as `false` in a pill.
    expect(applyFormat(false)).toBe('No')
    // …and a declared format cannot put the JS literal back either.
    expect(applyFormat(true, 'humanize')).toBe('Yes')
  })

  it('an UNDECLARED currency still gets a symbol and two digits, so a column lines up', () => {
    // 70.49 beside 78 is the defect; both now carry the same minor units.
    expect(applyFormat(70.49, 'currency')).toMatch(/70[.,]49/)
    expect(applyFormat(78, 'currency')).toMatch(/78[.,]00/)
    expect(applyFormat(78, 'currency')).toMatch(/^[^0-9]+78/)
  })
})

describe('inferred formats — the default when the model declared nothing', () => {
  it('an ISO-shaped string is a date; a timestamp is a datetime', () => {
    expect(inferFormat('2026-07-08', '$.collected_date')).toBe('date')
    expect(inferFormat('2026-07-08T14:30:00Z', '$.collected_at')).toBe('datetime')
    // A date column that took a round trip through `toISOString` is still a DATE — a
    // fabricated "12:00 AM" is presentation the app never asked for.
    expect(inferFormat('2026-07-08T00:00:00.000Z', '$.collected_at')).toBe('date')
    // Anything that is not that exact shape is left alone: this reads a type, not a hunch.
    expect(inferFormat('full service', '$.work_description')).toBeUndefined()
    expect(inferFormat('2026', '$.season')).toBeUndefined()
  })

  it('a number in a MONEY-named field is currency — the name is the only evidence there is', () => {
    expect(inferFormat(78, '$.parts_total')).toBe('currency')
    expect(inferFormat(12.5, '$.price')).toBe('currency')
    expect(inferFormat(9, '$.total_parts_gbp')).toBe('currency')
    expect(inferFormat(9, '$data.jobs.labour_cost')).toBe('currency')
  })

  it('a counter, a duration and a coordinate are LEFT ALONE', () => {
    // A default that turns 17 days into "$17.00" changes what the figure means.
    expect(inferFormat(17, '$.longest_waiting_days')).toBeUndefined()
    expect(inferFormat(3, '$.in_shop_count')).toBeUndefined()
    expect(inferFormat(2.5, '$.estimated_hours')).toBeUndefined()
    expect(inferFormat(51.5074, '$.latitude')).toBeUndefined()
    // A minor-unit column is money the renderer would draw a hundredfold wrong.
    expect(inferFormat(7849, '$.total_cents')).toBeUndefined()
    // A literal is not a field, so it names nothing to infer from.
    expect(inferFormat(78, 'Total')).toBeUndefined()
  })

  it('a DECLARED format wins — inference only fills a hole', () => {
    expect(formatBound(78, { format: 'number' }, {}, '$.parts_total')).toBe('78')
    expect(formatBound('2026-07-08', { format: 'relative-time' }, {}, '$.collected_date')).toMatch(/ago|in /)
  })

  it('the currency code comes from the row, then from the FIELD NAME, then the default', () => {
    // A row that carries its own code keeps it (the two multi-currency apps).
    expect(formatBound(20, undefined, { self: { amount: 20, currency: 'GBP' } }, '$.amount')).toMatch(/£|GBP/)
    // A column that spelled the currency into its NAME has already said which one it means.
    expect(formatBound(148.49, undefined, { self: { total_parts_gbp: 148.49 } }, '$.total_parts_gbp')).toMatch(/£|GBP/)
    // Neither ⇒ one documented, stable code rather than a bare number.
    expect(formatBound(78, undefined, { self: { parts_total: 78 } }, '$.parts_total')).toMatch(/78[.,]00/)
  })

  /**
   * `new Date('2026-07-08')` is UTC MIDNIGHT, so formatting it in local time renders the
   * 7th anywhere west of Greenwich: the app is told to show one day and a person reads
   * another. A date-only source is therefore formatted in UTC.
   *
   * **This assertion only discriminates in a negative-offset zone**, and the runner's zone
   * cannot be changed from inside a test — vitest's worker pool ignores a `process.env.TZ`
   * assignment (V8 caches the zone per isolate). Prove it from the shell instead:
   *
   * ```bash
   * TZ=America/New_York pnpm vitest run src/view/format.test.ts
   * ```
   *
   * which fails on this case with the UTC anchoring removed, and passes with it.
   */
  it('a calendar day does not slide to its neighbour in a western timezone', () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-07-08T00:00:00Z'))
    expect(applyFormat('2026-07-08', 'date')).toBe(expected)
    // …and the same day after a round trip through `toISOString`, which is how a `date`
    // column usually reaches a view.
    expect(applyFormat('2026-07-08T00:00:00.000Z', 'date')).toBe(expected)
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
