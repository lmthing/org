# Migrating `chat` + `studio` to Tamagui (universal / RN-compatible) — **without breaking web styles**

> Status: **Phase 0 COMPLETE** (de-HTML of chat + studio + computer, RN-safety lint enforced) +
> **Phase-1 foundation COMPLETE** (token pipeline, `createTamagui` config shell, and the L2/L3
> visual/computed-style harness with passthrough baselines — all node/browser-tested). The
> primitive **swap itself (Phase 1c) is BLOCKED pending an architecture decision** — the surfaces'
> layout is 100% Tailwind-className-driven on `Box`, which a Tamagui web swap can't preserve
> as-is. See "Phase 1c decision" in the handoff and
> `.issues/tamagui-web-swap-blocked-by-className-layout.md`.
> Target branch: `claude/react-native-mobile-exploration-vafu9o` (plan); implementation on
> `claude/tamagui-migration-plan-66u8sw`.
> Scope: make `libs/ui/src/chat/**`, `libs/ui/src/studio/**`, **and `libs/ui/src/computer/**`** render on
> **both** web (unchanged) and React Native, by moving them onto Tamagui universal primitives. Two
> irreducibly-web widgets — **Monaco** (`computer/ide-editor`) and **xterm** (`elements/content/terminal`) —
> are **web-only**: they render fully on web and show a documented "not available on mobile" fallback on
> native, isolated behind `.web.tsx`/`.native.tsx` seams. Everything else in `computer/*` is migrated like
> `chat`/`studio`. (**`react-resizable-panels` has been retired** — `computer/ide-layout` now uses a static
> flex split, so there is no resizable-panels dependency to fork or replace.)

---

## Implementation status (living log)

What has actually landed, in the plan's own de-HTML-first order. Each item cites the code so
this stays grounded; verify against the files, they may have moved.

**Phase 1 foundation — the token pipeline (§5 + §3 Layer 1) — DONE & CI-gated.**
- `libs/css/scripts/generate-tamagui-config.mjs` (+ shared pure logic in
  `libs/css/scripts/tamagui-tokens.mjs`): sibling of `generate-theme.mjs`, reads the **same**
  `src/tokens/tokens.json`, emits `libs/css/src/tamagui/tokens.generated.ts` — a pure-data
  module (`radius`, `fonts`, `themes.{light,dark}`) with **no `@tamagui/core` import** so the
  parity test can load it in a node env. Wired into `libs/css` `generate`/`prebuild`.
- **Layer 1 token-parity test** `libs/css/src/__tests__/token-parity.test.ts`: asserts every
  generated token/theme value equals the `theme.css` value **byte-for-byte** — radius, fonts,
  `:root` (light) and the fully-resolved `[data-theme="dark"]` cascade — **plus a staleness
  guard** that the checked-in module matches the generator output. Runs in the root vitest
  (no browser). Green (6 tests). This is the root guarantee that must hold before any swap.
- `lint-design-tokens.mjs` allows `tokens.generated.ts` (a token-definition artifact, like
  `theme.css`); the config is exported as `@lmthing/css/tamagui-tokens`.

**PHASE 0 — de-HTML all three surfaces (§1.5 + §7 steps 2–4b + §8) — ✅ COMPLETE.**

*The vocabulary (§1.5).* `libs/ui/src/elements/primitives/**` — the full set of plain-HTML
**pure-passthrough `forwardRef`** wrappers, covering every host tag used in the surfaces:
- `box` (div + `as` for section/nav/header/footer/aside/article/main/figure/blockquote/details/
  summary/dl/fieldset; `open` for `<details>`), `text` (span/p + `as` for strong/em/small/label/
  code/kbd/dt/dd and `h1`–`h6`; `block`), `pressable` (button + `as` a/div; button-based props
  with optional anchor attrs), `row`/`col`, `image`, `link`, `form`, `list` (ul/ol + ListItem).
- Grouped: `controls.tsx` (TextField/TextArea/Select/Option), `media.tsx` (Audio/Video/IFrame),
  `table.tsx` (Table/Thead/Tbody/Tfoot/Tr/Th/Td/Caption), `svg.tsx` (Svg/Path/Rect/Circle/…,
  **named to mirror `react-native-svg`** so Phase 1 swaps host→RN-svg with no surface edits),
  `misc.tsx` (Pre/Br/Hr). `_host.tsx` is the shared `forwardRef` factory.
- All are byte-identical to their raw tag **and forward refs**, proven in
  `elements/primitives/index.test.tsx` (17 tests). The **libs/ui vitest harness** the repo
  lacked was stood up for this (`vitest.config.ts` + `vitest.setup.ts`; jsdom + esbuild
  automatic JSX + jest-dom; `test` script scoped to `elements/primitives/**` + `**/*.parity.test.tsx`).

*The codemod (§7).* `libs/ui/scripts/dehtml-codemod.mjs` — a **TypeScript-AST** codemod that
rewrites ONLY real JSX host tags (never tags inside strings/generics/comments) to the primitives
under a collision-proof `import * as Prim` namespace, preserving every attribute/child/ref/format.
Ran across **chat (44 files, 964 tags) + computer (14, 176) + studio (78, 1376) = 2516 tags**.
Because the primitives are proven byte-identical + ref-forwarding, the render is unchanged by
construction; `chat/app/EmptyState` additionally has an explicit byte-identical golden test
(`EmptyState.parity.test.tsx`, hand-migrated pre-codemod).

*Web-only widgets (§1.6).* Monaco isolated: `computer/ide-editor.web.tsx` (real, verbatim) +
`ide-editor.native.tsx` (`<UnavailableOnMobile>` stub, no Monaco import) + `ide-editor.tsx`
(pure re-export seam). `elements/content/unavailable-on-mobile` is the themed native fallback.
(xterm terminal stays in `elements/content/terminal`, which is outside the surface lint scope;
its native fork is Phase 1.)

*The gate (§8).* `libs/ui/scripts/lint-rn-safety.mjs` — AST gate forbidding every raw host tag
in chat/studio/computer (exempting `*.web.tsx`/`*.native.tsx`/`*.test.tsx`). **GREEN: 0 raw host
tags across 137 surface files.** Wired into `pnpm --filter @lmthing/ui lint` + a `lint:rn` script.

*Verification of the whole phase:* libs/ui suite 19/19 green · RN-safety lint clean · `lint:tokens`
clean · **zero codemod-induced type errors** (checked: no new errors in codemodded non-test files
beyond the pre-existing lucide/tanstack noise) · `@lmthing/web-app` typecheck (the real gate) green.

**PHASE 1 FOUNDATION — token pipeline (§5 + §3 Layer 1) — ✅ DONE & node-testable.**
- `libs/css/scripts/generate-tamagui-config.mjs` (+ pure logic in `tamagui-tokens.mjs`): sibling
  of `generate-theme.mjs`, reads the **same** `tokens.json`, emits `libs/css/src/tamagui/
  tokens.generated.ts` — pure data (`radius`, `fonts`, `themes.{light,dark}`), **no `@tamagui/core`
  import**. Wired into `libs/css` `generate`/`prebuild`; exported as `@lmthing/css/tamagui-tokens`.
- **Layer-1 token-parity test** `libs/css/src/__tests__/token-parity.test.ts` (6 tests, root
  vitest): every generated value == the `theme.css` value **byte-for-byte** (radius, fonts, light
  `:root`, resolved `[data-theme="dark"]` cascade) + a staleness guard. The root guarantee.
- `lint-design-tokens.mjs` allows `tokens.generated.ts` (a token-definition artifact).

**PHASE 1 — `createTamagui` config shell (§5/§6, handoff step 2) — ✅ DONE & node-testable.**
- `@tamagui/core@2.5.1` + `@tamagui/lucide-icons` installed in `libs/ui`.
- `libs/ui/src/theme/tamagui.config.ts`: the buildable runtime shell — feeds
  `@lmthing/css/tamagui-tokens` (`radius`, `fonts`, `themes.{light,dark}`) into `createTamagui`.
  Themes map design-token names → resolved hex verbatim; color palette, radius (exact rem/px
  strings), a conventional 4px `space`/`size` scale (NOT part of the token contract — tokens.json
  carries no spacing scale), a 3-face font set (body=sans, heading=display, mono=mono), and the
  `TamaguiCustomConfig` module augmentation for typed `$token`s. `createTamagui` runs headless in
  node (no browser/RNW needed), so the shell is unit-testable.
- **Runtime token-parity test** `libs/ui/src/theme/tamagui-config.test.ts` (5 tests, libs/ui
  vitest): asserts `config.themes.{light,dark}` and `config.tokens.radius`/font families equal the
  generated (theme.css-parity) values **byte-for-byte**, and that no design-token color name is
  dropped. Chains onto the Layer-1 proof: tokens.json === theme.css === tamagui.config.
- libs/ui vitest `include` widened to `src/theme/**/*.test.ts`. Full libs/ui suite 24/24 green;
  RN-safety lint clean; root typecheck 6/6.

**PHASE 1 — L2/L3 visual harness + passthrough baselines (§3.1–3.2, handoff step 1) — ✅ DONE.**
- `tests/visual/` — a **self-contained** esbuild-bundled Playwright harness (no Vite/Tailwind).
  `harness/fixtures.tsx` renders the primitives (`Box`/`Text`/`Pressable`/`Row`/`Col`/`List`/`Link`
  + a nested composite) against frozen fixtures that deliberately exercise the §1 box-model swap
  risk; `harness/entry.tsx` mounts each in a labeled stage; `build.mjs`/`serve.mjs` bundle + serve
  it for the `playwright.config.ts` webServer.
- **L2 — `computed-style.spec.ts`**: walks each fixture subtree and compares `getComputedStyle`
  for the audited property set (`audited-properties.ts`) **exactly** vs the committed baseline in
  `__computed__/`. **L3 — `visual.spec.ts`**: screenshot per fixture vs `__screenshots__/` at
  `maxDiffPixelRatio: 0.001`. Both projects (light + dark), viewport 1280×800, dSF 1,
  `document.fonts.ready`-gated.
- Baselines captured from the **passthrough** primitives (== `main`): **L2 24/24 + L3 22/22
  green**. These are the immovable reference for the Phase-1c swap. Chromium = pre-installed
  `/opt/pw-browsers` (config points `executablePath` at it; do NOT run `playwright install`).
- Scripts: `pnpm test:computed-style` / `test:visual` / `test:visual:all` / `test:visual:update`.
  The harness is decoupled from token *values* (Layer 1 owns those); it proves only that the swap
  does not change output GIVEN IDENTICAL INPUTS. See `tests/visual/README.md`.

---

## Fresh-session handoff — what's next (Phase 1)

Phase 0 is done and enforced; the surfaces now speak only `Prim.*` primitives. Status of the
Phase-1 work:

1. **Playwright visual harness + L2/L3 baselines (§3.1–3.2).** ✅ **DONE** — `tests/visual/`
   (self-contained esbuild harness, not the full app; details in the implementation-status log
   above). Baselines captured from the passthrough primitives (== `main`).
2. **`tamagui.config.ts` `createTamagui` shell (§5/§6).** ✅ **DONE** —
   `libs/ui/src/theme/tamagui.config.ts` + runtime parity test. (`@tamagui/vite-plugin` NOT yet
   added — see the decision below; it belongs to option B.)
3. **Swap the primitives' internals to Tamagui `styled()` (§4, §7 steps 6–7).** ⛔ **BLOCKED —
   decision required.** See "Phase 1c decision" immediately below and
   `.issues/tamagui-web-swap-blocked-by-className-layout.md`.
4. **Browser-global shims / delete CSS / `apps/mobile` Expo shell.** Gated on the §1c decision
   (the native styling story determines the shape of the mobile app).

### Phase 1c decision — the layout primitives can't be swapped to Tamagui on web as-is

**Grounded finding (this checkout).** The de-HTML codemod mapped **everything to `Box`** (`Row`/`Col`
are used 0 times) and layout is **100% Tailwind-className-driven**: **87** `Box` usages contain
`flex`, and **61** of those rely on Tailwind's default **flex-direction: row**. A Tamagui
`styled(View)` base is flex-direction **column**, so swapping `Box` would flip those 61 layouts;
and a runtime probe showed Tamagui's atomic `display` **overriding** an equal-specificity className
`display:flex` by source order — so the plan's "className wins during coexistence" (§5) does not
hold without build-time specificity/order control. On **native**, the surfaces' classNames are inert
(no Tailwind runtime), and Tamagui primitives don't interpret className — so the current surfaces
don't render natively via Tamagui primitives alone. This is a structural tension between what Phase 0
produced (className-driven layout on `Box`) and what the Tamagui swap needs (layout as props).

**Options (pick one before continuing steps 3–4):**
- **A — NativeWind for layout.** Keep the className surfaces verbatim (web literally unchanged); add
  NativeWind so the same classes style RN. Use Tamagui only for the universal overlay components if
  wanted. Best fit for the current surfaces; lowest web risk. *(Recommended.)*
- **B — Tamagui compiler + surface layout migration.** Add `@tamagui/vite-plugin` and migrate the 87
  flex `Box`es' layout from className to Tamagui props / `Row`/`Col`. Delivers the plan's Tamagui
  vision but re-edits surfaces and must be verified against a real app build.
- **C — Keep web passthrough; defer native.** Ship the done+verified work and pause the swap.

**Safe & done regardless of the choice:** the `createTamagui` shell + its parity test, the
`tests/visual/` L2/L3 harness + baselines, and the proven passthrough web primitives/surfaces.

**PHASE 1c — native primitive forks (`*.native.tsx`, handoff step 7) — ✅ core set DONE (web-safe).**
- `libs/ui/src/elements/primitives/_native.tsx` — shared factory: `NativeView`/`NativeText` built on
  the `tamagui.config` `styled(View/Text)` (so native draws from the SAME tokens), widened to
  `React.ComponentType<any>` to stay compilable while the tree carries both `@types/react@18`
  (libs/ui) and `@types/react@19` (react-native 0.86); `toPressHandler` (onClick→onPress).
- Native forks: **`box` `text` `pressable` `row` `col` `list` `image` `link`**. Each keeps the
  web file as `index.tsx` (Metro prefers `*.native.tsx`; web bundlers keep `index.tsx` — the same
  seam Monaco uses) and exports the SAME symbol + prop shape as the web primitive, so a surface
  component is cross-target. `row`/`col` set an explicit `flexDirection`; `image`→RN `Image`,
  `link`→`Linking.openURL`.
- **Verification:** the 6 RN-independent forks + base + config **typecheck clean in isolation**
  (`image`/`link` import `react-native` → verified in the mobile app); `native-forks.test.tsx`
  loads them in jsdom and asserts same-symbol/same-`displayName` parity with web. Web is untouched:
  L2 24/24, libs/ui suite 26/26, RN-safety lint clean.
- **NOT done / honest gaps:** these forks are **typecheck-/load-verified, not runtime-verified**
  (no Metro/device here). The **grouped** primitives (`controls`/`media`/`table`/`svg`/`misc`/`form`)
  have no native fork yet (svg → `react-native-svg`, table → View rows, controls → `TextInput`).
  And a native fork renders **structurally** but does **not** apply the surfaces' Tailwind
  `className` — native surface styling still needs the §1c decision (NativeWind or a props
  migration). The forks are the element seam that story plugs into.

**PHASE 2 — `apps/mobile` Expo shell (§6) — ✅ scaffold DONE (excluded from the workspace).**
- `apps/mobile/`: `App.tsx` (`TamaguiProvider` with the SHARED `tamagui.config` + system light/dark)
  → `src/screens/DemoScreen.tsx` (exercises the `Box`/`Text`/`Row`/`Col`/`Pressable` native forks).
  `babel.config.js` (`babel-preset-expo` + `@tamagui/babel-plugin` → the shared config),
  `metro.config.js` (watches the repo root; Metro's `*.native.tsx` preference selects the forks),
  `app.json`, `index.js`, `tsconfig.json`, `README.md`.
- **Excluded from the pnpm workspace** (`pnpm-workspace.yaml` `- '!apps/mobile'`) so its large
  Expo/RN/Tamagui tree never touches the shared install/lockfile; it consumes the shared libs by
  `file:` path. Verified: `pnpm install` still resolves 11 projects (mobile absent), libs/ui 26/26,
  L2 harness green. `@lmthing/ui` now also exports `./theme/tamagui.config` + `./elements/primitives`.
- **NOT done:** not `expo install`ed / run on a device here (no native toolchain). Expo Router nav
  + the real chat/studio screens + `PodTransport` wiring are follow-up, gated on the §1c decision.

**PHASE 1e — browser-global shims behind `platform/` (§7 step 8) — ✅ module DONE (web-safe).**
- `libs/ui/src/platform/`: each capability is a `*.ts` (web, current behavior verbatim) +
  `*.native.ts` (RN) pair — `storage` (localStorage ↔ AsyncStorage), `clipboard`
  (navigator.clipboard ↔ RN Clipboard), `dimensions` (window resize ↔ RN `Dimensions`). `index.ts`
  re-exports. Metro prefers `.native.ts`; web keeps `.ts`. The seam is Promise-based (AsyncStorage
  is async) so one API fits both.
- **`platform.test.ts` (5 tests, jsdom)** verifies the WEB shims round-trip vs the raw browser APIs
  they replace (storage set/get/remove, clipboard→boolean, dimensions numeric + resize
  subscribe/unsubscribe). Native mirrors verified in the mobile app.
- **NOT done:** the shims are *additive* — surfaces still call raw `localStorage`/`window` and are
  migrated onto this seam incrementally (that migration edits surfaces and needs surface-level web
  verification, so it is follow-up). `document`/`AppState` listeners + `getBoundingClientRect`→
  `onLayout` are not yet covered. **§7 step 9 (delete superseded CSS) is a no-op so far** — web
  keeps its passthrough primitives + Tailwind, so no CSS has been superseded to delete.

**Gotchas for the next session:**
- libs/ui is NOT in the `pnpm typecheck` gate (it has no `typecheck` script) and carries ~270
  PRE-EXISTING tsc errors (lucide-react vs the hoisted `@types/react@19`, missing
  `@tanstack/react-router`, and dormant jest-dom test typings). These are unrelated to this
  workstream. Judge new work by: `pnpm --filter @lmthing/ui test`, `lint:rn`, `lint:tokens`, and
  `@lmthing/web-app` typecheck — NOT a raw `tsc` error count.
- The de-HTML uses `import * as Prim` (namespace) to dodge name collisions with each file's own
  components. A later cosmetic pass could de-namespace where safe; not required.
- Re-run the codemod any time (idempotent): `node libs/ui/scripts/dehtml-codemod.mjs <files>`;
  check with `--check`. The lint (`lint:rn`) is what keeps surfaces de-HTML'd going forward.
- Widening the libs/ui vitest `include` to the Radix-dependent element suites needs those peers
  installed (react/@radix/lucide/clsx/tailwind-merge were added as libs/ui devDeps for the harness).

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

---
---

# Part II — Implementation handoff (for a fresh session with **zero prior context**)

> Everything below was gathered by inspecting the codebase directly. It is here so an implementer who has
> never seen this repo can execute Part I without re-deriving the architecture. Where a fact cites a file,
> the file is the ground truth — verify against it, it may have moved.

## H1. Repo, branch, workspace, commands

- **Working dir / pnpm workspace root:** `/home/user/org` (this checkout — *not* `sdk/org`; the `CLAUDE.md`
  references to `sdk/org` and `../../org/docs` describe a larger superrepo that is **not present here**). The
  `org/docs` tree is a sibling repo and is **absent** in this checkout — this file lives at `docs/` instead.
- **`pnpm-workspace.yaml`** packages: `libs/*`, `apps/*`, `scenarios`.
- **Branch to work on:** `claude/react-native-mobile-exploration-vafu9o` (do all work here; commit + push here).
- **Commands (run from repo root `/home/user/org`):**
  - `pnpm install` — from lockfile. (Note: `esbuild` postinstall is skipped by default; harmless for UI work.)
  - `pnpm typecheck` — `turbo run typecheck` (tsc --noEmit, strict, all packages). ~18s warm.
  - `pnpm test` — `vitest run` (root `vitest.config.ts`). Co-located `*.test.ts(x)`.
  - `pnpm build` — `turbo run build`.
  - `pnpm --filter @lmthing/css generate` — regenerate `theme.css` + `COMPONENTS.md` from `tokens.json`.
  - `pnpm --filter @lmthing/css lint:tokens` — the design-token CI gate (no raw colors).
  - Web app dev/preview: in `apps/web`, `pnpm dev` (`vp dev`) / `pnpm preview` (`vp preview`) — Vite via
    `vite-plus`; config is `createViteConfig(__dirname)` from `@lmthing/utils/vite`. **Playwright should target
    `vp preview`** (production build → real minified `theme.css`, deterministic).
- **Browser for Playwright:** Chromium is pre-installed at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`).
  **Do NOT run `playwright install`.**

## H2. Architecture you must understand before touching the UI

This is *why* the plan is a client-only Tamagui refactor and not a runtime port.

- **Thin client / pod-server split.** The heavy agent runtime runs **entirely server-side** in the pod
  (`libs/cli`). `apps/web` bundles **zero** runtime — it imports `@lmthing/core` only as `import type`. All
  three surfaces are **WebSocket/REST clients** of the pod. Verified: `grep` for `quickjs`/`WebAssembly` in
  `apps/web/src` → none.
- **What lives server-side and must NEVER be pulled onto the phone:** the QuickJS **WASM** sandbox
  (`libs/core/src/sandbox/quickjs.ts`, `newQuickJSAsyncWASMModule()`), the **per-statement TypeScript
  compiler** (`libs/core/src/typecheck/transpile.ts` + `tsc.ts` — loads `node:fs` at import), **esbuild**, and
  Node **`worker_threads`** (`libs/cli/src/app/worker-load*.ts`, `api/worker.ts`, `server/emitter-manifests.ts`).
  React Native (Hermes/JSC) has no WebAssembly and no `node:*`; none of this is in the mobile app, and that is
  fine because it all stays in the pod.
- **The reuse seam (this is what the mobile app is built on):**
  - `libs/state/src/lib/pod/transport.ts` — **`PodTransport`**, a DOM-free `fetch`-based REST client
    (`baseUrl` + `getAccessToken`, 401→refresh). Works **unchanged** in RN.
  - WS clients: `apps/web/src/lib/runtime/{pod.ts, ws-protocol.ts, pod-connection.ts}` and
    `libs/ui/src/chat/store/ws-client.ts` (`connectLive(wsUrl)`). The protocol + zustand store + trace-event
    model port; the transport is already framework-agnostic.
  - Much of `@lmthing/state` (VFS parsers, event bus, pure hooks) is React-but-DOM-free and likely ports.
- **The mobile app** = Expo shell + `PodTransport` + reused `@lmthing/state` logic + `@lmthing/ui` screens on
  Tamagui + native nav (**Expo Router**; TanStack Router is web-only and does not port — routing is thin glue,
  the screens are the shared unit). New package suggested: `@lmthing/mobile-client` re-exporting the seams;
  new app: `apps/mobile`.
- **"Self-evolution" (app generation on demand) is server-side and already works.** The appbuilder / architect
  / engineer **system spaces** (`libs/core/system-spaces/system-{appbuilder,architect,engineer}/`) generate a
  project (= an app: `database/ api/ pages/ hooks/ events/ components/`). Pages are built by **esbuild in the
  Node host** (`libs/cli/src/app/build/pages.ts` → `buildProjectPages`) into a **browser React** bundle mounted
  with `react-dom/client`, served static at `/app/<project>/` (`libs/cli/src/app/pages-serve.ts`). API handlers
  run in `worker_threads` (`libs/cli/src/app/api/runtime.ts`). Live hot-reload without restart is wired in
  `libs/cli/src/server/session-manager.ts` (~L588–626: `onAppWrite`/`onSchemaWrite` invalidate caches). The
  agent-facing build entry is `libs/core/src/globals/build-app.ts` (`buildApp`). **Consequence for mobile:**
  generated apps are **web** apps → on native they are shown via **WebView** (`react-native-webview`) pointed at
  `/app/<project>/`. Generating *native* screens on demand is **out of scope** for this plan (would need a new
  build target + `@app/runtime` RN renderer).

## H3. Exact file map (every path this plan touches or references)

**Surfaces to migrate (in `libs/ui/src/`):**
- `chat/**` — ~44 `.tsx`. Entry `@lmthing/ui/chat` → `chat/app/ChatShell.tsx`. Store: `chat/store/` (incl.
  `ws-client.ts`, `model.ts`). Most portable surface.
- `studio/**` — ~48 index components. Sub-surfaces: `agent/ component-editor/ functions/ integrations/
  knowledge/ presentation/ shell/ space/ thing/ workflow/`. Code editing is **`<textarea>`** (no Monaco);
  workflow editor is forms + **icon** SVGs (not a canvas).
- `computer/**` — 15 `.tsx` (dashboards/panels/cards/logs/metrics/agents + the IDE assembly).
- Route glue (in `apps/web/src/routes/{chat,studio,computer}/`) — thin; the components live in `libs/ui`.

**Existing shared UI vocabulary (`libs/ui/src/elements/`, ~39 index components):**
`branding/{cozy-text}` · `content/{avatar,badge,card,list-item,markdown,panel,separator,terminal}` ·
`forms/{button,input,select,textarea}` · `layouts/{page,split-pane,stack}` · `nav/{app-links,app-sidebar,
breadcrumb,settings-dialog,sidebar,sidebar-footer,tab-bar,top-bar}` · `overlays/{dialog,dropdown,sheet}` ·
`typography/{caption,code,heading,label}`.
Note: `layouts/split-pane` is a **static CSS** split (no dep); `content/terminal` wraps **xterm** (web-only).

**Vocabulary GAPS to build in Phase 0** (plain-HTML wrappers first): `Box`, `Text`, `Row`/`Col`, `List`,
`Table` family, `Image`, `Icon`, `Link`, `Form`. (`Button`/`TextField`/`TextArea`/`Select`/`Label`/`Heading`/
`Code`/`Card`/`Panel`/`Stack`/`Separator`/`ListItem` already exist.)

**Web-only deps — exact locations (these are the ONLY hard blockers):**
| Dep | Only location(s) | Disposition |
|---|---|---|
| `@monaco-editor/react` | `libs/ui/src/computer/ide-editor.tsx` | web-only, `.web.tsx` fork |
| `@xterm/*` | `libs/ui/src/elements/content/terminal/**` (consumers: `computer/ide-terminal.tsx`, `elements/nav/settings-dialog`) | web-only, `.web.tsx` fork |
| `react-arborist` | `libs/ui/src/studio/knowledge/field/field-tree/index.tsx` | rebuild on `FlatList` behind a `Tree` component |
| `iframe` | `apps/web/src/routes/studio/$projectId/app/preview/index.tsx` | `WebFrame` → `react-native-webview` on native |
| `@radix-ui/*` (8 files) | see breakdown in H4 | → Tamagui universal components |
| `react-resizable-panels` | **RETIRED this session** (was `computer/ide-layout.tsx`) | gone — see H5 |

**Design system:**
- `libs/css/src/tokens/tokens.json` — single source of truth (theme-first: each color has `light`/`dark`;
  `radius-*`, `font-*`; a 50-stop `spectrum` ramp; `darkSelector: [data-theme="dark"]`).
- `libs/css/scripts/generate-theme.mjs` → `libs/css/src/theme.css` (generated; **never hand-edit**).
- `libs/css/scripts/generate-components-catalog.mjs` → `libs/css/COMPONENTS.md`.
- `libs/css/scripts/lint-design-tokens.mjs` — the token gate (mirror it for the RN-safety lint).
- Component CSS (`libs/css/src/{elements,components}/**/*.css`) is hand-written but **token-only** (Tailwind
  `@apply` + token utilities like `bg-border`; no raw colors).
- Font: `apps/web/src/index.css` imports `@lmthing/css/theme.css` and declares `@font-face` for
  **`TypeMates Cera Round Pro Bold`** — screenshot determinism must `await document.fonts.ready`.

**Server (context only — do not edit for this plan):** `libs/cli/src/server/serve.ts` (HTTP+WS,
`upgrade` handler), `session-manager.ts` (imports `@lmthing/core`; live-invalidation ~L588–626),
`routes/*` (REST surface: `/api/sessions`, `/api/projects`, `/api/fs`, `/api/apps`, app-admin, …).

## H4. Inventories (so scope is known cold)

**Raw host tags to remove from the surfaces (`.tsx`):**
| | `div` | `span`+`p`+inline | `button` | `input`/`textarea` | `svg`/`img` | tables/lists/etc. |
|---|---|---|---|---|---|---|
| chat | 202 | ~145 | 48 | 35 | 12 | ul/li 14, table 9, a 6, pre/code 12, h* 13 |
| studio | 439 | ~90 | 43 | 12 | 39 | select/opt 16, h* 16, br 15, section 6 |
| computer | ~60 | 17 | 11 | 3 | — | nav 1, a 1 |

**Radix breakdown (8 files, all in shared `elements/` except one in `computer/`):**
`overlays/dialog`←react-dialog · `overlays/sheet`←react-dialog · `overlays/dropdown`←react-dropdown-menu ·
`forms/button`←react-slot (`asChild`) · `typography/label`←react-label · `content/separator`←react-separator ·
`content/avatar`←react-avatar · `computer/ide-file-tree`←react-context-menu. → all map to Tamagui's own
`Dialog`/`Sheet`/`Select`/`Popover`/`Label`/`Separator`/`Avatar` + `asChild`.

**Icons:** `lucide-react` used in ~30 `libs/ui` files (→ `@tamagui/lucide-icons`, near-mechanical swap);
inline `<svg>` in ~15 files (→ `react-native-svg` / lucide equivalents).

**Browser-global touchpoints in chat+studio (~small, shim in Phase 1):** `window` 11, `document` 7,
`localStorage` 3, `navigator` 4, `getBoundingClientRect` 1. **No** `createPortal`, **no** drag-and-drop,
**no** `ResizeObserver` (the nasty ones are absent).

## H5. Work already completed THIS session (do NOT redo)

On branch `claude/react-native-mobile-exploration-vafu9o`:
1. **`5a2ce6d`** — this plan (Part I) added.
2. **`73de93a`** — de-HTML-first sequencing; `computer/*` brought into scope.
3. **`f0b0d0e`** — **`react-resizable-panels` retired.** `computer/ide-layout.tsx` now uses a **static flex
   split** (classes `ide-layout__split` / `__pane--sidebar|main|editor|terminal` / `__divider--horizontal|
   vertical`; sidebar 15%, editor fills, terminal 30%, thin `bg-border` dividers). Dep removed from
   `libs/ui/package.json` + `apps/web/package.json`; lockfile + `COMPONENTS.md` regenerated. **Verified:**
   `pnpm typecheck` 6/6, `lint:tokens` clean, no source refs remain. Drag-resize is intentionally gone; the
   split is universal (web + RN).

So: **web-only widgets are now just Monaco + xterm.** Open follow-up (not yet done): the
`@radix-ui/react-context-menu` in `computer/ide-file-tree.tsx` is still a web-only dep — decide swap-to-Tamagui
vs retire during the computer migration.

## H6. Rules you MUST obey (from `CLAUDE.md`)

- **Design system is mandatory.** Any web styling uses `@lmthing/css` tokens — **never a raw color**. Change
  colors only via `tokens.json` + `pnpm --filter @lmthing/css generate` (never hand-edit `theme.css`). Enforced
  by `lint:tokens` (hard CI gate). The Tamagui config generator (Part I §5) must read `tokens.json` and the
  L1 token-parity test proves equality.
- **A change to code is not done until the matching doc is updated in the same change** (this doc is the doc
  for this workstream — keep it current).
- **Always test every fix.** For this workstream "test" = the three parity layers (L1/L2/L3) + `pnpm typecheck`
  + `lint:tokens`.
- **`.issues/`** is the live bug list; file an entry when a bug is found, delete when fixed+tested.

## H7. Environment / secrets

- `.env` is read from `process.cwd()` only. In Claude Code web sessions, keys are decrypted from
  `.env.encrypted` by `.claude/hooks/session-start.sh`; **if a secret is missing, ask the user for
  `ENV_DECRYPT_KEY`.** Pure UI/visual-parity work needs no LLM keys. If you must exercise the runtime, use
  keyless mocking: `--mock <file>` / `LM_MOCK=<file>` (scripted `streamFn`).

## H8. The first PR to open (concrete, in de-HTML-first order)

1. **Add Playwright + the visual harness** (Part I §3, §3.1–3.2). Route `apps/web/src/routes/__visual/`
   (prod-excluded), fixtures for the Button set + one container-heavy chat component (e.g. a `Message`), both
   themes. `playwright.config.ts` targeting `vp preview`, pinned Chromium (`/opt/pw-browsers`).
2. **Capture `main` baselines** — check out `origin/main`, run the harness, commit golden screenshots +
   computed-style JSON. This is the immovable reference; do it before any component change.
3. **Phase-0 proof:** add `Box` + `Text` as **plain-HTML** wrappers; de-HTML that one `Message` (every
   `div`/`span` → `Box`/`Text`). Show **L2 exact + L3 = 0 diff** and the no-raw-HTML lint passing on that file.
4. **Phase-1 proof:** add `libs/css/scripts/generate-tamagui-config.mjs` (from `tokens.json`) + the L1
   token-parity test; swap `Box`/`Text`/`Button` (incl. Radix `Slot`→`asChild`) internals to Tamagui. The
   `Message` + Button fixtures are **not edited**. Show L1+L2+L3 green on web **and** the same components in a
   minimal Expo screen (`apps/mobile`).

Then proceed through Part I §7 (Phase 0 de-HTML of chat → studio → computer with the lint gate turned on;
Phase 1 Tamagui swap of the ~24 components; native forks of the leaves).

## H9. Definition of done — recap

Per component: no raw HTML (lint green) · L1 (if introducing tokens) + L2 (exact, both themes) + L3 (≤0.001) ·
old CSS removed · renders in Expo (or documented native fallback). Overall: `chat`+`studio`+`computer` render
on web within the parity contract vs the pre-migration `main` baseline **and** natively in `apps/mobile`;
Monaco + xterm render on web with native fallbacks; three CI parity jobs + the no-raw-HTML/RN-safety lint
enforced on the default branch.
