# Phase 2 — the idiomatic-Tamagui migration ("the Tamagui way", zero-Tailwind)

> **Status: BOTH SWEEPS DONE — every element block and every component block is swept. 13 much
> smaller stylesheets remain, holding ONLY rules that cannot be props. CSS bundle 171 → 52 kB.**
> Phase 1 (`react-native-tamagui-migration.md`, Parts I–III) put every surface primitive + overlay
> *onto Tamagui components* while **keeping the Tailwind + `theme.css` + BEM styling engine**
> underneath (coexistence). This Phase 2 replaces that styling engine with **idiomatic Tamagui** —
> style props + `$` design tokens + real themes + `styled()` variants + the optimizing compiler — and
> deletes Tailwind/`theme.css`/the empty-theme config/the `!important` pass/the base resets. **This
> CHANGES web output** and so abandons Phase 1's §0 byte-stability contract on purpose; that is the
> single biggest reason it needs an explicit go decision and a different verification model
> (baseline-first + human review, not "must match `main`").

## Progress log

The load-bearing, fully-testable foundation is landed and green, **P2's BEM→`styled()` conversion
covers all 68 component/element blocks** (proofs + tests), the **shipped-surface sweep is
complete**, and the **element-layer swap — the block this doc previously recorded as stuck — is
most of the way through**.

- **P3 codemod applied** to the `chat` (228 elements, `libs/ui/src/chat/**`) and `studio`
  (73 elements) surfaces — static Tailwind classes lifted to idiomatic props/`$tokens`; alpha
  modifiers/animations/dynamic `cn()` left as residual className.
- **Component-surface BEM sweep COMPLETE** — the entire `computer` surface plus every
  `components/**` area had its BEM classes on `Prim.*` converted to props.
- **Element-layer swap (P4) — COMPLETE, all 29 `elements/**` blocks.** Landed in slices:
  `btn` · `badge` · `heading`/`code`/`cozy-text`/`list-item` · `caption`/`label`/`separator` ·
  `stack`/`page`/`split-pane` · `card`/`panel`/`avatar`/`terminal` ·
  `top-bar`/`tab-bar`/`breadcrumb`/`app-links` · `input`/`textarea`/`select` ·
  `dialog`/`dropdown`/`sheet`/`settings-dialog` · `sidebar` (via `NavLink`) · `app-sidebar`.
  Each block's
  `@apply` rules become `$`-token style PROPS transcribed from its `*.styled.tsx` proof, applied to
  the `Prim.*` primitive that renders the real host tag.

### The two blockers this doc recorded, and what they actually were

**1. "Blocked on the compiler."** The previous status said semantic elements (button/input/select)
could not be swapped until `@tamagui/vite-plugin` extraction was ON, because `styled(View,{tag})`
renders a `<div>` at runtime. That is true of the `*.styled.tsx` PROOFS, which use `tag`. It was
never true of the shipped path: the Phase-1 primitives are built with `createComponent({Component:
tag})`, which binds the real host element at component-build time, so `Prim.Pressable` already
renders a real `<button>` with extraction OFF
([`_tamagui.tsx`](../libs/ui/src/elements/primitives/_tamagui.tsx)). The swap needs the proofs' VARIANT
TABLES, not the proof components. Every semantic element above is now swapped with the compiler off.

**2. Form controls, which really were blocked** — but on the primitives, not the compiler.
`TextField`/`TextArea`/`Select` were still Phase-0 host passthroughs, so a style prop had nowhere to
land. They are Tamagui `createComponent` components now. Two non-obvious details:
`componentName` must be `Input`/`TextArea` because Tamagui wires `::placeholder`/`::selection`
through `.is_<componentName>` selectors; and `isText` is used rather than `isInput`, because
`isInput` drops font props and forwards `placeholderTextColor` to the DOM as an unknown attribute.
`placeholderTextColor`/`selectionColor`/`resize` are translated to the CSS vars/`style` Tamagui's
base stylesheet actually reads.

### Two bugs the swap surfaced

- **`$` font tokens were silently dropped everywhere.** Tamagui keys the font scales
  (`fontSize`/`fontWeight`/`lineHeight`/`letterSpacing`) off the component's font FAMILY; with no
  `fontFamily` there is nothing to resolve `$sm` against, so the prop is discarded with no class and
  no warning (and a numeric-looking `$5` silently falls through to the SPACE scale). That is exactly
  what the P3 codemod and this swap emit when they lift `text-sm`/`font-medium` off a className, so
  **264 usages across 71 files were no-ops**. Fixed by
  [`withFontScale`](../libs/ui/src/elements/primitives/_tamagui.tsx), which defaults the family to
  `$body` only when a `$` font token is present and no family was given — and spreads it FIRST,
  since Tamagui resolves props in order. Pinned by `primitives/font-scale.test.tsx`.
- **`Code block` shipped a `<span>`.** It renders `<Prim.Text as="pre">`, but `pre` was in neither
  tag list, and an unmapped `as` falls back to `span` — losing `<pre>` semantics and its
  `white-space: pre`. Caught the moment the shipped-element suites were switched on.

### The verification spine (this is what changed most)

The `*-styled.test.tsx` proofs gate a PARALLEL `*.styled.tsx` copy of each block. The
`elements/**/index.test.tsx` suites — which gate `index.tsx`, the component the app actually renders
and the one this swap edits — were **excluded from the vitest include**, so the shipped element layer
had no coverage at all. They are wired in now
([`vitest.config.ts`](../libs/ui/vitest.config.ts)); the three reasons they were parked out were a
missing Tamagui provider (fixed by [`src/test-utils`](../libs/ui/src/test-utils/index.tsx)), RTL
auto-cleanup not self-registering without vitest `globals: true` (fixed in the setup file), and an
undeclared `@testing-library/user-event`. **libs/ui: 508 → 617 tests.**

Assertions pin Tamagui's deterministic ATOMIC classes (`_dsp-flex`, `_gap-c-space-3`,
`_fs-f-size-sm`) rather than computed styles. That is both stronger — the class names the property
AND the resolved design token — and necessary: jsdom cannot parse Tamagui's stylesheet at all (its
`@scope` rule fails jsdom's CSS parser), so `toHaveStyle` is unusable here.

### Two more things that turned out not to be blockers

**The overlay animations were DEAD, not deferred.** `dialog`/`dropdown`/`sheet` were recorded here as
blocked on a Tamagui animation driver because they are mostly
`data-[state=open]:animate-in`/`fade-*`/`zoom-*`/`slide-*`. But **nothing in the repo has set
`data-state` since Phase 1 B3.4 removed Radix** — Radix was what set it. Those selectors could never
match, so the rules had been inert for the whole of Phase 2. They were deleted, not ported; no
animation driver, no new dependency, and no motion change (there was no motion). `data-[disabled]`
was the same, and is now Tamagui's `disabledStyle`, which keys off the real `disabled` prop.
`.sheet--left` was likewise referenced by the component but never defined in the stylesheet.

**`@media` needed no new machinery.** `settings-dialog`'s `@media (max-width: 640px)` block is now
Tamagui media props. The generated media config is Tailwind's — min-width, mobile-first — so the
query INVERTS: the narrow layout becomes the base and `$gtXs` restores the wide one. Its other CSS
hack went too: `.dialog.settings-dialog` was a compound selector whose only job was to out-specify
the base `.dialog` width cap. With the dialog on props, `DialogContent` spreads its base and then
the caller's props, so passing `maxWidth`/`maxHeight` wins by spread order.

### Compiler extraction: measured, and it does NOT do what this plan assumed

The shortcut this doc implied — turn extraction ON and adopt the 68 `*.styled.tsx` proofs wholesale
— **does not work.** Measured end to end against `apps/web`:

- Extraction *runs* (448 files) once the plugin is given an entry it can bundle. It cannot be
  pointed at `@lmthing/ui`: the extractor config-bundles each entry in `components:`, and the
  package barrel reaches app-coupled modules (`components/auth/*` → `@tanstack/react-query`,
  a `@/` alias) that do not resolve outside the app and hard-fail the build. A dedicated barrel
  exporting only component definitions fixes that.
- With that in place a `styled()` component **is** flattened to a host element with a precomputed
  className — but to **`div`**, ignoring `tag: 'button'` in the `styled()` definition. Passing
  `tag` as a JSX prop instead makes the extractor **bail entirely**.
- So extraction does not make `tag` real. The per-tag `createComponent` primitives remain the only
  thing that yields a correct host tag, which is what §6 now says.
- Extraction is also nearly pointless here today: the primitives are `forwardRef` wrappers, so the
  extractor cannot statically analyse them and leaves them alone. Every real surface goes through
  those, so almost nothing is optimized. It is left OFF.

Two gotchas worth keeping if anyone retries: an **import alias** (`import { X as Y }`) silently
defeats extraction, and the plugin was loading the **native** config (`tamagui.config.ts`) for the
web build, so the extractor never saw the web components at all.

### The element layer is finished

`elements/**` now contains no stylesheets at all. The last two blockers both dissolved:

- **`sidebar__item`** was kept as CSS because most call sites were TanStack Router `<Link>`s,
  which render their own `<a>` and accept only `className`. `studio/shell/nav-link` replaces them
  with a `Prim.Link` that navigates via `useNavigate`, keeping a real `href` so middle-click,
  ⌘/Ctrl-click and "open in new tab" still work. It lives in `studio/shell/` deliberately —
  `@tanstack/react-router` is a surface dependency, and `elements/**` stays router-agnostic.
- **`app-sidebar`**, the largest block (41 classes), needed only three non-obvious moves: the
  descendant combinator became props at its one call site; the hover-reveal became Tamagui's
  `group`/`$group-row-hover` (which is what the stylesheet's own comment said it was emulating);
  and the `/60` alpha became a `color-mix`.

### Two more silent-drop bugs

The same failure mode as the font tokens — a prop that goes nowhere, with no error:

- **`Prim.Image` dropped every style prop.** It was a host `<img>` passthrough, but it is in the
  P3 codemod's target list, so the codemod had been turning `h-5 w-5 object-cover` into
  `height="$5" width="$5" objectFit="cover"` — unknown DOM attributes on a host element. Seven
  call sites had been shipping unstyled images, five since the original codemod runs. `Image` is
  now a per-tag `createComponent` like the form controls.
- **`libs/ui` was never typechecked.** It has no `typecheck` script, so 550 files — the whole
  element layer and every surface — were unchecked, and an unbalanced JSX tag reached the bundler
  during this work. A full `tsc --noEmit` reports ~1800 errors (SPIKE C plus drift) so it cannot
  be a gate yet; `tsc --noEmit --noCheck` parses without type analysis, is clean today, and is
  verified to fail on exactly that bug. Added as `typecheck:syntax` and wired into `lint`.

### The components sweep is automated now

Hand-converting the 16 remaining sheets was not viable — ~810 classes, 1446 plain declarations,
1159 `@apply` utilities. Two codemods plus a driver replace it:

- **`bem-to-props`** turns a BEM stylesheet into `$`-token prop bags. `@apply` goes through the
  SAME map the P3 className codemod uses, so the two agree by construction; plain declarations go
  through a property table that expands the padding/margin/border shorthands and `flex: 1`. The
  load-bearing property is the **SAFETY RULE**: a rule converts only if EVERY declaration in it
  maps. A half-converted rule would silently drop the rest — the failure this migration has now
  hit four times. Anything unmapped is reported and stays in CSS.
- **`bem-rewrite-callsites`** swaps `className="block__el"` for the bag, lifting only tokens whose
  rule actually converted.
- **`bem-sweep`** chains them: emit → rewrite → prune unused bags → drop the dead stylesheet
  import → trim the sheet to its blocked rules (deleting it when none remain).

**Applied to every remaining sheet: 566 rules converted, 136 left as CSS.** What blocks the rest,
in order: descendant/pseudo/state selectors (the majority), `transition`, `box-shadow`,
`grid-template-columns`, gradients.

The sweep's own verification is an **orphan-className diff** — the set of BEM classNames that no
stylesheet defines, captured before and compared after. It is what caught the driver deleting
rules whose classes survived the rewrite inside a template literal, and it is the check to re-run
for any further sheet work.

Two things learned applying it. **Rule count badly overstates the work** — `auth` and `thing-panel`
were 16 and 32 rules but only 5 and 2 were reachable; the rest was dead CSS behind stale imports.
And there are **three co-located stylesheets inside `libs/ui`** (`chat/app/styles.css`,
`FieldTree.css`, `tasklist-editor.css`) that the `libs/css` counts never included.

The tooling shipped six defects of the same shape it exists to prevent, all now pinned by tests:
a leading `@reference` glued onto the first selector (dropping one rule per sheet, 14 total); an
import inserted inside a multi-line `import { … }`; a CLI that ran at module scope so importing it
executed with the importer's argv; **trimming a rule whose class survived in a dynamic call site**;
several sheets sharing one props file so each run overwrote the last; and a generator emitting raw
hex that `lint:tokens` rejects. The sweep is also **destructive and not idempotent** — it trims the
sheet it reads — so it now refuses to run over its own output.

### What remains — and the dependency that orders it

**13 trimmed `components/**` stylesheets — 136 rules.** Every sheet has been swept; what is left
is the residue that has no prop form, so this is no longer a mechanical backlog:

| Blocker | Notes |
|---|---|
| descendant / pseudo / state selectors | the majority; each needs a component-shaped rewrite (Tamagui `group`, an explicit branch, or a child prop) |
| `transition` / `animate-*` | needs an animation driver — but check first whether the rule is live at all; the overlays' were dead |
| `box-shadow` | a single-layer Tamagui approximation is a human call, not a codemod's |
| `grid-template-columns` | no Tamagui prop; the surfaces using grid stay CSS for now |
| gradients | no prop form |

`markdown/index.css` is the one sheet that will likely never convert: it styles HTML produced by
`marked` and injected as a string, so there are no React elements to put props on.

- **The codemod tail.** Re-run across all 118 files, `classnames-to-props`
  can migrate almost nothing: of 219 reported elements, 181 skip for unmapped classes, and those
  are overwhelmingly BEM from these 16 stylesheets. The codemod refuses to half-migrate an
  element, so a single BEM class on it blocks the Tailwind utilities beside it. Extending the map
  with the genuinely-missing utilities (legacy `flex-shrink-0`, `cursor-*`, `select-none`,
  `leading-*` keywords, `object-*`, `size-*`) unblocked 30 elements — that is the whole ceiling
  until the stylesheets go.
- **Deleting Tailwind.** Measured: **945 residual Tailwind utility
  classNames across 55 files**, plus these 16 stylesheets' `@apply`, plus the preflight resets the
  Phase-1 primitives explicitly rely on (the `<button>` UA reset). Removing Tailwind today breaks
  all three. And `theme.css` cannot be a straight delete either: SPIKE A1 makes every `$color`
  resolve to `var(--…)`, so a custom-properties-only file has to survive it or every colour in the
  app resolves to nothing.
- **P0 is still the gating item for anything that changes output**, and is still not built.
- Then SPIKE C (react 18/19 types — which also unlocks a real `typecheck`) and native.

| Item | Status | Where |
|---|---|---|
| **SPIKE A — runtime/per-space theming** | ✅ **PASS via A1** | `webColorTokens` (values `var(--<name>)`) in `libs/css/scripts/tamagui-tokens.mjs`; wired in `libs/ui/src/theme/tamagui-web.config.ts`; EMPIRICALLY proven in `apps/web/b0-probe/spike-a-runtime-theme.spec.ts` (real Chromium, real `theme.css`): `$background`/`$foreground` resolve light/dark + a runtime space override |
| **SPIKE B — token-scale reconciliation** | ✅ done | Tailwind `space`/`size`/`fontSizes`/`lineHeights`/`fontWeights`/`letterSpacings`/`zIndex`/`media` generated + pinned to Tailwind by `libs/css/src/__tests__/scale-parity.test.ts` |
| **SPIKE C — react 18/19 types** | ⬜ open | not attempted; casts retained (documented in `_tamagui.tsx`). Blocks nothing above |
| **P1 — token + theme foundation** | ✅ done | full Tamagui token set from `tokens.json`; `tamagui.config.ts` (native hex) + `tamagui-web.config.ts` (var-backed) both carry it; parity tests green. Config CONVERGENCE (one config, delete web config) deferred — it changes output, see §7 |
| **P2 — BEM → styled()+variants** | ✅ 68 proofs + ✅ **component sweep COMPLETE** | Every BEM block has a `*.styled.tsx` proof + `*-styled.test.tsx` gate. **Every `components/**` + `computer` surface is swept**: all BEM on `Prim.Box/Text/Pressable` → props. `.css` deleted when a block was fully on `Prim.*`; KEPT when residuals sit on icons / third-party components / un-expressible CSS. **16 stylesheets remain**, all under `components/**` (`elements/**` is empty). The `!important`/`@apply` retirement waits until `theme.css` deletion (P6) |
| **P3 — className → props codemod** | ✅ tool built + hardened + 🟡 **applied to chat+studio** | `libs/ui/scripts/classnames-to-props{,-map}.mjs` + a 43-test gate (map + a new `-transform` suite). **Run for real**: chat + studio. Hardened after the first run surfaced two silent-drop bugs (both fixed + regression-tested, re-migrated clean): (a) directional `border-t/r/b/l/x/y` were misread as color tokens (`$t`) → widths dropped; (b) the `lm-*` runtime palette (`bg-lm-accent` …) became bogus `$lm-*` tokens → now kept as className. Also **added `cn("literal", …rest)` lifting** (the common dynamic shape). Alpha modifiers/animations/`lm-*`/dynamic `cn()` stay residual. Remaining className: chat ~223, studio ~589 (mostly BEM on shared elements + dynamic `cn()`), computer ~24 |
| **P0 — real-surface visual harness** | 🟡 mechanism proven, baseline NOT built | the A1 probe + the b0-probe `measure-surface` computed-style pattern are the objective (non-human) parity gate; a full fixtured `tests/visual-surface/` baseline is remaining. **This is now the gating item**: the animation driver (the biggest remaining unblock) changes visible motion app-wide, which is precisely the class of change P0 exists to review |
| **P4 — element layer + primitives idiomatic** | ✅ **DONE — all 29 element blocks; `elements/**` has no stylesheets** | Every shipped element carries `$`-token PROPS on the `Prim.*` primitives (real host tags via `createComponent`). Both blockers this row used to name were wrong: extraction does NOT make `tag` real, and the overlay animations were DEAD rather than deferred. Form-control and `Image` primitives are Tamagui-backed too. Shipped-element suites gated for the first time (508 → 618 tests), plus a syntax-only typecheck gate for `libs/ui` |
| **P5 — components sweep, compiler ON, delete pipeline** | ✅ **sweep DONE — all 19 blocks swept**; ⬜ compiler/pipeline | `bem-to-props` + `bem-rewrite-callsites` + `bem-sweep` converted 566 rules across the 12 remaining sheets. 136 rules stay as CSS because they have no prop form (descendant/pseudo selectors, `transition`, `box-shadow`, grid templates, gradients). Verified per sweep by an orphan-className diff, which caught the driver removing rules whose classes survived in dynamic call sites. Extraction was measured and stays OFF |
| **P6 — types + native on device** | ⬜ remaining | SPIKE C also unlocks a real `typecheck` for `libs/ui` (today only a syntax gate); native needs a Metro/device toolchain |

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

- **Primitives — KEEP the per-tag builders.** The original plan here was to delete the
  `createComponent({isText})` per-tag builders once the compiler could make `tag` real. The swap
  showed the opposite: those builders are what let the whole element layer migrate with extraction
  OFF, because they bind the real host element at component-build time. `styled(View,{tag:'button'})`
  renders a `<div>` at runtime, so replacing them would trade a working, a11y-correct element layer
  for one that only works after extraction. They stay.
  What genuinely can retire once `theme.css` goes: the `whiteSpace/wordWrap:'inherit'` + per-tag
  `display` resets and the `webBlockCompat` shims (they exist to reproduce Tailwind-preflight box
  semantics), the `className` passthrough, and `text-codemod.mjs`/`flexbox-codemod.mjs`.
- **Form controls are primitives too.** `TextField`/`TextArea`/`Select` are built the same per-tag
  way (`isText`, not `isInput`) so `elements/forms/*` can carry tokens as props — this was the real
  blocker on those three blocks, not the compiler.
- **Font tokens need a family.** Any primitive accepting `$` font tokens must ensure a `fontFamily`
  is set first, or Tamagui silently drops them (`withFontScale`). Keep that invariant if these
  builders are ever rewritten.
- **Overlays — DONE, and they needed none of what this bullet planned.** The plan was to replace the
  hand-rolled `Prim.*` Dialog/Sheet/Dropdown with `@tamagui/dialog`/`popover`/`sheet` + `Adapt` once
  an animation driver existed. In fact their animation rules were all `data-[state=…]`-gated and
  **nothing has set `data-state` since Radix was removed**, so they were inert: deleted, not ported,
  with no driver and no new dependency. The hand-rolled components keep their API and now carry
  `$`-token props; the jsdom behaviour tests still gate them. Swapping onto `@tamagui/dialog` is a
  separate, optional refactor — worth doing for `Adapt` (native → sheet), not for styling.

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
