---
name: visual-design-system
description: Load when styling any web surface (studio/chat/computer + product SPAs) — brand palette, design tokens, Tailwind v4 theme, dark mode, or component CSS. This is the CSS/visual brand system in @lmthing/css. NOT the terminal+web renderer catalog (see ui-design-system) — that's a different thing.
---

# Skill: Visual design system (@lmthing/css)

Use this when you touch the look of any web surface — `sdk/org/apps/web` (studio/chat/computer),
`@lmthing/ui`, or a product SPA (`com social team store space blog casa`, `org`): picking a color,
adding a token, writing component CSS, wiring dark mode, or fixing a `lint:tokens` failure.
All of these share ONE token-driven system in `@lmthing/css`. **Never write a raw color.**

## Read first (the grounded truth)

- `org/docs/design-system/README.md` — the one rule, what the lint gate does and does **not**
  cover, the escape hatches, theme modes, the component-styling pattern.
- `org/docs/design-system/tokens.md` — the token set, `tokens.json` → `theme.css` + manifest pipeline,
  how a token becomes a CSS var *and* a Tailwind utility, the interpolated spectrum.
- `org/docs/design-system/components.md` — the `display()`/`ask()` UI catalog (different layer; read it
  only if you are rendering agent UI rather than styling CSS).
- `org/docs/libs/ui-and-css.md` — the two packages: exports, the CSS file tree, the stylesheet convention.
- Generated indexes to grep before inventing anything (never hand-edit them): `sdk/org/libs/css/tokens.manifest.json`
  (every token — CSS var, Tailwind utility, light/dark value, and a `description` giving its semantic
  role: use that to pick a token when migrating a raw color) and `sdk/org/libs/css/COMPONENTS.md`
  (every component class + the tokens it uses).

## Procedures

**Add or change a color** — the only supported flow:

1. Edit `sdk/org/libs/css/src/tokens/tokens.json` (the single source: light + dark + description).
2. `pnpm --filter @lmthing/css generate`
3. Commit the regenerated `src/theme.css`, `tokens.manifest.json` and `COMPONENTS.md` with it.

Never hand-edit `theme.css` — it is generated and will be overwritten (`prebuild` re-runs the generator).

**Style a component** — BEM component CSS is canonical:

1. Add `sdk/org/libs/css/src/{elements,components}/<name>/index.css`: `@reference "…/theme.css"`, then
   BEM classes built with `@apply` + token utilities only.
2. Consume the classes from the React component in `@lmthing/ui` via `className` / `cn(...)`.
3. Reference shapes to copy: `src/elements/nav/app-sidebar`, `src/elements/nav/app-links`.

Inline Tailwind utilities are only for trivial one-off layout (`flex gap-2`) — don't build a component
out of long `cn('…')` utility strings.

**Check the gate before you push:**

```bash
pnpm lint:tokens                          # repo root — the roots CI actually scans
pnpm --filter @lmthing/css lint:tokens    # that package's src only
```

CI runs the same linter (`.github/workflows/design-tokens.yml`); a violation blocks the merge.
For a genuinely non-brand palette (terminal ANSI, syntax themes) mark the line `ds-lint-ok` or the file
`ds-lint-file-ok` — nothing else. Scope caveats (what the gate never scans) are in the README above; do
not assume "lint passed" means "no raw colors".

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
