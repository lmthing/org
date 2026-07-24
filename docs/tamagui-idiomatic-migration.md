# Phase 2 — the idiomatic-Tamagui migration ("the Tamagui way", zero-Tailwind)

> **Status: FOUNDATION LANDED — spikes cleared, tooling built, bulk surface sweep remaining.**
> Phase 1 (`react-native-tamagui-migration.md`, Parts I–III) put every surface primitive + overlay
> *onto Tamagui components* while **keeping the Tailwind + `theme.css` + BEM styling engine**
> underneath (coexistence). This Phase 2 replaces that styling engine with **idiomatic Tamagui** —
> style props + `$` design tokens + real themes + `styled()` variants + the optimizing compiler — and
> deletes Tailwind/`theme.css`/the empty-theme config/the `!important` pass/the base resets. **This
> CHANGES web output** and so abandons Phase 1's §0 byte-stability contract on purpose; that is the
> single biggest reason it needs an explicit go decision and a different verification model
> (baseline-first + human review, not "must match `main`").

## Progress log

The load-bearing, fully-testable foundation is landed and green; the bulk per-surface sweep + native
remain (they are per-slice human/harness-gated and, for native, need a device toolchain).

| Item | Status | Where |
|---|---|---|
| **SPIKE A — runtime/per-space theming** | ✅ **PASS via A1** | `webColorTokens` (values `var(--<name>)`) in `libs/css/scripts/tamagui-tokens.mjs`; wired in `libs/ui/src/theme/tamagui-web.config.ts`; EMPIRICALLY proven in `apps/web/b0-probe/spike-a-runtime-theme.spec.ts` (real Chromium, real `theme.css`): `$background`/`$foreground` resolve light/dark + a runtime space override |
| **SPIKE B — token-scale reconciliation** | ✅ done | Tailwind `space`/`size`/`fontSizes`/`lineHeights`/`fontWeights`/`letterSpacings`/`zIndex`/`media` generated + pinned to Tailwind by `libs/css/src/__tests__/scale-parity.test.ts` |
| **SPIKE C — react 18/19 types** | ⬜ open | not attempted; casts retained (documented in `_tamagui.tsx`). Blocks nothing above |
| **P1 — token + theme foundation** | ✅ done | full Tamagui token set from `tokens.json`; `tamagui.config.ts` (native hex) + `tamagui-web.config.ts` (var-backed) both carry it; parity tests green. Config CONVERGENCE (one config, delete web config) deferred — it changes output, see §7 |
| **P2 — BEM → styled()+variants** | 🟡 proof landed | `.btn` → `libs/ui/src/elements/forms/button/button.styled.tsx` (the §4 example), variant-structure test green. Remaining 67 CSS files: per-slice |
| **P3 — className → props codemod** | ✅ tool built | `libs/ui/scripts/classnames-to-props{,-map}.mjs` + 31-test mapping gate; `--check` over the chat surface: 228 elements migratable across 44 files, 110 reported for manual review. Applying to shipped surfaces is per-slice harness-gated |
| **P0 — real-surface visual harness** | 🟡 mechanism proven | the A1 probe + the b0-probe `measure-surface` computed-style pattern are the objective (non-human) parity gate; a full fixtured `tests/visual-surface/` baseline is remaining |
| **P4/P5 — primitives/overlays idiomatic, compiler ON, delete pipeline** | ⬜ remaining | needs the surface sweep done first |
| **P6 — types + native on device** | ⬜ remaining | native needs a Metro/device toolchain (out of the headless env) |

---

## 0. What "the Tamagui way" means here, and what changes

| Concern | Phase 1 (today) | Phase 2 (idiomatic) |
|---|---|---|
| Styling | Tailwind/BEM `className` strings on Tamagui components | Tamagui **style props** (`backgroundColor`, `paddingHorizontal`, …) |
| Design values | `theme.css` CSS vars + Tailwind scale | Tamagui **`$` tokens** (`$background`, `$4`, `$sm`) |
| Light/dark + space themes | `data-theme` + runtime `--lm-*` CSS vars | Tamagui **themes** + `<Theme>` / `useTheme` (+ a runtime-theme bridge, see §2) |
| Component library CSS | 68 BEM `@apply` files + the `!important` pass | Tamagui **`styled()` + `variants`** |
| Primitives | `createComponent({isText})` + `whiteSpace:'inherit'`/per-tag `display` resets | plain `styled(View/Text)` / Tamagui `Stack`/`Text` (no resets) |
| Web config | empty-theme `tamagui-web.config.ts` | the **colored** `tamagui.config.ts` (one config, both platforms) |
| Overlays | hand-rolled on `Prim.*` + `ReactDOM.createPortal` | `@tamagui/dialog`/`popover`/`sheet` + `Adapt` |
| Types | `as unknown as ComponentType<any>` + hand-declared props | Tamagui's real component types + `$token` autocomplete |
| Compiler | `@tamagui/vite-plugin` wired but doing ~nothing | extraction ON → atomic CSS, tree-shake, SSR |
| Deleted | — | `theme.css` gen · Tailwind · empty config · `!important` pass · `text-codemod`/`flexbox-codemod` · base resets |

**Scale (grounded):** ~**1281** `className=` usages across ~137 surface files; **68** component/element
CSS files; the runtime space-theme system injects **`--lm-*`** vars (`--lm-accent/bg/border/panel/…`)
under `[data-theme]`. This is a **months-long, every-file** effort. Do it strangler-fig, surface-slice
by surface-slice, gated by the real-surface visual harness (Phase 1's open item — build it FIRST).

---

## 1. Hard prerequisites — three spikes that gate everything (do these before any bulk work)

These are the load-bearing unknowns. If a spike fails, the plan changes shape — so spike first, cheaply,
in `apps/web/b0-probe/`.

### SPIKE A — Runtime / per-space theming (the #1 risk)
The app lets a **space define its own colors at runtime**, injected as `--lm-*` CSS vars and toggled by
`data-theme` (`libs/css/scripts/generate-theme.mjs` `$meta.darkSelector`). **Tamagui themes are static —
defined at `createTamagui` build time.** Idiomatic Tamagui does not natively do "arbitrary user-supplied
theme at runtime." Options to prove out:
- **A1 — token→CSS-var indirection (recommended default).** Define Tamagui color tokens whose *values are
  `var(--lm-*)`* (Tamagui allows a token value to be any CSS string on web). Then `$accent` resolves to
  `var(--lm-accent)`, and the existing runtime `--lm-*` injection keeps working — you get idiomatic
  `backgroundColor="$accent"` props AND runtime space themes. Native uses the resolved hex (no CSS vars).
  Cost: web themes still lean on a CSS-var layer (not "pure" Tamagui themes), but props/tokens are
  idiomatic and this is the only option that preserves runtime space theming with low risk.
- **A2 — Tamagui dynamic themes** (`updateTheme`/`addTheme` at runtime, or generating a `<Theme>` per
  space). Purest, but Tamagui's runtime-theme API is limited/experimental and every space theme becomes a
  full injected theme — perf + API risk.
- **Deliverable:** a probe that renders a Tamagui component with `backgroundColor="$accent"`, flips
  `--lm-accent` at runtime (A1) or swaps a dynamic theme (A2), and confirms both light/dark + a custom
  space theme resolve correctly on web. **Decision gate before P1.**

### SPIKE B — Token-scale reconciliation (spacing/size/font)
Surfaces use Tailwind's scale (`px-4` = 1rem, `gap-2` = .5rem, `text-sm`, `h-8`). Tamagui uses `$`-named
scales. For a clean codemod, **define Tamagui `$space`/`$size`/`$fontSize` tokens that map 1:1 to
Tailwind's** so `px-4 → paddingHorizontal="$4"`, `gap-2 → gap="$2"`, `text-sm → fontSize="$sm"`. The
current `tamagui.config.ts` space/size is a *guessed* 4px scale (NOT Tailwind's) — it must be regenerated
from the same source. Also fold in fonts (size + lineHeight + **fontWeight** + **letterSpacing** per
face — Phase 1's font tokens omit weight/tracking). **Deliverable:** the extended token generator (below)
+ a parity test that `$4`/`$sm`/… equal the Tailwind computed values. **Decision gate before the codemod.**

### SPIKE C — Types (react 18 vs 19)
`libs/ui` pins `@types/react@18`; RN pulls `@19`. Phase 1 dodged the clash with
`as unknown as ComponentType<any>`, which discards Tamagui's typed props + `$token` autocomplete — the
opposite of the Tamagui way. Spike a **single `@types/react` version across the graph** (align on 19, or
a resolutions pin) and confirm `styled(View, {...})` yields a usable typed JSX component with `$`
autocomplete under `tsc`. If it can't be resolved, the migration still works but keeps casts (documented
regression). **Deliverable:** one styled component, fully typed, green under `tsc`.

---

## 2. P0 — Build the real-surface visual harness FIRST (baseline capture)

Phase 1's §3.1 harness was never built and that is why regressions slipped. Phase 2 changes output on
purpose, so the harness's job flips from "prove no change" to **"capture the `main` baseline, then let a
human review every intentional diff."**
- Build `tests/visual-surface/`: an esbuild/Vite harness that renders the REAL `chat`/`studio`/`computer`
  surface components (fixtured, no live pod) under the compiled app CSS, per theme (light/dark + one
  space theme), `document.fonts.ready`-gated — the pattern `apps/web/b0-probe/measure-surface.mjs`
  already proves at slice scale. Fixtures: EmptyState, a chat Message, WorkBlock, the Sidebar, a studio
  panel, a computer dashboard, each overlay open.
- **Capture the baseline from `main` (pre-Phase-2) NOW** — screenshots + computed-style JSON, committed.
- Each Phase-2 slice re-renders and produces a **diff report a human signs off** (not an automated
  pass/fail — output *will* change; the gate is "reviewed & intended", plus L1 token parity stays exact).
- Wire it as the per-PR artifact for every slice below.

---

## 3. P1 — Token + theme foundation (the new single source of truth)

Everything downstream keys off tokens, so land this first, fully tested, before touching a surface.

1. **Extend the generators** (`libs/css/scripts/generate-tamagui-config.mjs` + `tamagui-tokens.mjs`) to
   emit the COMPLETE Tamagui token set from `tokens.json`:
   - `color`: every design-token color **+ the 50-stop spectrum** (`$spectrum0..49`), values = resolved
     hex for native and (per SPIKE A1) `var(--lm-*)` for the runtime-themed ones on web.
   - `space` + `size`: the **Tailwind scale** (0→0, 0.5→2px, 1→4px, 2→8px, 4→16px, …) so class→prop is 1:1
     (SPIKE B).
   - `radius`: already generated — keep.
   - `zIndex`: a named scale for the overlay layering.
   - `fonts`: body/heading/mono with `size`, `lineHeight`, **`weight`**, **`letterSpacing`**, `face`.
2. **Themes:** `themes.light` / `themes.dark` (already generated) become the real Tamagui themes; add any
   sub-themes the app needs. `data-theme` switching → `<Theme name>` / a `ThemeProvider` at the app root
   driven by the existing theme state.
3. **Make `tamagui.config.ts` the ONE config** (delete `tamagui-web.config.ts`). Web gets the colored
   themes; per SPIKE A the injected vars are `var(--lm-*)`-backed so runtime space themes still work.
4. **Tests:** extend `token-parity.test.ts` — every `$token` (color/space/size/radius/font incl.
   weight+tracking) equals the `tokens.json`/Tailwind computed value, byte-for-byte, for light + dark +
   a space theme. This is the root guarantee, same role as Phase 1's L1.

---

## 4. P2 — Component library: BEM CSS → `styled()` + variants

Convert `libs/css/src/{components,elements}/**` (68 files) into Tamagui components. This deletes the
`@apply` CSS **and** the `!important` pass.
- Each BEM block + its modifiers → one Tamagui `styled()` with `variants`. Example:
  `.btn/.btn--primary/.btn--ghost/.btn--sm` → `styled(Pressable, { variants: { variant: { primary:{…},
  ghost:{…} }, size: { sm:{…} } } })`; surfaces `className="btn btn--primary"` → `<Button
  variant="primary">` (the `Button` element already exists — swap its internals + kill its CSS import).
- Translate each `@apply` line to props/tokens once, by hand or a `@apply`→props helper (the utility→prop
  table from §5 is reused).
- Order: leaf styled elements first (button, input, card, panel, badge…), then the composite BEM
  (dashboard, ide-*, workflow-*). Delete each `.css` file + its `import '...css'` only after its
  component's harness slice is reviewed green.
- Retire `apply-display-important.mjs` + revert the `!` edits once no `@apply` remains.

---

## 5. P3 — Surface `className` → Tamagui style props (the bulk: ~1281 usages)

The heart of the work. A new **`classnames-to-props` codemod** (TS-AST, like the Phase-1 codemods)
rewrites every static Tailwind class on a `Prim.*`/element to props, using a comprehensive
**utility→prop map**. The long tail is manual.

**The utility→prop map** (author once, exhaustively; drives both the codemod and P2):

| Tailwind | Tamagui prop |
|---|---|
| `flex`/`grid`/`block`/`hidden`/… | `display` |
| `flex-row`/`-col` | `flexDirection` |
| `items-*`/`justify-*`/`self-*`/`content-*` | `alignItems`/`justifyContent`/`alignSelf`/`alignContent` |
| `flex-1`/`grow`/`shrink-*`/`basis-*` | `flexGrow`/`flexShrink`/`flexBasis` |
| `gap-*`/`gap-x/y-*` | `gap`/`columnGap`/`rowGap` → `$space` |
| `p*-*`/`m*-*` (incl. negative/auto/arbitrary) | `padding*`/`margin*` → `$space` |
| `w-*`/`h-*`/`min-*`/`max-*` | `width`/`height`/`min*`/`max*` → `$size` |
| `bg-*`/`text-*`(color)/`border-*`(color) | `backgroundColor`/`color`/`borderColor` → `$color` |
| `text-*`(size)/`font-*`/`leading-*`/`tracking-*` | `fontSize`/`fontFamily`+`fontWeight`/`lineHeight`/`letterSpacing` → `$font*` |
| `rounded-*`/`border`/`border-*` | `borderRadius`/`borderWidth` → `$radius` |
| `shadow-*`/`opacity-*`/`ring-*` | `shadow*`/`opacity`/`outline*` |
| `absolute`/`relative`/`inset-*`/`top-*`/`z-*` | `position`/`top/right/…`/`zIndex` |
| `overflow-*`/`whitespace-*`/`truncate` | `overflow*`/`whiteSpace`/(ellipsis combo) |
| `transition-*`/`duration-*`/`animate-*` | `animation` (needs an animation driver + keyframes) |
| `translate-*`/`scale-*`/`rotate-*` | `transform` / `x`/`y`/`scale`/`rotate` |

**Variants (state/responsive) → Tamagui pseudo/media props** (this is where className can't be a plain
prop and the codemod earns its keep):
- `hover:` → `hoverStyle={{…}}`; `focus:`/`focus-visible:` → `focusStyle`; `active:` → `pressStyle`;
  `disabled:` → `disabledStyle` (+ the `disabled` prop).
- `group`/`group-hover:` → Tamagui `group` + `$group-hover`.
- `md:`/`lg:`/… → media props (`$gtSm`, `$gtMd`, …); **add a `media` config matching Tailwind's
  breakpoints** (40/48/64/80/96rem) in `createTamagui` first.
- `dark:` → theme-scoped (`$` tokens already flip with the theme; `dark:`-only overrides → a `dark`
  sub-theme value).

**Arbitrary + dynamic:**
- Arbitrary `text-[10px]`/`w-[200px]`/`bg-[var(--lm-x)]` → literal prop (`fontSize={10}`,
  `width={200}`, `backgroundColor="var(--lm-x)"`).
- `cn(...)` / template / conditional classNames → **manual**: rewrite to conditional prop objects
  (`{...(cond ? {backgroundColor:'$a'} : {backgroundColor:'$b'})}`). Expect a large manual tail; the
  codemod flags every dynamic className it can't lift (reuse the Phase-1 skip-reporting).

**Sequence:** one surface *area* per PR (e.g. `chat/app/EmptyState`, then `chat/app/Message`, …), each
gated by the P0 harness slice (human-reviewed diff) + L1 parity + `lint:rn` + typecheck + app build.
Keep the app shippable throughout — a not-yet-migrated component still renders because its className
still resolves against `theme.css` until `theme.css` is deleted last (P6).

---

## 6. P4 — Primitives & overlays go idiomatic

- **Primitives:** once surfaces pass props (not className), delete the Phase-1 hacks — the
  `createComponent({isText})` per-tag builders, the `whiteSpace/wordWrap:'inherit'` + per-tag `display`
  resets, the `webBlockCompat`, and the `className` passthrough. `Box`/`Row`/`Col` become plain
  `styled(View, {…})`; `Text` a `styled(Text)`; `Pressable` a `styled(View, {tag:'button'})` (compiler
  makes `tag` real). Retire `text-codemod.mjs`/`flexbox-codemod.mjs`.
- **Overlays:** replace the hand-rolled `Prim.*` Dialog/Sheet/Dropdown/ContextMenu with `@tamagui/dialog`
  /`popover`/`sheet` + `Adapt` (native → sheet). Now that theming is idiomatic (colored config +
  animation driver from §3), the theme-token blocker Phase 1 hit is gone. Keep the same public component
  names/API; verify with the harness + the jsdom behavior tests already written.

## 7. P5 — Config convergence, compiler ON, delete the old pipeline

- **One config both platforms:** web = `@tamagui/vite-plugin` (extraction ON, `disableExtraction:false`),
  native = `@tamagui/babel-plugin`, both feeding `tamagui.config.ts`.
- **Delete:** `@tailwindcss/vite` + Tailwind config + Tailwind `@layer` directives in `index.css`;
  `generate-theme.mjs` + `theme.css`; `tamagui-web.config.ts`; `apply-display-important.mjs` + the `!`
  edits; the design-token lint's Tailwind assumptions (repurpose to guard `$`-token usage instead of raw
  colors). Keep `lint-rn-safety.mjs` (still valuable) and extend it to forbid `className` on surfaces
  (the new invariant).
- **Runtime-theme bridge** (SPIKE A1) is the one deliberate remnant: `--lm-*` injection stays as the
  transport for per-space themes, now consumed through `$` tokens.

## 8. P6 — Types, verification, native

- **Types (SPIKE C):** land the single-`@types/react` fix; drop the `ComponentType<any>` casts; surfaces
  now get `$token` autocomplete + typed props.
- **Verification:** the P0 surface harness is the spine — every slice reviewed; L1 token parity exact; a
  final full-surface screenshot review per theme. Add a CI gate: `lint-rn-safety` forbids `className` on
  surfaces (proves the migration stays done).
- **Native (`apps/mobile`):** this is where idiomatic Tamagui finally pays off — the SAME components now
  render natively with no `.native.tsx` styling forks needed for the common case (only the irreducibly-
  web widgets keep forks). Run on device/Metro: Expo Router nav, real chat/studio screens, `PodTransport`
  wiring, `expo-font`. This needs a native toolchain (out of the current headless env) and is the true
  end-state proof.

---

## 9. Risks, STOP gates, effort

- **STOP gate after the 3 spikes.** If SPIKE A (runtime theming) can't preserve per-space themes without
  ugly hacks, or SPIKE B/C fail, re-scope (e.g. keep a CSS-var theme layer permanently, or stay Phase-1).
- **Biggest risks:** runtime/space theming (A); the ~1281-usage codemod long tail (dynamic `cn()`,
  arbitrary values, variants); the react-types clash; animation/transition parity (Tailwind transitions →
  Tamagui `animation` needs a driver + keyframe mapping); and **output changing** — every slice needs a
  human to accept the visual diff, which is slow.
- **This is not a "codemod and done."** Realistic shape: 3 spikes → token foundation → 68 CSS files →
  ~137 surface files (the long pole) → primitives/overlays cleanup → delete pipeline → types → native.
  Multi-month, every-file, human-reviewed. Sequence strangler-fig so the app ships at every commit.
- **Definition of done:** zero `className`/`@apply`/Tailwind/`theme.css` in the repo; all styling via
  Tamagui `$` tokens + props + themes + `styled()` variants; one config; compiler extraction on; overlays
  on `@tamagui/dialog`; typed components; L1 parity green; the surface harness reviewed per theme;
  `apps/mobile` running the real screens on a device.
