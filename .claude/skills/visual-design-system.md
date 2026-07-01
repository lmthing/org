---
name: visual-design-system
description: Load when styling any web surface (studio/chat/computer + product SPAs) — brand palette, design tokens, Tailwind v4 theme, dark mode, or component CSS. This is the CSS/visual brand system in @lmthing/css. NOT the terminal+web renderer catalog (see ui-design-system) — that's a different thing.
---

# Skill: Visual design system (@lmthing/css)

One token-driven design system for every web surface. Warm "cozy rainbow" brand anchored
in warm-stone neutrals; the shared theme + component CSS live in `libs/css` and every app
(`apps/web` and the repo-root SPAs `com/space/store/social/team/blog/casa`) imports it.

## Source of truth & generation

- **Edit tokens in `libs/css/src/tokens/tokens.json`** — the single source (light + dark + descriptions).
- Regenerate outputs: `pnpm --filter @lmthing/css generate` — writes:
  - `libs/css/src/theme.css` (Tailwind v4 `@theme` + `@theme inline` + `:root` light + `[data-theme="dark"]`). **Never hand-edit.**
  - `libs/css/tokens.manifest.json` (flat token index for humans + LLMs).
  - `libs/css/COMPONENTS.md` (catalog of every component class + tokens it uses).
- The full rulebook + raw→token mapping table: **`libs/css/DESIGN.md`** (read it before styling anything).

## The rules (enforced)

1. **No raw colors.** No hex, no literal `rgb()/hsl()`, no stock Tailwind color utilities
   (`gray-*`, `blue-*`, `green-500`). Use a token: `var(--foreground)` or a token utility
   (`bg-primary`, `text-agent`, `border-border`). Allowed: `rgb/hsl(var(--…))` and achromatic
   alpha overlays (`rgba(0,0,0,.5)`).
2. **Stone, not grey** · **brand is an accent, never a CTA fill** (CTAs use `--primary`) ·
   **THING is multi-color** via `CozyThingText` · **outline icons only**.
3. Dark mode = `data-theme="dark"` on `<html>` (set by `applyTheme` in `@lmthing/ui/theme`).

## Enforcement (hard gate)

`libs/css/scripts/lint-design-tokens.mjs` flags violations and fails the build.
- Run locally: `pnpm --filter @lmthing/css lint:tokens` (or any consumer's `lint:tokens`),
  repo-wide `pnpm lint:tokens` from the root, CI: `.github/workflows/design-tokens.yml`.
- Escape hatches for genuinely non-brand color sets (terminal ANSI, syntax themes): a
  `ds-lint-ok` comment on a line, or `ds-lint-file-ok` anywhere in a file.

## Layout

- `@lmthing/css` — tokens (`theme.css`) + ~63 BEM component stylesheets under
  `src/{elements,components}/**` (import via `@lmthing/css/elements/…` / `/components/…`).
- `@lmthing/ui` — React components that consume those classes (depends on `@lmthing/css`).
  Primitives in `src/elements/**` (Button/Badge/Input/Card/…); surfaces in `chat/ studio/ computer/`.

## Styling a component (canonical pattern)

BEM component CSS is canonical: give the component a stylesheet at
`src/{elements,components}/<name>/index.css` (`@reference "…/theme.css"` + `@apply` with
tokens + BEM classes) and reference the classes via `className`/`cn(...)`. Inline Tailwind
utilities are only for trivial one-off layout (`flex gap-2`) — don't build a component out of
long `cn('…')` utility strings. Reference shape: `elements/nav/app-sidebar`,
`elements/nav/app-links`. Full spec + the `--lm-*` chat bridge → [DESIGN.md](../../libs/css/DESIGN.md).

## Adding/adjusting a color

Edit `tokens.json` → `pnpm --filter @lmthing/css generate` → the new token is available as
`var(--x)` and `bg-x`/`text-x` everywhere. Never introduce a color outside this flow.
