# The final steps — from "mostly Tamagui" to zero-Tailwind

> **Scope.** This is the closing plan for the Phase-2 migration
> ([`tamagui-idiomatic-migration.md`](./tamagui-idiomatic-migration.md)), written against the
> **measured** state, not an estimate. Every count below is reproducible with the commands in
> [§0](#0-how-to-re-measure). It supersedes nothing: the other doc stays the record of *what
> happened and why*, this one is *what is left and in what order*.

> **Status.** Phase 0.5 ✅ · phase 2 ✅ · phases 1, 3, 4, 5 open. Each completed phase keeps its
> section below, rewritten to record what was actually done and where this plan was wrong — the
> corrections matter more than the ticks, because three of them were load-bearing.

## The definition of done

Five conditions. Anything not on this list is out of scope and named in [§7](#7-explicitly-not-in-scope).

1. `@import "tailwindcss"` appears nowhere. `theme.css` survives as a **vars-only** file.
2. No `className` on a surface component carries a Tailwind utility.
3. No `style={{…}}` on a Tamagui-backed primitive carries a static style.
4. One Tamagui config, not two.
5. `libs/ui` has a real `tsc`, not a syntax-only one.

## Where it actually stands

| | count | where |
|---|---|---|
| utility classNames | **125** | 87 real Tailwind · 27 keyframes · 11 `prose` |
| inline `style={{…}}` | **130** | 45 files, ~60% in `apps/web` studio routes |
| stylesheets | **14** | 180 rules — 11 component + `FieldTree.css` + the chat Tailwind entry + `animations.css`; 3 permanent |
| Tailwind entry points | **2** | `libs/css/src/theme.css`, `libs/ui/src/chat/app/styles.css` |
| Tamagui configs | **2** | `tamagui.config.ts` (native hex), `tamagui-web.config.ts` (var-backed) |
| compiler extraction | **off** | deliberate — `libs/utils/src/vite.mjs` |
| CSS bundle | **31.10 kB** | from 171 kB — `apps/web` build; phase 0.5 took 1.46 kB of it |
| P0 fixtures | **230** | 222 + the 8 animation rows phase 2 added |

The work below is ordered so that **nothing is deleted before its replacement is proven**, and every
phase ends at a green `pnpm test:surface`.

---

## 0. How to re-measure

Do this first and after every phase. If a number here is stale, trust the command.

```bash
pnpm test:surface                      # P0 — 222 elements, light + dark. THE gate.
pnpm --filter @lmthing/ui test         # 284 unit tests
pnpm typecheck                         # workspace
pnpm --filter @lmthing/ui run typecheck:syntax
pnpm --filter @lmthing/ui run lint:tokens && pnpm --filter @lmthing/ui run lint:rn
cd apps/web && pnpm build && npx tsc --noEmit -p tsconfig.app.json   # 8 errors = the known baseline

# the two counters this plan is scored against
node libs/ui/scripts/classnames-to-props.mjs --check $(find libs/ui/src apps/web/src -name '*.tsx' ! -name '*.test.tsx')
node libs/ui/scripts/inline-style-to-props.mjs --check $(find libs/ui/src apps/web/src -name '*.tsx' ! -name '*.test.tsx')
```

**`pnpm test:surface` is the review artefact for phases 1–4.** None of them can be reviewed by
reading a diff; all of them can be reviewed as a computed-style delta. When a phase legitimately
changes output, re-capture with `pnpm test:surface:update` and **put the baseline diff in the commit**
— that diff is the actual thing a human signs off.

---

## Phase 0.5 — the free win ✅ DONE

`theme.css` imported **`tw-animate-css`** and **nothing used it**. Its utilities
(`animate-in`/`animate-out`/`fade-in-*`/`zoom-in-*`/`slide-in-from-*`) appear zero times across
`libs/ui/src` and `apps/web/src`.

```bash
# the check, so this is not taken on faith
grep -rhno 'className="[^"]*"' libs/ui/src apps/web/src --include=*.tsx \
  | grep -oE 'animate-(in|out)|fade-in-[0-9]+|zoom-in[a-z0-9-]*|slide-in-from[a-z0-9-]*'
```

Removed in **three** places, not one — the third is the one that would have silently undone it:

1. the `@import` in `libs/css/src/theme.css`;
2. **the same line in `libs/css/scripts/generate-theme.mjs`**, which emits it. `theme.css` is
   generated, so editing only the output is reverted by the next
   `pnpm --filter @lmthing/css generate`;
3. the `peerDependencies` entry in `libs/css/package.json` (+ `pnpm-lock.yaml`).

**It was not free to ship.** tw-animate-css declares its `@keyframes` and custom properties at the
top level, so Tailwind emitted them whether or not a utility referenced them: the P0 bundle went
**37.95 kB → 35.13 kB** (gzip 7.34 → 6.95).

**Gate met:** P0 byte-identical, so nothing was in fact using it.

---

## Phase 1 — the icon classNames (87 → ~45)

The single largest remaining className bucket is not on primitives at all. It is on **lucide icons**:
`size-4` ×7, `shrink-0` ×7, `w-4`/`h-4` ×4, plus a few colour utilities, spread over `Settings`,
`Clock`, `AlertCircle`, `XCircle`, `Star`, `CheckCircle` and friends.

These do **not** want style props. Lucide takes its own `size` prop and a `color` prop, and renders
an `<svg>` whose `width`/`height` are geometry attributes.

**Do:** replace `className="size-4"` with `size={16}` (`LucideProps.size` is `string | number`),
and `className="text-muted-foreground"` with `color="var(--muted-foreground)"` — lucide extends
`SVGProps`, and its paths are `stroke="currentColor"`, so the `color` attribute is what they resolve
against. `shrink-0` becomes a wrapper prop, or is dropped where the icon already sits in a
non-shrinking row.

**Do not** add lucide components to the codemod's target list. It has no way to know that `size-4`
means `size={16}` rather than `width: '1rem'`, and a wrong guess here is silent.

**Gate:** P0 unchanged (icons are not in the fixtures — *add one* while doing this, so they are).

---

## Phase 2 — free the keyframes from the Tailwind entry ✅ DONE

This is the ordering constraint the whole deletion hangs on, and it is easy to miss:
**`libs/ui/src/chat/app/styles.css` is itself an `@import "tailwindcss"` entry.** It is the repo's
second one, loaded by the `/chat` route, and it owned every `lm-*` keyframe plus the `.lm-prose`
block that styles `marked`-injected HTML.

So the keyframes could not survive the Tailwind deletion where they lived.

**Done:**

1. **`libs/css/src/animations.css`** — a plain stylesheet: no `@import "tailwindcss"`, no `@apply`,
   no `@theme`, no `@reference`. Holds the five `@keyframes` (`lm-spin`, `lm-fade-in`,
   `lm-slide-in-right`, `lm-pulse`, `lm-stream-cursor`), their four classes,
   `.streaming-cursor::after` and the `prefers-reduced-motion` block, all moved verbatim.
   Exported as `@lmthing/css/animations.css` and imported from **`apps/web/src/index.css`** — the
   app entry, not a route.
2. **Tailwind's `animate-spin` / `animate-pulse`, hand-written.** Values taken out of Tailwind v4's
   compiled output rather than remembered: `spin 1s linear infinite` and
   `pulse 2s cubic-bezier(.4,0,.6,1) infinite` (opacity → .5), longhand rather than
   `var(--animate-*)` because those custom properties are generated by `@theme` and go with it.
3. **`.lm-prose` → `libs/css/src/components/markdown/index.css`**, next to `.lm-markdown`.
4. `chat/app/styles.css` **survives phase 2** with base/reset styling and the `--lm-*` bridge.

### Where this plan was wrong

Three corrections, each of which would have shipped a silent failure:

- **"add new classes rather than reusing them" was half right.** Do not fold `animate-spin` into
  `lm-spin` — the timings differ (1s vs 1.2s). But do **not** rename them either: `animation-name`
  is in P0's audited property set, so a new name is a computed-style delta at every call site. The
  hand-written rules therefore keep Tailwind's **class *and* keyframe names**, which also means zero
  call-site churn. While Tailwind is still present the two definitions coexist; the content is
  identical, so whichever wins the cascade computes the same. The counts were also off —
  `animate-pulse` has **6** call sites, not 4.
- **"`.lm-prose` → `markdown/index.css`" is not sufficient on its own.** That stylesheet is
  **component-scoped**: its only importer is `elements/content/markdown/index.tsx`. `.lm-prose` is
  used by `chat/app/Message.tsx`, which does *not* use that component — so the move alone would have
  recreated exactly the route-scoping bug this phase exists to fix. `Message.tsx` now
  side-effect-imports the stylesheet, the convention `markdown/index.tsx` already follows.
- **"the P0 `animation` fixture already measures all of these" was false.** It measured three of the
  six — `lm-fade-in`, `lm-spin`, `lm-pulse`. `lm-slide-in-right`, `.streaming-cursor`,
  `animate-spin` and `animate-pulse` were *not* in it, i.e. the four rules this phase was riskiest
  for were the unmeasured ones. They were **added first**, and the baseline re-captured **while
  Tailwind still generated them**, so "equivalent" is a measured zero-delta rather than a claim.
  222 → 230 rows, purely additive.

Also: **`chat/app/styles.css` is not "only `@import "tailwindcss"` + two `@theme` blocks"** after
this phase. It still owns base `html/body/#root` styles, the scrollbar rules, the `:focus-visible`
ring, the `--lm-*` token bridge and the safe-area classes. Phase 4 must **relocate** those, not
delete the file and expect nothing to move.

### The route-scoping problem, stated precisely

The stated risk — that these classes are used outside `/chat` and only work "because everything
lands in one CSS file" — is **latent, not active**: today's `apps/web` build emits a single CSS
bundle, so a route-module `@import` is in fact global. What was actively wrong is *ownership*: the
rules lived in a file that dies in phase 4. The latent half becomes real the moment CSS code
splitting is enabled, which is why `animations.css` is on the app entry.

**Gate met:** P0 **230 elements, zero delta**; bundle 35.13 → 34.00 kB.

**And a test, because P0 cannot see three of these things** —
`libs/css/src/animations.test.ts` (27 assertions) pins what the computed-style gate structurally
cannot: `.streaming-cursor`'s animation is on its `::after` and the P0 walk calls
`getComputedStyle(el)` with no pseudo argument; a re-introduced Tailwind dependency compiles fine
*today* and only breaks in phase 4, far from its cause; and a rule **copied** rather than **moved**
leaves both files agreeing, so P0 passes while the chat entry quietly keeps ownership. It was
verified against injected regressions (aliasing `animate-spin` onto `lm-spin`; dropping one class
from the reduced-motion list) rather than assumed to work.

### Known gap, deliberately not closed here

The `prefers-reduced-motion` block covers the `lm-*` classes only — `.animate-spin` and
`.animate-pulse` keep spinning, which is the behaviour that shipped when they came from Tailwind.
Extending it is a real accessibility improvement, but it is a real motion change and **P0 does not
emulate `prefers-reduced-motion`**, so it would be an unverifiable edit smuggled into a move. It
wants its own change, with a harness that can assert it.

---

## Phase 3 — close the inline-`style` tail (130 → ~30)

`scripts/inline-style-to-props.mjs` reports **37**; the other ~93 sit on components it does not
target. Three groups, in increasing effort:

| group | count | action |
|---|---|---|
| `...spread` / shorthand members | 18 | hand-lift; the spread usually has a static base worth extracting to a prop bag |
| unmappable keys | ~19 | `flex: '2 1 auto'`, `transition`, `boxShadow`, `font`, `outline`, `borderCollapse`, `objectFit`, `textDecoration` — decide each; several want the driver's `transition` prop now |
| on non-target components | ~93 | mostly `apps/web` studio routes on composites; widen the target list per component **after reading it** |

The `apps/web/studio/$projectId/app/*` routes hold ~40 of these between four files and are the
highest-yield place to start.

**Trap, already paid for once:** `wordBreak`, `listStyleType` and `listStyle` are *accepted* by the
type system and *silently dropped* by Tamagui. They must stay in `style`. The codemod's accept-list
excludes them and `primitives/index.test.tsx` pins why.

---

## Phase 4 — delete Tailwind

Only attempt this when phases 1–3 leave **fewer than ~15** utility classNames, all of them
deliberate.

`theme.css` is 266 lines in four parts. Two go, two stay — it is a **rewrite, not a deletion**:

| lines | what | fate |
|---|---|---|
| 1 | `@import "tailwindcss"` | **delete** (line 2's `tw-animate-css` already went in phase 0.5) |
| 4 | `@custom-variant dark` | delete (a Tailwind directive) |
| 7–20, 21–123 | `@theme` / `@theme inline` | **KEEP, rewritten as plain `:root` custom properties.** SPIKE A1 makes every `$color` resolve to `var(--color-<name>)`; if these stop being emitted, every colour in the app resolves to nothing |
| 124–266 | `:root` | keep verbatim |

**Also required, and easy to forget:**

- **Preflight.** The primitives rely on Tailwind's base resets — notably the `<button>` UA reset
  that `Prim.Pressable` assumes. Extract the handful actually depended on into
  `libs/css/src/preflight.css`; do not ship the whole of preflight and do not ship none of it. The
  P0 `forms` fixture is what tells you which ones matter.
- **`@apply`.** 87 uses across the stylesheets die with Tailwind. Every one must be inlined to
  plain CSS first. `classnames-to-props-map.mjs` already holds the utility→value knowledge, but it
  emits Tamagui PROPS, not declarations — so this needs a small second emitter over the same table,
  not a hand-rewrite of 87 rules and not a reuse of `bem-to-props.mjs` as-is.
- **The `lint:tokens` gate** reads `tokens.json` → `theme.css`; check `generate-theme.mjs` still
  emits a valid file in the new shape.

**Gate:** a P0 delta is EXPECTED here. Review it property by property. A delta on
`box-sizing`, `margin` or `border-width` means preflight was under-extracted; a delta on any
`color` means the `@theme` rewrite dropped a custom property.

---

## Phase 5 — one config, and a real typecheck

Independent of the above; do it last because it touches everything.

**5a — config convergence.** `tamagui.config.ts` (native, resolved hex) and `tamagui-web.config.ts`
(web, `var(--…)`-backed) exist because SPIKE A1 needs var-backed colours on web and native has no
CSS variables. Converge to one config with a platform-conditional colour token set. Note the vite
plugin bundles the config and imports it from the app root — which is why `apps/web` carries a
`@tamagui/web` devDependency; that stays relevant.

**5b — SPIKE C.** `libs/ui` runs `tsc --noCheck` (syntax only) because the repo carries both
`@types/react@18` and `@types/react@19` and the two `ReactNode` unions are incompatible. This is
not cosmetic — it is why:

- `app-sidebar` and `settings-dialog` cannot be render-tested (a second React copy → "Invalid hook
  call");
- three primitive prop types (`gridTemplateColumns`, the `$`-media bags, `LayoutStyleProps` on
  `List`) went undeclared until `apps/web` — which *does* typecheck — found them;
- one route needs a `children as never` cast.

Resolving it converts a whole class of silent breakage into compile errors. **Also add a
`typecheck` script to `apps/web`** — it has a working `tsconfig.app.json` and 8 known errors; wiring
it into CI once those are fixed closes the gap that let the three prop types slip.

**5c — extraction.** Re-evaluate `disableExtraction: true` once there is one config. It was turned
off because the extractor cannot optimise `@lmthing/ui` components and tripled build time for no
output change. That may not survive config convergence — measure, don't assume.

---

## 6. Traps, all of them already paid for once

Every one of these produced a silent failure during the migration. They are listed here because
each will bite again in the phases above.

| trap | what happens |
|---|---|
| the prop is `transition`, not `animation` | Tamagui 2.5 renamed it; `animation` is ignored with no error, on every component including a raw `View` |
| `animateOnly` needs **hyphenated** CSS names | `backgroundColor` emits `transition: backgroundColor 150ms`; the browser drops the declaration |
| Tailwind's `group` ≠ Tamagui's `group` | class vs PROP; a converted child emits a selector nothing matches — invisible until someone hovers. Three shipped reveals were dead this way |
| host-passthrough primitives ignore style props | `Br`, `Hr`, `DataList`, `Option`, the `Svg` family, `Audio`/`Video`/`IFrame`. Converting a className on one deletes the styling |
| `wordBreak` / `listStyleType` / `listStyle` | accepted by the types, dropped by Tamagui |
| `lm-*` must map to `var(--lm-…)` | never to the token it currently aliases — `applyThemeTokens` overrides `--lm-*` per space |
| a Tamagui-backed `<svg>` drops geometry attributes | `width`/`height` become CSS; fine on the root, wrong on `<rect>`/`<circle>` |
| `tsc --noCheck` sees no duplicate identifiers | a duplicate `import * as Prim` reached the babel extractor and broke the build |

---

## 7. Explicitly not in scope

- **`markdown/index.css`** — styles HTML `marked` produces as a string. There is no React element to
  hold a prop. It stays CSS permanently. Phase 2 added `.lm-prose` to it for exactly this reason.
- **`animations.css`** — keyframes. Not Tailwind's job and not the animation driver's (the driver
  handles *transitions*, via the `transition` prop). Plain CSS permanently, by design.
- **`FieldTree.css`** (2 rules) — `.react-arborist*`, rendered by the library. Same reason.
- **`prose-*`** (11 classNames) — `@tailwindcss/typography` descendant selectors over injected HTML.
  If Tailwind goes, these need hand-written equivalents in `markdown/index.css`, not props.
- **`tests/visual/`** — the older harness renders local passthrough copies of the pre-Tamagui
  primitives to keep its pre-swap baselines valid. It is not wrong, it just answers a different
  question. Leave it or delete it deliberately; do not "fix" it into a duplicate of
  `tests/visual-surface/`.
- **Native on device.** Needs a Metro/device toolchain that does not exist in this repo yet.

---

## Suggested sequencing

Phases 1–3 are independent and can land in any order or in parallel; phase 4 needs all three.

```
0.5 tw-animate-css   unused import          ✅ DONE
2. keyframes      unblocks phase 4          ✅ DONE
1. icons          ~87 → ~45 classNames      small, mechanical, low risk
3. inline style   130 → ~30                 the largest, most parallelisable
                        ↓
4. delete Tailwind      the only phase with an expected P0 delta
                        ↓
5. one config + a real typecheck            touches everything; do it last
```

**Next: phase 1, then phase 3** — independent of each other, and phase 4 needs both.

What phase 2 hands to phase 4, concretely: the keyframes are out of the way, so the remaining
question for `chat/app/styles.css` is no longer "how do the animations survive" but **"where do the
base styles, the scrollbars, the `:focus-visible` ring, the `--lm-*` bridge and the safe-area classes
go"** — see the correction in §2. `theme.css` remains the `@theme`-rewrite-plus-preflight problem it
always was.

One lesson worth carrying into 1, 3 and 4: **check what P0 actually renders before trusting it as
the gate.** Phase 2's riskiest four rules were outside the fixtures, and the plan asserted the
opposite. Extend the fixtures *first*, capture the baseline while the old implementation is still in
place, and the change becomes a zero-delta proof instead of a claim. Phase 1 already says to add an
icon fixture — that is the same move, and it is the right one.
