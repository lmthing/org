# Three stock-Tailwind colours in component CSS, invisible to `lint:tokens`

**Symptom.** After phase 4 inlined `@apply`, `lint:tokens` flagged four raw values that had been in
the stylesheets all along, expressed as Tailwind class names the linter cannot see:

| file | was | expands to |
|---|---|---|
| `components/computer/ide-file-tree.css` | `bg-black/50` | `color-mix(in srgb, #000 50%, transparent)` |
| `components/workflow/step-card/index.css` | `ring-offset-2` | `#fff` (Tailwind's `--tw-ring-offset-color` default) |
| `components/workflow/step-card/index.css` | `text-white` | `#fff` |

**Attribution.** `lint-design-tokens.mjs` scans for raw *values* (`#hex`, `rgb()`, `hsl()`). A stock
Tailwind colour utility is a class NAME, so `bg-black/50` and `text-white` passed the gate for as long
as they were unexpanded. The design-system rule explicitly forbids "stock Tailwind color utilities
like `gray-*`/`blue-*`" — these are the same violation, undetected.

All four are currently marked `ds-lint-ok` with the reason at the site, so the gate is green and the
history is legible.

**Proposed fix.**
1. `bg-black/50` scrim — arguably fine as-is: the documented exception allows achromatic
   overlays/scrims with alpha < 1. Consider a `--scrim` token so it stops being a judgement call.
2. `ring-offset-2`'s `#fff` should be `var(--background)`; as written the ring offset stays white in
   dark mode, which is likely a visible bug on `.step-card--expanded`.
3. `text-white` should be `var(--primary-foreground)` (the text sits on `var(--brand-3)`).

(2) and (3) are visible changes, which is why phase 4 marked rather than fixed them.

**Also worth doing:** teach `lint-design-tokens.mjs` about stock Tailwind colour utilities
(`bg-black`, `text-white`, `*-gray-500`, …) so this class of violation is caught in source. Now that
no stylesheet uses `@apply`, the only place they can appear is a `className`, which the linter already
reads.

**Verify:** `pnpm --filter @lmthing/css lint:tokens` green with no `ds-lint-ok` escapes for these
three, and `.step-card--expanded` shows a background-coloured ring offset in dark mode.
