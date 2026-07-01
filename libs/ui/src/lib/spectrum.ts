/**
 * Full-spectrum rotation helpers — spread the cozy rainbow across repeated UI
 * (avatars, sidebar items, tabs). Every value references a generated design
 * token (`--brand-1..5` / `--spectrum-1..50`); never hand-pick a hex.
 */

const SPECTRUM_STEPS = 50
const BRAND_ANCHORS = 5

/** djb2-ish stable string hash → non-negative int. */
function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

/** `var(--spectrum-N)` for N in 1..50; any integer index cycles. */
export function spectrumVar(i: number): string {
  const n = (((Math.trunc(i) % SPECTRUM_STEPS) + SPECTRUM_STEPS) % SPECTRUM_STEPS) + 1
  return `var(--spectrum-${n})`
}

/** `var(--brand-N)` for N in 1..5; any integer index cycles. */
export function brandVar(i: number): string {
  const n = (((Math.trunc(i) % BRAND_ANCHORS) + BRAND_ANCHORS) % BRAND_ANCHORS) + 1
  return `var(--brand-${n})`
}

/** Stable spectrum color for a string key (e.g. a user/space id) — max variety. */
export function spectrumColor(key: string): string {
  return spectrumVar(hashKey(key) % SPECTRUM_STEPS)
}

/** Stable brand-anchor color for a string key — for a small set of buckets. */
export function brandColor(key: string): string {
  return brandVar(hashKey(key) % BRAND_ANCHORS)
}
