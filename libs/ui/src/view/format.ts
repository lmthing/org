/**
 * The `format:` modifier and the tone map — the two things that let a spec express
 * presentation without expressing computation.
 *
 * ## Formatting
 *
 * `format` rides on any bound value rather than being an element, which is what absorbs
 * the `format.ts` all five catalogue apps hand-write (~250 LOC, five near-identical
 * copies). Everything here is display-only: no value is ever CHANGED by formatting, so a
 * mutation still sends the raw field.
 *
 * `Intl` is used where it exists and falls back where it does not. That is not paranoia:
 * Hermes ships a reduced `Intl` on some Android configurations, and a throw inside a
 * formatter would take down the whole page for a currency symbol. Every helper here
 * degrades to the plain value.
 *
 * ## Tone
 *
 * A spec never writes a colour — it writes a TONE, and the renderer maps the tone to a
 * design token. That is why a spec structurally cannot violate the design system.
 *
 * `toneMap` is the load-bearing half. `tone: 'auto'` cannot know that `self_care` is good
 * news and `emergency` is not, so the model declares the mapping as a lookup table. The
 * audit measured ~32 components across 5/5 apps needing value-driven tone; without the
 * map every status pill in every generated app regresses to one colour.
 */

import type { Format, Formatted, Tone, Toned } from './types'
import { resolveBinding, type Scope } from './bind'

// ── formatting ───────────────────────────────────────────────────────────────

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const

/** Parse anything date-ish. Returns `null` rather than an Invalid Date. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** `snake_case` / `kebab-case` / `camelCase` ⇒ `Title Case`. */
export function humanize(value: unknown): string {
  const s = String(value ?? '')
  if (s === '') return s
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    // Title Case, not sentence case: these become LABELS ("Self Care", "Needs Review"),
    // and a label reads as a label only when every word is capitalised.
    .replace(/(^|\s)([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase())
}

/** "3 minutes ago" / "in 2 days". Hand-rolled: `Intl.RelativeTimeFormat` is not universal. */
export function relativeTime(value: unknown, now: number = Date.now()): string {
  const d = toDate(value)
  if (!d) return String(value ?? '')
  const delta = d.getTime() - now
  const abs = Math.abs(delta)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const phrase = (n: number, unit: string) =>
    delta < 0 ? `${plural(n, unit)} ago` : `in ${plural(n, unit)}`
  if (abs < MS.minute) return 'just now'
  if (abs < MS.hour) return phrase(Math.round(abs / MS.minute), 'minute')
  if (abs < MS.day) return phrase(Math.round(abs / MS.hour), 'hour')
  if (abs < 30 * MS.day) return phrase(Math.round(abs / MS.day), 'day')
  if (abs < 365 * MS.day) return phrase(Math.round(abs / (30 * MS.day)), 'month')
  return phrase(Math.round(abs / (365 * MS.day)), 'year')
}

function intlDate(d: Date, options: Intl.DateTimeFormatOptions, fallback: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, options).format(d)
  } catch {
    return fallback
  }
}

function intlNumber(n: number, options: Intl.NumberFormatOptions, fallback: string): string {
  try {
    return new Intl.NumberFormat(undefined, options).format(n)
  } catch {
    return fallback
  }
}

/**
 * Apply a `format` to a resolved value.
 *
 * `currency` needs the ISO code, which in the two multi-currency apps is a per-row field
 * — hence `currencyCode`, resolved from {@link Formatted.currencyField} by the caller
 * (which is the only place that knows the row scope).
 */
export function applyFormat(value: unknown, format?: Format, currencyCode?: string): string {
  if (value === null || value === undefined) return ''
  if (!format) return typeof value === 'string' ? value : stringify(value)

  switch (format) {
    case 'currency': {
      const n = toNumber(value)
      if (n === null) return stringify(value)
      const code = currencyCode && /^[A-Za-z]{3}$/.test(currencyCode) ? currencyCode.toUpperCase() : 'USD'
      return intlNumber(
        n,
        { style: 'currency', currency: code, maximumFractionDigits: 2 },
        `${code} ${n.toFixed(2)}`,
      )
    }
    case 'number': {
      const n = toNumber(value)
      return n === null ? stringify(value) : intlNumber(n, {}, String(n))
    }
    case 'percent': {
      const n = toNumber(value)
      if (n === null) return stringify(value)
      // A ratio (0..1) and a percentage (0..100) both occur in the corpus; > 1 is treated
      // as already-percent, which is what every hand-written formatter in the 5 apps does.
      const ratio = Math.abs(n) <= 1 ? n : n / 100
      return intlNumber(ratio, { style: 'percent', maximumFractionDigits: 1 }, `${(ratio * 100).toFixed(1)}%`)
    }
    case 'date': {
      const d = toDate(value)
      return d ? intlDate(d, { year: 'numeric', month: 'short', day: 'numeric' }, d.toDateString()) : stringify(value)
    }
    case 'datetime': {
      const d = toDate(value)
      return d
        ? intlDate(
            d,
            { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
            d.toISOString(),
          )
        : stringify(value)
    }
    case 'time': {
      const d = toDate(value)
      return d ? intlDate(d, { hour: 'numeric', minute: '2-digit' }, d.toISOString().slice(11, 16)) : stringify(value)
    }
    case 'relative-time':
      return relativeTime(value)
    case 'humanize':
      return humanize(value)
    default: {
      // The union is closed; this is the compile-time guard that a new format cannot be
      // added upstream without landing here.
      const never: never = format
      return stringify(never)
    }
  }
}

/** The last-resort string form of a value. Objects become JSON, never `[object Object]`. */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** Resolve {@link Formatted.currencyField} against a scope and apply the format. */
export function formatBound(value: unknown, fmt: Formatted | undefined, scope: Scope): string {
  const code = fmt?.currencyField ? resolveBinding(fmt.currencyField, scope) : undefined
  return applyFormat(value, fmt?.format, typeof code === 'string' ? code : undefined)
}

// ── tone ─────────────────────────────────────────────────────────────────────

/** A tone, resolved to the design tokens that draw it. Never a raw colour. */
export interface ToneTokens {
  /** Foreground / accent colour token. */
  fg: string
  /** A quiet tinted surface for a pill or a banner. */
  bg: string
  /** Border token. */
  border: string
}

/**
 * The one tone→token table.
 *
 * Solid `$` tokens only — deliberately no `color-mix()`. That function is CSS; on React
 * Native it is not a colour at all, so a tinted pill built with it renders transparent on
 * a phone while looking correct in every jsdom test. `$secondary`/`$muted` are the
 * design system's own quiet surfaces and resolve on both targets.
 */
export const TONE_TOKENS: Record<Exclude<Tone, 'auto'>, ToneTokens> = {
  neutral: { fg: '$muted-foreground', bg: '$secondary', border: '$border' },
  accent: { fg: '$primary', bg: '$accent', border: '$border' },
  success: { fg: '$success', bg: '$secondary', border: '$border' },
  warning: { fg: '$warning', bg: '$secondary', border: '$border' },
  danger: { fg: '$destructive', bg: '$secondary', border: '$border' },
  info: { fg: '$knowledge', bg: '$secondary', border: '$border' },
}

/** The tokens for a tone. `auto` is never passed here — {@link resolveTone} settles it first. */
export function toneTokens(tone: Exclude<Tone, 'auto'> = 'neutral'): ToneTokens {
  return TONE_TOKENS[tone] ?? TONE_TOKENS.neutral
}

/**
 * The `auto` vocabulary — status words a renderer may colour without being told.
 *
 * Kept SMALL on purpose. `auto` is a convenience for the obvious cases; anything with
 * domain meaning (`self_care` is good, `emergency` is not) needs a declared `toneMap`,
 * and widening this table would only make `auto` guess wrong more confidently.
 */
const AUTO_TONES: Record<string, Exclude<Tone, 'auto'>> = {
  ok: 'success',
  okay: 'success',
  good: 'success',
  done: 'success',
  complete: 'success',
  completed: 'success',
  success: 'success',
  active: 'success',
  approved: 'success',
  paid: 'success',
  ready: 'success',
  confirmed: 'success',
  open: 'info',
  pending: 'warning',
  parsing: 'info',
  processing: 'info',
  running: 'info',
  queued: 'info',
  waiting: 'warning',
  draft: 'neutral',
  new: 'info',
  review: 'warning',
  warning: 'warning',
  warn: 'warning',
  overdue: 'danger',
  late: 'danger',
  failed: 'danger',
  error: 'danger',
  cancelled: 'danger',
  canceled: 'danger',
  rejected: 'danger',
  blocked: 'danger',
  urgent: 'danger',
  critical: 'danger',
  emergency: 'danger',
  archived: 'neutral',
  inactive: 'neutral',
  unknown: 'neutral',
}

/** `tone: 'auto'`, settled from a value. Unknown values stay neutral. */
export function autoTone(value: unknown): Exclude<Tone, 'auto'> {
  if (typeof value === 'boolean') return value ? 'success' : 'neutral'
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return AUTO_TONES[key] ?? AUTO_TONES[key.replace(/_/g, '')] ?? 'neutral'
}

/**
 * Settle a {@link Toned} modifier to a concrete tone.
 *
 * Precedence, and the reason for it:
 *  1. **`toneMap` wins** when it has an entry for the keyed value. It is the DECLARED
 *     mapping — the model said what this value means, and a literal `tone` alongside it
 *     is the fallback for the values the map does not list.
 *  2. a literal `tone` (anything but `'auto'`);
 *  3. `'auto'` ⇒ {@link autoTone} over the keyed value;
 *  4. `neutral`.
 *
 * The keyed value is {@link Toned.toneOf} when present (a `surface` tinted by
 * `$.severity`), otherwise the element's own bound value.
 */
export function resolveTone(toned: Toned | undefined, ownValue: unknown, scope: Scope): Exclude<Tone, 'auto'> {
  if (!toned) return 'neutral'
  const keyed = toned.toneOf ? resolveBinding(toned.toneOf, scope) : ownValue
  if (toned.toneMap) {
    const key = String(keyed ?? '')
    const hit = toned.toneMap[key] ?? toned.toneMap[key.toLowerCase()]
    if (hit) return hit === 'auto' ? autoTone(keyed) : hit
  }
  if (toned.tone && toned.tone !== 'auto') return toned.tone
  if (toned.tone === 'auto') return autoTone(keyed)
  return 'neutral'
}
