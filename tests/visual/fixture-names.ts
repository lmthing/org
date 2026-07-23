/**
 * The fixture names, as a plain (React-free) list so the Playwright test runner can enumerate
 * tests at collection time without importing the JSX fixtures/primitives. A consistency test
 * asserts the harness DOM contains exactly these names, so this can never silently drift from
 * harness/fixtures.tsx.
 */
export const FIXTURE_NAMES = [
  'box-bare',
  'box-as-section',
  'text-inline-variants',
  'text-block-paragraph',
  'pressable-button',
  'pressable-anchor',
  'row-explicit',
  'col-explicit',
  'list',
  'link',
  'composite-card',
] as const
