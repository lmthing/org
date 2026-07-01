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
2. **Stone, not grey.** Neutrals are warm stone (`--foreground #1c1917`, `--border #e7e5e4`,
   `--muted #f5f5f4`, `--sidebar #fafaf9`). No cool grey/slate/zinc anywhere.
3. **Brand is an accent, never a CTA fill.** Primary actions use `--primary` (stone `#1c1917`).
   The cozy rainbow (`--brand-1..5`, `--spectrum-*`) is for logo letters, per-product tints,
   hover glows — not button fills.
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
| Surface | `--background` `--card` `--popover` | `#ffffff` | dark: warm stone `#1a1816`/`#211e1b` |
| Text | `--foreground` `--muted-foreground` | `#1c1917` `#57534e` | dark: `#ece8e3` `#a8a29e` |
| Primary (CTA) | `--primary` | `#1c1917` stone | **not** a brand color |
| Neutrals | `--secondary` `--muted` `--accent` | `#f5f5f4` | warm stone |
| Border/input/ring | `--border` `--input` `--ring` | `#e7e5e4` / `#cbcac8` | 1px hairline |
| Destructive | `--destructive` | `#c0502a` terracotta | errors |
| Knowledge | `--knowledge` | `#8a8f4a` sage | data / knowledge streams |
| Agent | `--agent` | `#7a4a6e` plum | AI / agent / chat streams |
| Success | `--success` | `#5d8a4a` warm green | running / online / ok |
| Warning | `--warning` | `#c2751c` warm amber | booting / pending / caution |
| Sidebar | `--sidebar-*` | `#fafaf9` family | shell chrome |

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
