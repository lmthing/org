# Migrating `chat` + `studio` to Tamagui (universal / RN-compatible) — **without breaking web styles**

> Status: proposal / plan. Target branch: `claude/react-native-mobile-exploration-vafu9o`.
> Scope: make `libs/ui/src/chat/**` and `libs/ui/src/studio/**` render on **both** web (unchanged)
> and React Native, by moving them onto Tamagui universal primitives. `computer/*` (Monaco, xterm,
> resizable-panels) stays web-only and is explicitly **out of scope**.

---

## 0. The one hard constraint

**The web rendering of `chat` and `studio` must stay visually the same at every step of the migration.**
"Ship it and eyeball it" is not acceptable. Every component conversion is gated by an automated proof
that its rendered web output still matches the pre-migration baseline. Nothing merges that regresses.

This document is therefore ~60% about the **proof harness** and ~40% about the migration itself, because
the proof harness is what makes the migration safe.

### What "the same style" means precisely

Pixel-for-pixel byte-identical screenshots are **not** the bar and never will be — Tamagui emits its own
CSS class names and rule ordering, so anti-aliasing and sub-pixel rounding can differ by a hair. The
enforceable, honest definition of parity we test against is the conjunction of three things:

1. **Token parity (exact).** Every design token (color, radius, spacing, font, the 50-stop spectrum ramp)
   resolves to the **byte-identical** CSS value it resolves to today. This is an equality assertion, not a
   threshold.
2. **Computed-style parity (exact, on an audited property set).** For every migrated component, the
   browser's `getComputedStyle` for an audited list of properties (below) is **equal** to the baseline
   captured from `main`. This is where box-model regressions are caught deterministically.
3. **Visual parity (threshold).** A Playwright screenshot of the component/page differs from its `main`
   baseline by **≤ 0.1% of pixels** (`maxDiffPixelRatio: 0.001`) at `deviceScaleFactor: 1`, fonts loaded,
   animations frozen. This catches anything the property list missed.

A conversion is "done" only when all three pass. (1) and (2) are exact; (3) absorbs rendering-engine noise
only. If (3) drifts while (1) and (2) hold, the threshold is investigated, never blindly raised.

---

## 1. Why parity is achievable — and the one place it is genuinely at risk

**Why it's achievable.** `tokens.json` is already the single source of truth (`libs/css/src/tokens/tokens.json`),
compiled to `theme.css` by `libs/css/scripts/generate-theme.mjs`. If we generate the Tamagui config from the
**same** `tokens.json` and assert value-equality against `theme.css`, colors/spacing/radii/fonts cannot drift
by construction. And `chat`/`studio` have none of the hard web-only deps (no Monaco, no xterm, no
resizable-panels, no Radix — Radix lives only in the shared `elements/` layer; see §6). Their "IDE-ness" is
textareas + forms + lists + lucide icons, all of which have direct Tamagui/RN equivalents.

**The one real risk: the `div` → `Stack` box-model default mismatch.** This is the #1 way a naive migration
silently breaks layouts, so we design around it explicitly.

| Property | Browser `<div>` (block) | Tamagui `Stack` / RN default | Consequence if ignored |
|---|---|---|---|
| `display` | `block` | `flex` | children stack differently; width/height behavior changes |
| `flex-direction` | n/a | `column` | inline-ish rows collapse to columns |
| `align-items` | n/a | `stretch` | child cross-size changes |
| `flex-shrink` | `1` (flex children) | **`0`** (RN) | text/overflow no longer shrinks |
| `box-sizing` | `content-box` | `border-box` | padding math differs |
| `min-width` / `min-height` | `auto` | `auto` (web) / `0` (RN) | flex overflow differs |
| `position` | `static` | `relative` | abs-positioned descendants reparent |

The mitigation is a **compatibility primitive layer** (§4): the codemod does **not** blindly turn every
`<div>` into `<YStack>`. It maps to primitives whose web output is configured to reproduce the *previous*
box model, and the computed-style test (§3, layer 2) asserts we got it right on every element. This turns an
invisible risk into a caught-at-CI failure.

---

## 2. Safety architecture: golden-master first, strangler-fig migration

We never "convert and hope." The sequence for the whole project and for every single component is:

```
        ┌─────────────────────────────────────────────────────────────┐
        │  STEP A — capture baselines from `main` (BEFORE any change)   │
        │  golden screenshots + golden computed-style JSON per fixture  │
        └─────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────▼──────────────────────────────────┐
        │  STEP B — migrate ONE component to Tamagui on the branch      │
        └──────────────────────────┬──────────────────────────────────┘
                                   │
        ┌──────────────────────────▼──────────────────────────────────┐
        │  STEP C — re-render the SAME fixture; assert:                 │
        │    L1 token parity · L2 computed-style parity · L3 visual ≤θ  │
        │  fail ⇒ fix the primitive/props, never the threshold          │
        └───────────────────────────────────────────────────────────────┘
```

Baselines are captured once from `main`, committed as binary golden files, and are the immovable reference for
the entire migration. Because Tamagui and the existing CSS **coexist** (§5), the app is shippable at every
commit — a half-migrated tree still renders correctly on web.

---

## 3. The three-layer proof harness (built first, before any component moves)

### Layer 1 — Token-equivalence unit test (the root guarantee)

A vitest test that parses **both** outputs of `tokens.json` and asserts equality:

- Parse `libs/css/src/theme.css` → map of CSS custom properties (`--background`, `--brand-3`, `--radius-md`,
  `--spectrum-0..49`, `--font-sans`, …) → resolved value, for both `:root` and `[data-theme="dark"]`.
- Load the generated `tamagui.config.ts` (§5) → its token + theme values.
- Assert: for every token, `tamagui value === theme.css value` byte-for-byte (normalizing only `rem`↔`rem`,
  hex casing). Any mismatch fails CI.

This makes color/spacing/radius/font drift **structurally impossible** — the two artifacts are proven to be
the same numbers. File: `libs/css/src/__tests__/token-parity.test.ts`.

### Layer 2 — Computed-style contract test (deterministic box-model proof)

For each fixture in the visual harness (§3.1), Playwright walks the rendered subtree and, for every element,
records `getComputedStyle` for an **audited property set**, then compares the migrated render against the
`main` baseline for that fixture:

```
AUDITED_PROPERTIES = [
  // box model
  'display','position','box-sizing','width','height','min-width','min-height','max-width','max-height',
  'margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left',
  'border-top-width','border-right-width','border-bottom-width','border-left-width',
  'border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius',
  // flex
  'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','align-items','align-self',
  'justify-content','gap','row-gap','column-gap',
  // paint / type
  'color','background-color','border-top-color','opacity',
  'font-family','font-size','font-weight','line-height','letter-spacing','text-align','text-transform',
  'box-shadow','overflow-x','overflow-y','z-index',
]
```

Comparison is **exact** (string equality of resolved values). Elements are matched between baseline and
candidate by a stable `data-testid`-derived path so structural changes are visible. This is the layer that
catches a `flex-shrink: 0` or `display: flex` regression the instant it happens, with a precise element-level
diff — far more actionable than a pixel blob. Files: `tests/visual/computed-style.spec.ts` +
`tests/visual/extract-computed-styles.ts`.

### Layer 3 — Visual regression (Playwright screenshot diff)

`await expect(locator).toHaveScreenshot('<fixture>.png', { maxDiffPixelRatio: 0.001, animations: 'disabled' })`
against the `main` baseline, per fixture and per full page (`/chat`, key `/studio` routes). Playwright's
built-in pixel diff; no extra deps. Threshold is a noise budget, not a license to drift.

### 3.1 The visual harness (how components are rendered in isolation, deterministically)

A dev-only route `apps/web/src/routes/__visual/` (excluded from production builds) mounts every `chat`/`studio`
/`elements` component against **frozen fixtures**:

- One `Fixture` entry per component × per meaningful variant/state (e.g. Button: default/hover-static/disabled/
  loading/`asChild`; Message: user/assistant/tool/error; each Studio panel with seeded data).
- Deterministic rendering controls, applied globally in the harness:
  - `document.fonts.ready` awaited before any capture (the custom `TypeMates Cera Round Pro Bold` face is
    loaded via `@font-face`; without this, diffs are pure font-swap noise).
  - All CSS transitions/animations disabled; caret-blink disabled; `prefers-reduced-motion` forced.
  - Time frozen and RNG seeded via fixtures (no `Date.now()`/random in fixture data).
  - Fixed viewport (e.g. 1280×800) and `deviceScaleFactor: 1`; both light and dark themes captured
    (`[data-theme]` toggled) since the token set is theme-first.
  - Network-dependent widgets fed static props (no live pod calls — fixtures only).

The **same** harness renders both the `main` baseline and the migrated branch, so the only variable is the
component implementation.

### 3.2 Playwright setup

No Playwright today — we add it (Chromium is pre-installed at `/opt/pw-browsers`; do **not** run
`playwright install`). `playwright.config.ts` targets `vp preview` (the production build → real `theme.css`,
minified, deterministic), pinned Chromium, one project per theme. Baselines live in
`tests/visual/__screenshots__/` and `tests/visual/__computed__/`, committed from `main`.

---

## 4. The compatibility primitive layer (`@lmthing/ui-primitives`)

The heart of "won't break web." Instead of hand-mapping 1,000 tags to raw Tamagui components, we define a
thin primitive set whose **web output reproduces the current box model**, and whose **native output is
correct RN**. Tamagui `styled()` factories, one config, two render targets.

| Primitive | Replaces | Web behavior (must match today) | Native behavior |
|---|---|---|---|
| `<Block>` | `<div>` used as a block container | `styled(Stack, { display: 'flex' })` **with the block-compat resets**: `flexShrink: 1`, `alignItems: 'stretch'`, `boxSizing: 'border-box'`, direction per usage | RN `View` (flex) |
| `<Row>` / `<Col>` | flex `<div>`s | explicit `flexDirection` row/column (no reliance on defaults) | `View` |
| `<Text>` | `<span>`/`<p>`/headings | `styled(TamaguiText)` mapping `font-*`, `line-height`, `letter-spacing` from tokens | RN `Text` |
| `<Pressable>` | `<button>` / clickable `<div>` | renders `<button>`/role, `onPress`→`onClick` | RN `Pressable` |
| `<TextField>` / `<TextArea>` | `<input>` / `<textarea>` | Tamagui `Input`/`TextArea` themed to match `.input` | RN `TextInput` |
| `<Icon>` | lucide-react / inline `<svg>` | `@tamagui/lucide-icons` (web) | `@tamagui/lucide-icons` (native, via react-native-svg) |

Rules that keep this honest:
- The codemod (§7) is **conservative**: ambiguous `<div>`s become `<Block>` (block-compat), never a bare
  `YStack`. Layout `<div>`s that were already `display:flex` in CSS become `<Row>`/`<Col>` with explicit
  direction. The computed-style test proves each choice.
- No primitive relies on a Tamagui/RN default that differs from the browser default; every box-model property
  that mattered is set explicitly.
- The primitive package has its **own** Layer-1/2/3 tests first — we prove `<Block>`/`<Text>`/`<Pressable>`
  match a plain `div`/`span`/`button` **before** migrating any real component onto them.

---

## 5. Token → `tamagui.config.ts` generator (+ coexistence)

- New script `libs/css/scripts/generate-tamagui-config.mjs`, a **sibling of `generate-theme.mjs` reading the
  same `tokens.json`**. Wired into `libs/css` `generate`/`prebuild` so the two artifacts can never diverge.
  - `theme.radius-*` / `font-*` → Tamagui `tokens.radius` / `tokens.size` / `fonts`.
  - `colors[].{light,dark}` → Tamagui `themes.light` / `themes.dark` (theme-first, matches
    `[data-theme="dark"]`).
  - `spectrum` 50-stop ramp → `tokens.color.spectrum0..49`.
- **Coexistence during migration:** `theme.css` is **not** removed. Tamagui's web output and the existing
  Tailwind/`theme.css` classes live side by side; a component is migrated only when its parity tests pass, and
  the old CSS for it is deleted only after. The app is fully working on web at every commit.
- Extend the existing `lint-design-tokens.mjs` philosophy: the generator output is checked in and a CI test
  fails if `generate-tamagui-config.mjs` would produce a diff (same pattern as the theme.css check), so the
  config is never stale.

---

## 6. Build integration (both platforms, web kept intact)

- **Web (existing Vite / `vite-plus`):** add `@tamagui/vite-plugin` alongside the current
  `@vitejs/plugin-react` + `@tailwindcss/vite`. The Tamagui optimizing compiler is enabled for parity with
  native and for zero-runtime CSS. Existing pipeline untouched; `theme.css` still imported.
- **Native (new):** Expo app (`apps/mobile`) + Metro + `@tamagui/babel-plugin`. Navigation via **Expo
  Router** (TanStack Router is web-only and does **not** port — but routing is thin glue; the screens in
  `libs/ui` are what port). Custom font loaded via `expo-font`.
- **Shared, reused as-is (no refactor):** `libs/state` `PodTransport` (DOM-free REST client) + the DOM-free
  state logic + `tokens.json`. A new `@lmthing/mobile-client` re-exports these for the Expo app.
- **Radix** (shared `elements/` only, 8 files: dialog, sheet, dropdown, label, separator, avatar,
  button-`Slot`, ide-file-tree's context-menu) → **Tamagui's own universal** `Dialog`/`Sheet`/`Select`/
  `Popover`/`Label`/`Separator`/`Avatar` + `asChild`. Each replacement gets the same 3-layer parity gate.
  (`ide-file-tree` is `computer/*` → out of scope, stays Radix.)

---

## 7. Migration sequence (strangler-fig, each step CI-gated)

Order chosen so the foundation is proven before anything depends on it:

1. **Harness + Playwright + baselines from `main`** (§3). Capture golden screenshots + computed styles for
   every current `chat`/`studio`/`elements` fixture. **No product code changes.** This PR is pure safety net.
2. **`tamagui.config.ts` generator + Layer-1 token-parity test** (§5). Green before any component moves.
3. **`@lmthing/ui-primitives` + its own parity tests** (§4). Prove `Block`/`Text`/`Pressable`/`TextField`/
   `Icon` match `div`/`span`/`button`/`input`/`svg` in isolation.
4. **Shared `elements/` layer** (39 components) — the base others compose from. Button (+`Slot`→`asChild`),
   overlays (Radix→Tamagui), typography, forms, layouts. Each gated.
5. **`chat`** (~44 components) — most self-contained; migrate leaf→root, each gated.
6. **`studio`** (~48 components) — forms/lists/textareas/lucide via the same primitives. Forked leaves:
   - `studio/knowledge/field/field-tree` (arborist) → `FlatList`-based tree; parity vs baseline on web.
   - `apps/web/src/routes/studio/$projectId/app/preview` (iframe) → `.web.tsx` keeps `iframe`,
     `.native.tsx` uses `react-native-webview`. Web fixture proves the iframe render is unchanged.
   - `component-editor` / app `files` textareas → `<TextArea>`; parity vs `.input` baseline.
7. **Browser-global shims** (~15–20 touchpoints: `localStorage`→AsyncStorage, `window`/`document` listeners
   →`Dimensions`/`AppState`, `navigator.clipboard`→RN `Clipboard`, `getBoundingClientRect`→`onLayout`). Behind
   a tiny `platform/` module with `.web`/`.native` files; web implementations are the current code verbatim
   (so web is provably unchanged).
8. **Delete superseded CSS** for fully-migrated components; re-run full suite.

Each of steps 4–6 is many small PRs (a few components each), every one blocked by the three parity layers.

---

## 8. CI gates & guardrails

- **New CI jobs:** `test:token-parity` (L1), `test:computed-style` (L2), `test:visual` (L3). All three
  required on every PR touching `chat`/`studio`/`elements`/`ui-primitives`/`css`.
- **RN-safety lint** (mirrors the existing `lint:tokens` gate): an ESLint/AST rule forbidding
  `libs/ui/src/chat/**` and `libs/ui/src/studio/**` from importing raw JSX host tags, `@radix-ui/*`, or any
  web-only dep. Once a subtree is migrated, this keeps it RN-safe forever. `computer/*` is exempt.
- **Baseline update is a deliberate, reviewed act:** golden files change only via an explicit
  `--update-snapshots` PR with visual diff images in the description — never silently.

---

## 9. Honest risks & mitigations

| Risk | Mitigation |
|---|---|
| `div`→flex box-model drift | Compat primitives (§4) + exact computed-style test (L2) catches every element |
| Tamagui CSS ordering/specificity vs Tailwind during coexistence | Migrate leaf→root; scope Tamagui output; L3 visual gate per step |
| Font-swap noise in screenshots | `document.fonts.ready` gate; pinned Chromium; `deviceScaleFactor:1` |
| Custom font not on native | `expo-font` preload; font declared in Tamagui config |
| Threshold creep hiding real regressions | Thresholds are a noise budget only; L1+L2 are exact; raising θ requires justification in review |
| Routing/nav rewrite (TanStack→Expo Router) | Out of the parity contract (native-only surface); screens are the shared, tested unit |
| Tamagui learning curve / `styled()` rewrite of ~130 components | Front-loaded in steps 3–4; codemod does the mechanical bulk; primitives cap the API surface |

## 10. Definition of done

- **Per component:** L1 (if it introduces tokens) + L2 (exact, both themes) + L3 (≤0.001) all green; old CSS
  removed; RN-safety lint passing; renders in the Expo app.
- **Overall:** `chat` + `studio` render on web **within the parity contract vs the pre-migration `main`
  baseline** and render natively in `apps/mobile`; `computer/*` unchanged and web-only; all three CI parity
  jobs + RN-safety lint enforced on the default branch.

---

## Appendix — first, smallest provable slice

To validate the entire pipeline on one real component before committing to the full sweep:

1. Harness + Playwright + baseline for the **Button** fixture set (default/disabled/loading/`asChild`), both themes.
2. `tamagui.config.ts` generator + L1 token-parity test.
3. `@lmthing/ui-primitives` with `Pressable` + `Text`.
4. Migrate `elements/forms/button` (exercises the Radix `Slot`→`asChild` path) onto the primitives.
5. Show L1+L2+L3 green on web **and** the same Button rendering in a minimal Expo screen.

This exercises the token pipeline, the primitive layer, the Radix replacement, the dual build, and all three
proof layers in a single vertical slice.
