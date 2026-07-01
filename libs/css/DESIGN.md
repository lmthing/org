# lmthing design system

The one design system for every lmthing surface — studio, chat, computer, and the
marketing/product SPAs (com, space, store, social, team, blog, casa). This document is
the **authoritative, human- and LLM-readable spec**. Machine-readable companions:

- **`src/tokens/tokens.json`** — the single source of truth (edit here).
- **`tokens.manifest.json`** — generated flat token index (name, cssVar, utility, light, dark, description).
- **`src/theme.css`** — generated Tailwind v4 theme (`:root` light + `[data-theme="dark"]`). **Never hand-edit.**
- **`COMPONENTS.md`** — generated catalog of every component class + the tokens it uses.

Regenerate theme + manifest after editing tokens: `pnpm --filter @lmthing/css generate`.

---

## Non-negotiable rules

1. **Never use a raw color.** No hex, no `rgb()/hsl()` with literal channels, no stock
   Tailwind color utilities (`gray-*`, `blue-*`, `green-500`, …). Use a token: the CSS
   var (`var(--foreground)`) or its Tailwind utility (`bg-primary`, `text-agent`,
   `border-border`). Enforced by `scripts/lint-design-tokens.mjs` (fails the build).
   - Allowed exceptions: `rgb/hsl(var(--…))`, and **achromatic** overlays/scrims/shadows
     with alpha < 1 (`rgba(0,0,0,.5)`, `rgba(255,255,255,.7)`).
   - Genuinely non-brand color sets (terminal ANSI palettes, code syntax themes) put
     `ds-lint-file-ok` in a top comment; single lines use a `ds-lint-ok` comment.
2. **Stone, not grey — warmly tinted.** Text/neutrals stay warm stone (`--foreground
   #1c1917`, `--muted-foreground #57534e`); surfaces carry a faint warm brand tint
   (`--background #fffdfb`, `--card #fffaf6`, `--border #efe6df`, `--sidebar #fdf5ef`).
   No cool grey/slate/zinc anywhere.
3. **Colorful: brand leads.** Primary actions, focus rings and active states use brand coral
   (`--primary`/`--ring`/`--sidebar-primary` = `#f38358`, brand-3) with warm-near-black text
   (`--primary-foreground #2b1a12`). Functional colors are saturated (vivid green/amber/plum/
   sage). The full cozy rainbow (`--brand-1..5`, `--spectrum-*`) is rotated across sidebar
   sections, tabs and avatars — see "Full-spectrum rotation" below.
4. **THING is multi-color.** Render the wordmark with `CozyThingText`
   (`@lmthing/ui/elements/branding/cozy-text`) — each letter its own brand color
   (t=1 h=2 i=3 n=4 g=5). Never a single solid color.
5. **Icons: Lucide/Heroicons outline only** — `stroke="currentColor"`, `stroke-width 1.5`,
   `fill="none"`. No filled icons, no emoji in end-user UI.
6. **One theme, two modes.** Every app imports `@lmthing/css/theme.css`; no app redefines
   tokens. Dark mode = `data-theme="dark"` on `<html>` (set by `applyTheme` in `@lmthing/ui/theme`).

## Palette (see tokens.manifest.json for the full list + dark values)

| Role | Token | Light | Notes |
|---|---|---|---|
| Brand (THING letters) | `--brand-1..5` | `#f5c815 #f9a94a #f38358 #ed92a1 #d59ec8` | yellow→amber→coral→rose→orchid; same in dark |
| Product accents | `--spectrum-1..50` | ramp brand-1→brand-5 | interpolated; same in dark |
| Surface | `--background` `--card` `--popover` | `#fffdfb` / `#fffaf6` | faint warm tint; dark `#1a1512`/`#221c18` |
| Text | `--foreground` `--muted-foreground` | `#1c1917` `#57534e` | dark: `#ece8e3` `#a8a29e` |
| Primary (CTA) | `--primary` / `--primary-foreground` | `#f38358` / `#2b1a12` | **brand coral** (brand-3) + warm-dark text |
| Neutrals | `--secondary` `--muted` `--accent` | `#f7f1ec` / accent `#fbe7dd` | warm; accent = coral tint |
| Border/input/ring | `--border` `--input` `--ring` | `#efe6df` / `#f38358` | ring = brand coral |
| Destructive | `--destructive` | `#bd3b28` red-terracotta | errors (distinct from coral primary) |
| Knowledge | `--knowledge` | `#8f9a2b` vivid sage | data / knowledge streams |
| Agent | `--agent` | `#944a80` vivid plum | AI / agent / chat streams |
| Success | `--success` | `#4f9a2f` vivid green | running / online / ok |
| Warning | `--warning` | `#dd8410` vivid amber | booting / pending / caution |
| Sidebar | `--sidebar-*` | `#fdf5ef` family; primary `#f38358` | shell chrome; coral active item |

### Full-spectrum rotation

For the colorful look, rotate the cozy rainbow across repeated UI: pick a brand/spectrum
color by index or by a stable hash of the item's id. Use the `spectrumColor(key)` /
`spectrumVar(i)` helpers in `@lmthing/ui/lib/spectrum` (avatars, sidebar section accents,
tabs). Colors come from `--brand-1..5` / `--spectrum-1..50` — never hand-pick hex.

Non-color scales: `--radius-sm/md/lg/xl/full`, `--font-sans/display/mono` (Cera Round Pro Bold).

## Migrating a raw color → token

Pick by **semantic role** first, then by lightness for neutrals. Use `color-mix(in srgb,
var(--token) N%, transparent)` for tints and `/NN` opacity for utilities (`bg-agent/10`).

| Raw color you see | Use |
|---|---|
| violet/purple `#8b5cf6 #7c3aed #a78bfa #c4b5fd #6d28d9 #a855f7` | `var(--agent)` (AI/agent) |
| blue/cyan `#3b82f6 #1d4ed8 #dbeafe #06b6d4 #58a6ff` | no blue in brand → `var(--agent)` (accent) or `var(--knowledge)` if "data/info" |
| green `#10b981 #15803d #3fb950` | `var(--success)` (status) or `var(--knowledge)` (data); light `#dcfce7` → `color-mix(… var(--success) 15%, transparent)` |
| amber/yellow `#f59e0b #d97706 #eab308` + `yellow-500/700` | `var(--warning)` |
| red `#ef4444 #dc2626 #fca5a5` + light `#fee2e2 #fef2f2` | `var(--destructive)` / tint via color-mix |
| near-white `#ffffff #f8fafc #f9fafb #fafaf7` | `var(--card)` / `var(--background)` |
| light grey `#e2e8f0 #e5e7eb #d1d5db #cbd5e1 #ccc` | `var(--border)` |
| mid grey `#94a3b8 #a8a29e` | `var(--muted-foreground)` |
| dark grey/slate `#334155 #475569 #374151` | `var(--foreground)` (text) / `var(--muted-foreground)` |
| near-black `#111 #222 #333 #1a1a1a #1c1917` | `var(--foreground)` |
| stock tailwind `text-green-500` etc. | token utility: `text-success`, `bg-warning`, `text-agent`, `border-destructive` |

If a color is **decorative brand** (marketing gradient, slide accent) with no semantic role,
use `--brand-1..5` / `--spectrum-*`. If it's a **non-brand palette** (terminal, syntax
highlighting) it stays raw — mark the file `ds-lint-file-ok`.

## Component styling pattern (canonical)

**BEM component CSS is the canonical way to style a component.** A component owns a
stylesheet under `libs/css/src/{elements,components}/<name>/index.css` using
`@reference "…/theme.css"` + `@apply` with tokens, and BEM class names
(`.name`, `.name__part`, `.name--modifier`). The React component imports that CSS
(`import '@lmthing/css/elements/<name>/index.css'`) and references the classes via
`className` / `cn(...)`. See `elements/nav/app-sidebar` and `elements/nav/app-links`
for the reference shape; the generated `COMPONENTS.md` catalogs every class.

- **Inline Tailwind utilities** are fine only for *trivial, one-off layout*
  (`flex gap-2`, `mt-1`) — not for a component's substantive styling. Do not build a
  whole component out of long `cn('… bg-muted …')` utility strings; extract those to a
  BEM stylesheet so the styling is discoverable and themeable in one place.
- **Never** hand-author raw colors or spacing that duplicates a token; use the token
  utility (`bg-muted`, `text-agent`, `border-border`) or `var(--token)`.

### Legacy `--lm-*` bridge (chat surface)

The chat Ink-terminal components (`chat/app/tree|inspector|replay`, `chat/compat/*`,
`chat/components/forms/*`) still use `--lm-*` / `lm-*` class names. These are **not** a
separate palette — `chat/app/styles.css` aliases every `--lm-*` to a shared token
(`--lm-bg: var(--background)`, `--lm-accent: var(--agent)`, …), so they are theme-aware
and pass the lint gate. Treat `lm-*` as sanctioned; don't churn it to `bg-background`
etc. New chat code should prefer the shared tokens directly.
