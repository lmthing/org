# Migrating `chat` + `studio` to Tamagui (universal / RN-compatible) — **without breaking web styles**

> Status: proposal / plan. Target branch: `claude/react-native-mobile-exploration-vafu9o`.
> Scope: make `libs/ui/src/chat/**`, `libs/ui/src/studio/**`, **and `libs/ui/src/computer/**`** render on
> **both** web (unchanged) and React Native, by moving them onto Tamagui universal primitives. Two
> irreducibly-web widgets — **Monaco** (`computer/ide-editor`) and **xterm** (`elements/content/terminal`) —
> are **web-only**: they render fully on web and show a documented "not available on mobile" fallback on
> native, isolated behind `.web.tsx`/`.native.tsx` seams. Everything else in `computer/*` is migrated like
> `chat`/`studio`. (**`react-resizable-panels` has been retired** — `computer/ide-layout` now uses a static
> flex split, so there is no resizable-panels dependency to fork or replace.)

---

## 0. The one hard constraint

**The web rendering of `chat` and `studio` must stay visually the same at every step of the migration.**
"Ship it and eyeball it" is not acceptable. Every component conversion is gated by an automated proof
that its rendered web output still matches the pre-migration baseline. Nothing merges that regresses.

This document is therefore ~60% about the **proof harness** and ~40% about the migration itself, because
the proof harness is what makes the migration safe.

### The migration is split into two macro-phases — **de-HTML first, Tamagui second**

The single most important structural decision: **`chat`, `studio`, and `computer` must not touch raw HTML tags
at all.** Everything routes through the `@lmthing/ui` component layer first, as a pure web-only refactor,
*before* Tamagui is introduced.

- **Phase 0 — de-HTML (web only, no Tamagui, no behavior change).** Replace every raw JSX host tag
  (`<div>`, `<span>`, `<button>`, `<input>`, `<svg>`, `<table>`, …) in `chat` + `studio` + `computer` with a UI
  component. The components are, at this stage, **thin wrappers that emit the exact same HTML** — so the
  rendered web output is byte-for-byte the current output. A lint gate then forbids any raw host tag in those
  surfaces forever. This is the strongest-possible parity story: the HTML literally does not change.
- **Phase 1+ — the Tamagui swap (change the components, not the surfaces).** Only the ~2 dozen UI components'
  *implementations* change from HTML to Tamagui primitives. The surfaces are **not edited again** — they
  already speak only the component vocabulary. The blast radius of the risky change shrinks from ~105 surface
  files to ~24 component files, each with its own parity gate. (The three web-only IDE widgets — Monaco, xterm,
  resizable-panels — are the sole carve-out: isolated behind `.web.tsx`/`.native.tsx` seams, §1.6.)

Why this ordering matters: it converts "migrate ~700 divs + ~270 spans across ~105 files to Tamagui and hope
the box model holds" into two independently-verifiable steps — a mechanical HTML-preserving refactor (near-zero
visual risk), then a localized implementation swap behind a stable component API. Phase 0 is valuable on its
own even if the RN work is deferred: it establishes the component seam and the lint gate.

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

## 1.5 Phase 0 — de-HTML `chat` + `studio` through the UI component layer

**Goal:** zero raw JSX host tags in `libs/ui/src/chat/**` and `libs/ui/src/studio/**`. Every element goes
through a `@lmthing/ui` component. No Tamagui yet; no visual change.

### Current raw-tag load (what must be routed through components)

Measured across `chat` + `studio` (`.tsx`):

| Tag(s) | chat | studio | Target component |
|---|---|---|---|
| `div` | 202 | 439 | `Box` (+ existing `Stack`/`Card`/`Panel`/`Page` where semantic) |
| `span`, `p`, `strong`, `em`, `b`, `i`, `small` | ~145 | ~90 | `Text` (variant/weight/tone props) |
| `button` | 48 | 43 | `Button` *(exists)* |
| `input` | 29 | 4 | `TextField` *(exists: `forms/input`)* |
| `textarea` | 6 | 8 | `TextArea` *(exists)* |
| `select`, `option` | 7 | 16 | `Select` *(exists)* |
| `label` | 13 | 6 | `Label` *(exists)* |
| `svg`, `img` | 12 | 39 | `Icon` (lucide/inline) · `Image` |
| `a` | 6 | 2 | `Link` |
| `ul`, `ol`, `li` | 14 | 4 | `List` / `ListItem` *(has `content/list-item`)* |
| `table`, `thead`, `tbody`, `tr`, `td`, `th` | 9 | 0 | `Table` family |
| `pre`, `code` | 12 | 4 | `Code` *(exists: `typography/code`)* |
| `h1`–`h6` | 13 | 16 | `Heading` *(exists)* |
| `form` | 3 | 5 | `Form` |
| `hr`, `br` | 1 | 16 | `Divider` *(has `content/separator`)* / layout gap |
| `nav`, `header`, `footer`, `section`, `aside`, `article` | ~6 | ~13 | `Box` semantic variants |

### Vocabulary gaps to build (small, plain-HTML wrappers)

Most of the vocabulary already exists (`Button`, `TextField`/`input`, `TextArea`, `Select`, `Label`,
`Heading`, `Code`, `Card`, `Panel`, `Stack`, `Page`, `Separator`, `ListItem`). The **missing** primitives to
add — each a thin wrapper emitting the same HTML it replaces — are:

- `Box` — generic container. Renders `<div>` (with an `as`/`role` escape hatch for `section`/`nav`/`header`/
  `aside`). This absorbs the ~641 `<div>`s.
- `Text` — generic inline/body text. Renders `<span>`/`<p>` per `block` prop; `weight`/`tone`/`size` props
  cover `strong`/`em`/`small`. Absorbs ~235 tags.
- `Row` / `Col` — explicit flex containers (or thin presets over the existing `Stack`), so no layout relies on
  an implicit `<div>` default (this is what de-risks the Phase-1 box-model swap).
- `List` / `ListItem` (container for the existing item), `Table` family, `Image`, `Icon`, `Link`, `Form`.

### How Phase 0 stays provably identical

Because each new component **emits the same tag with the same className passthrough** it replaced, Phase 0's
web output is unchanged by construction. It is still gated by the full proof harness (§3): the `main`
baselines are captured before Phase 0, and each de-HTML PR must pass L1 (n/a), **L2 computed-style = exact**,
and **L3 visual ≤ 0.001** against those baselines. In practice L2/L3 for Phase 0 should be a perfect match;
any diff means a wrapper changed the DOM/className and is a bug to fix, not a threshold to relax.

### Completion gate

Phase 0 is done when the **RN-safety lint rule** (no raw JSX host tags, no `@radix-ui/*`, no web-only deps in
`chat`/`studio`; see §8) passes with zero violations. That lint rule is what guarantees the surfaces *stay*
de-HTML'd as the code evolves — including for all future features.

---

## 1.6 `computer/*` and the three web-only widgets (render on web, fallback on native)

`computer/*` is **in scope** and migrated exactly like `chat`/`studio` (de-HTML → Tamagui) — it is small
(15 components: ~60 `div`, 17 `span`, 11 `button`). The only exception is two irreducibly-web widgets that
have no RN equivalent and must **stay web-only**, visible on web but not on mobile:

| Widget | File | Web-only because |
|---|---|---|
| **Monaco** code editor | `computer/ide-editor.tsx` | DOM-based editor; no RN build |
| **xterm** terminal | `elements/content/terminal/**` (used by `computer/ide-terminal.tsx` + `elements/nav/settings-dialog`) | canvas/DOM terminal; no RN build |

> **`react-resizable-panels` retired.** `computer/ide-layout.tsx` previously used it for the drag-resizable
> IDE panes; it now uses a **static flex split** (sidebar 15% · editor fill · terminal 30%, thin dividers) —
> same at-rest layout, no drag. The dependency is removed from `libs/ui` and `apps/web`. This is one fewer
> web-only widget to fork, and the static split is universal (renders identically on web and RN).

### The fork pattern (how "web-only, not on mobile" is enforced)

Each web-only widget is isolated behind a **platform-resolved module** so it is *physically impossible* to
bundle into the native app:

```
elements/content/terminal/
  index.tsx          → re-exports from the platform file (metro/vite pick .native or .web)
  index.web.tsx      → the real xterm implementation (current code, unchanged)
  index.native.tsx   → <UnavailableOnMobile feature="Terminal" />  (no xterm import at all)
```

- The `.native.tsx` file **does not import** Monaco/xterm/resizable-panels — Metro never sees those deps, so
  they can't break or bloat the native bundle.
- On web, `.web.tsx` is the current implementation verbatim → web parity is trivially exact (the file is
  unchanged; it just moved).
- `<UnavailableOnMobile>` is a small Tamagui component (a themed empty-state: "Available on the web app").
- Consumers (`ide-editor`, `ide-terminal`, `ide-layout`, and the settings-dialog terminal) import the
  seam, never the widget directly — so the *surrounding* `computer` layout still renders natively, with just
  those panels replaced by the fallback.
- The no-raw-HTML / RN-safety lint (§8) **allows** these `.web.tsx` files to use their web deps (they are the
  designated exception), but forbids any web-only import from leaking into a non-`.web` file.

Net: on web, `computer` is unchanged (Monaco + terminal + split-panes intact); on mobile, `computer` renders
its dashboards/panels/logs/metrics/agents natively and shows a clean "open the web app" fallback where the IDE
widgets would be.

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
/`computer`/`elements` component against **frozen fixtures**:

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

## 4. The compatibility primitive layer (the components' Phase-1 implementation)

The heart of "won't break web." **This is a Phase-1 change to the components built/filled in Phase 0 — not a
new thing `chat`/`studio` import.** After Phase 0, the surfaces already speak only the component vocabulary
(`Box`, `Text`, `Button`, …); Phase 1 swaps those components' *internals* from plain HTML to Tamagui
`styled()` factories whose **web output reproduces the current box model** and whose **native output is
correct RN**. One config, two render targets. Because only the ~24 component implementations change, the
box-model risk is contained to them and proven by their own L2/L3 tests.

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

Order chosen so the foundation is proven before anything depends on it. **Steps 1–4 are Phase 0 (de-HTML,
web-only, no Tamagui); steps 5–9 are Phase 1+ (the Tamagui swap).**

**Phase 0 — de-HTML (no visual change, no Tamagui):**

1. **Harness + Playwright + baselines from `main`** (§3). Capture golden screenshots + computed styles for
   every current `chat`/`studio`/`computer`/`elements` fixture. **No product code changes.** This PR is pure safety net.
2. **Build the vocabulary gaps** (§1.5): `Box`, `Text`, `Row`/`Col`, `List`, `Table`, `Image`, `Icon`,
   `Link`, `Form` — plain-HTML wrappers emitting the same tags. Each proven to match its raw tag in isolation.
3. **De-HTML `chat`** (~44 files): codemod + hand-finish every raw tag → component. Each PR gated by exact
   L2 + L3 vs the `main` baseline (should be a perfect match).
4. **De-HTML `studio`** (~48 files) the same way, including the leaves that stay web-specific but still get
   wrapped: `field-tree` (arborist) behind a `Tree` component, the app-preview `iframe` behind a `WebFrame`
   component, textareas behind `TextArea`.
4b. **De-HTML `computer`** (~15 files) the same way. Isolate the three web-only widgets behind their platform
   seams now (§1.6): move Monaco/xterm/resizable-panels into `.web.tsx` files (unchanged code) with
   placeholder `.native.tsx` stubs; everything else de-HTML'd to components. **Turn on the RN-safety lint
   gate** (§8) across all three surfaces — Phase 0 complete when it is violation-free.

**Phase 1+ — Tamagui swap (components change; `chat`/`studio` are not edited again):**

5. **`tamagui.config.ts` generator + Layer-1 token-parity test** (§5). Green before any implementation swaps.
6. **Swap shared primitive/`elements` implementations to Tamagui** (§4): `Box`/`Text`/`Pressable`/`TextField`/
   `Icon` + Button (`Slot`→`asChild`) + overlays (Radix→Tamagui). Each gated by its own L2/L3 vs baseline.
7. **Swap remaining `chat`/`studio`/`computer`-specific components** to Tamagui internals, plus native forks
   of the leaves: `Tree` → `FlatList`; `WebFrame` → `.native.tsx` `react-native-webview` (web keeps `iframe`);
   `TextArea` → RN `TextInput`. For `computer`, fill in the three web-only widgets' `.native.tsx` fallbacks
   (`<UnavailableOnMobile>`); their `.web.tsx` stays as-is. Web parity re-proven at each.
8. **Browser-global shims** (~15–20: `localStorage`→AsyncStorage, `window`/`document` listeners→`Dimensions`/
   `AppState`, `navigator.clipboard`→RN `Clipboard`, `getBoundingClientRect`→`onLayout`). Behind a `platform/`
   module with `.web`/`.native` files; web implementations are the current code verbatim.
9. **Delete superseded CSS** for fully-swapped components; re-run full suite.

Each of steps 3–4 and 6–7 is many small PRs (a few components each), every one blocked by the three parity
layers.

---

## 8. CI gates & guardrails

- **New CI jobs:** `test:token-parity` (L1), `test:computed-style` (L2), `test:visual` (L3). All three
  required on every PR touching `chat`/`studio`/`computer`/`elements`/`ui-primitives`/`css`.
- **RN-safety / no-raw-HTML lint** (mirrors the existing `lint:tokens` gate) — the enforcement backbone of
  Phase 0. An ESLint rule (`react/forbid-elements` for the host-tag ban + a `no-restricted-imports` for
  `@radix-ui/*` and web-only deps) applied to `libs/ui/src/chat/**`, `libs/ui/src/studio/**`, **and
  `libs/ui/src/computer/**`**. It forbids **every** JSX intrinsic/host tag there — the surfaces may only use
  `@lmthing/ui` components. Turned on at the end of Phase 0 (step 4b) and required on every PR thereafter, so
  the surfaces stay de-HTML'd and RN-safe for all future features. **The only exception is the designated
  `*.web.tsx` widget files** (Monaco/xterm/resizable-panels, §1.6), which may use their web deps and host
  tags; the rule still forbids any web-only import from leaking into a non-`.web` file.
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

- **Per component:** no raw HTML tags (lint green); L1 (if it introduces tokens) + L2 (exact, both themes) +
  L3 (≤0.001) all green; old CSS removed; RN-safety lint passing; renders in the Expo app (or, for a web-only
  leaf, renders its documented native fallback).
- **Overall:** `chat`, `studio`, **and `computer`** render on web **within the parity contract vs the
  pre-migration `main` baseline** and render natively in `apps/mobile`; the three web-only widgets (Monaco,
  xterm, resizable-panels) render on web and show their native fallbacks on mobile; all three CI parity jobs +
  the no-raw-HTML / RN-safety lint enforced on the default branch across all three surfaces.

---

## Appendix — first, smallest provable slice

To validate the entire pipeline on one real slice before committing to the full sweep — **in the de-HTML-first
order**:

1. Harness + Playwright + baseline for the **Button** fixture set (default/disabled/loading/`asChild`) and one
   real container-heavy component (e.g. a chat `Message`), both themes. Captured from `main`.
2. **Phase 0 proof:** add `Box` + `Text` as plain-HTML wrappers; de-HTML that one `Message` component (every
   `div`/`span` → `Box`/`Text`). Show **L2 exact + L3 = 0 diff** — proving wrappers change nothing — and the
   no-raw-HTML lint passing on that file.
3. **Phase 1 proof:** `tamagui.config.ts` generator + L1 token-parity test; swap `Box`/`Text`/`Button`
   (incl. `Slot`→`asChild`) internals to Tamagui. `Message` and the Button fixtures are **not edited**.
4. Show L1+L2+L3 green on web **and** the same Button + `Message` rendering in a minimal Expo screen.

This exercises the de-HTML seam, the lint gate, the token pipeline, the Radix replacement, the dual build, and
all three proof layers — and proves the surfaces are edited only once (Phase 0) and never again during the
risky Tamagui swap.
