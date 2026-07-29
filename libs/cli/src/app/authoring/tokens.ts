/**
 * The design tokens that are **invisible when used as a text colour**.
 *
 * `libs/css/src/theme.css` registers every colour token in Tailwind's `@theme`, so Tailwind
 * generates the whole utility family — `bg-`, `border-`, **and `text-`** — for each one. That means
 * `text-muted` is a perfectly valid utility that compiles clean, even though `--muted` is defined as
 * *"Muted background — warm"*: a page-background-coloured fill. The text token is `--muted-foreground`.
 *
 * Found live: a generated app shipped **149 uses of `text-muted`**, rendering body copy at a WCAG
 * contrast ratio of **1.08** against the page (AA requires 4.5). The text was simply not there.
 * Nothing caught it — `lint-design-tokens.mjs` only matches stock Tailwind families with a numeric
 * scale (`gray-500`), and it never runs over project-app source at all.
 *
 * ## How this list is derived (and kept honest)
 *
 * `libs/css/src/tokens/tokens.json` carries a machine-readable `role` on every colour:
 * `"text"` for the `*-foreground` family (colours designed to be legible ON a surface) and
 * `"surface"` for everything else. `role` is the only usable signal — `group` is a semantic family
 * and puts `muted` and `muted-foreground` in the SAME group (`intent`).
 *
 * A `role: "surface"` token is listed here when it is **unreadable at any size**: worst-case WCAG
 * contrast below **2:1** against both `--background` and `--card`, in both the light and dark theme
 * (or, for the alpha overlays, an alpha under 0.6). `tokens.test.ts` recomputes exactly that from
 * `tokens.json` and asserts this constant matches, so a palette edit can never silently drift.
 *
 * The 2:1 cut is deliberately the **invisible** class, not the *low-contrast* class. Tokens like
 * `primary` (2.47) and `warning` (2.74) are below AA but are legible, idiomatic and used hundreds of
 * times across the shipped store apps; rejecting them at write time would block a great deal of
 * working, intentional code. That is a design-review concern, not a save-time error.
 */

/** Tokens whose `role` is `surface` and which are unreadable as text (contrast < 2:1). */
export const INVISIBLE_AS_TEXT: readonly string[] = [
  'accent',
  'active',
  'background',
  'border',
  'brand-1',
  'brand-2',
  'card',
  'disabled',
  'focus',
  'hover',
  'input',
  'muted',
  'neutral',
  'neutral-1',
  'popover',
  'scrim',
  'secondary',
  'sidebar',
  'sidebar-accent',
  'sidebar-background',
  'sidebar-border',
];

/**
 * The token to use instead of an invisible one. A surface token with a declared `*-foreground`
 * partner points at that partner; the rest fall back to the default body-text token.
 */
export function textTokenFor(surface: string): string {
  const paired = new Set(['accent', 'card', 'popover', 'secondary', 'muted', 'sidebar']);
  if (paired.has(surface)) return `${surface}-foreground`;
  if (surface === 'sidebar-background' || surface === 'sidebar-accent') return 'sidebar-foreground';
  if (surface === 'disabled') return 'disabled-foreground';
  return 'muted-foreground';
}
