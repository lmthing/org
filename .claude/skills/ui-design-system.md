---
name: ui-design-system
description: Load when working on the cross-platform component vocabulary (catalog), the display/form renderers, the ink-compatibility layer, or theming.
---

# Skill: UI + Design System (terminal + web)

Load this when you touch the **built-in component catalog** (the `display()`/`ask()` vocabulary),
either **descriptor renderer** (Ink terminal / web React), the **form** flatten/coerce path, the
**ink-compat** layer, or **theming / design tokens**. This file holds no knowledge — it points at the
docs that do, plus the procedures for changing this code safely.

## Read first (source of truth)

| To learn… | Read |
|---|---|
| the catalog (display + form tables, props, how it reaches the model, the two renderers, the form pipeline) | `org/docs/design-system/components.md` |
| the design-system rules: never a raw color, the lint gate, what it does *not* cover, the escape hatches | `org/docs/design-system/README.md` |
| the token set, `tokens.json` → `theme.css` + Tailwind utilities, the spectrum ramp, light/dark | `org/docs/design-system/tokens.md` |
| what `@lmthing/css` and `@lmthing/ui` export, elements/hooks/lib, theme control, how an app wires it | `org/docs/libs/ui-and-css.md` |
| `display()` / `ask()` semantics from the agent's side, and how a descriptor is dispatched | `org/docs/runtime-globals/conversation.md` |
| a *space's own* `components/` (view + form) vs. the universal catalog | `org/docs/format/space/components/README.md` · `org/docs/format/space/components/form.md` |

Generated indexes to grep before inventing anything (both rebuilt by `pnpm --filter @lmthing/css
generate` — never hand-edit): `sdk/org/libs/css/COMPONENTS.md` (every component class + the tokens it
uses) and `sdk/org/libs/css/tokens.manifest.json` (every token's CSS var, Tailwind utility, light/dark
value, semantic-role description).

## Where the code lives (navigation only)

- Catalog + form normalization: `libs/core/src/ui/{catalog.ts,form.ts}` (browser-safe entry `@lmthing/core/ui`).
- Terminal renderer + form: `libs/cli/src/render/{ink-renderer.tsx,ink-form.tsx}`.
- Web renderer + form: `libs/ui/src/chat/components/{render-descriptor.tsx,forms/CatalogForm.tsx}`.
- Ink-compat for the browser: `libs/ui/src/chat/compat/` — `libs/cli/src/web/serve.ts` aliases bare
  `ink` / `ink-text-input` / `ink-select-input` imports here (`serve.ts:L43-L45`), and injects a space's
  optional `theme.json` as `:root` overrides (`serve.ts:L49-L52`).
- Tokens + generated theme: `libs/css/src/tokens/tokens.json` → `libs/css/src/theme.css` (generated).
- Runtime theme switch: `libs/ui/src/theme/theme.ts`.

## Procedures

**Add or change a catalog component** — the catalog is one table feeding three consumers (VM stubs,
DTS, system prompt), so a partial change silently breaks one of them:

1. Edit the entry in `libs/core/src/ui/catalog.ts` (props are verbatim TS type literals).
2. Implement it in **both** renderers — `libs/cli/src/render/ink-renderer.tsx` and
   `libs/ui/src/chat/components/render-descriptor.tsx`. A type present in one only is a parity bug.
3. If it is a form control, wire its kind/coercion in `libs/core/src/ui/form.ts` and render it in
   **both** `ink-form.tsx` and `CatalogForm.tsx`.
4. Extend the shared parity fixtures: `cd sdk/org && pnpm test libs/core/src/ui libs/cli/src/render libs/ui/src/chat`
   (`render-catalog.web.test.tsx` and `ink-renderer.test.tsx` assert the two renderers agree).
5. Update `org/docs/design-system/components.md` in the SAME change.

**Change a color / token:**

```bash
# 1. edit sdk/org/libs/css/src/tokens/tokens.json   (never theme.css — it is generated)
pnpm --filter @lmthing/css generate    # rewrites src/theme.css, tokens.manifest.json, COMPONENTS.md
pnpm lint:tokens                       # from the REPO ROOT — the hard CI gate
```
Commit the regenerated files with the `tokens.json` change, and update `org/docs/design-system/tokens.md`.

**Style anything on the web:** use a token (`var(--foreground)`, `bg-primary`) — never a hex, never a
literal `rgb()/hsl()`, never a stock Tailwind color (`gray-*`, `blue-*`). Rotation colors come from
`@lmthing/ui/lib/spectrum`, never a hand-picked hex. Rules + escape hatches:
`org/docs/design-system/README.md`.

**Never import the full `@lmthing/core` barrel from web code** — use `@lmthing/core/ui`. The barrel pulls
Node built-ins into the browser bundle.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
