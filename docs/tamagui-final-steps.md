# The final steps — from "mostly Tamagui" to zero-Tailwind

> **Scope.** This is the closing plan for the Phase-2 migration
> ([`tamagui-idiomatic-migration.md`](./tamagui-idiomatic-migration.md)), written against the
> **measured** state, not an estimate. Every count below is reproducible with the commands in
> [§0](#0-how-to-re-measure). It supersedes nothing: the other doc stays the record of *what
> happened and why*, this one is *what is left and in what order*.

> **Status.** Phases **0.5 ✅ · 1 ✅ · 2 ✅ · 3 ✅** (className axis; inline-`style` tail ◐) ·
> **5b ✅** (pulled forward — see below) · **4 scoped, not executed** · **5a/5c** not started.
> Each completed phase keeps its section, rewritten to record what was actually done and **where this
> plan was wrong** — the corrections matter more than the ticks, because several were load-bearing.
>
> **Definition of done: 2 of 5 met** — (2) no Tailwind utility className anywhere, (5) `libs/ui` has a
> real typecheck. Open: (1) `@import "tailwindcss"` still in 2 files, (3) 127 inline styles on
> Tamagui-backed targets, (4) still two Tamagui configs.

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
| utility classNames | **0** | was 125. What remains is keyframes, BEM, `{className}`, and 2 `prose` boxes (§7) |
| inline `style={{…}}` | **127** | on Tamagui-backed targets. A further **78** are on passthrough/lucide/`.native.tsx`, where `style` is CORRECT |
| `@apply` directives | **87** | 12 files · ~140 distinct utilities · 9 files need `--tw-*` machinery |
| stylesheets | **14** | 180 rules — 11 component + `FieldTree.css` + the chat Tailwind entry + `animations.css`; 3 permanent |
| Tailwind entry points | **2** | `libs/css/src/theme.css`, `libs/ui/src/chat/app/styles.css` |
| Tamagui configs | **2** | `tamagui.config.ts` (native hex), `tamagui-web.config.ts` (var-backed) |
| compiler extraction | **off** | deliberate — `libs/utils/src/vite.mjs` |
| CSS bundle | **29.63 kB** | from 171 kB — `apps/web` build |
| P0 fixtures | **282** | 222 + 8 animation rows (§2) + 52 icon rows (§1) |
| `libs/ui` tests | **287** | +3 `app-sidebar` RENDER tests, impossible before §5b |
| `apps/web` typecheck | **321 errors** | from 487. The plan's "8" was never right — see §5b |

The work below is ordered so that **nothing is deleted before its replacement is proven**, and every
phase ends at a green `pnpm test:surface`.

---

## 0. How to re-measure

Do this first and after every phase. If a number here is stale, trust the command.

```bash
pnpm test:surface                      # P0 — 282 elements, light + dark. THE gate.
pnpm --filter @lmthing/ui test         # 287 unit tests
pnpm test libs/css                     # 50 — incl. the keyframe layer P0 cannot see (§2)
pnpm typecheck                         # workspace
pnpm --filter @lmthing/ui run typecheck:syntax
pnpm --filter @lmthing/ui run lint:tokens && pnpm --filter @lmthing/ui run lint:rn
cd apps/web && pnpm build && npx tsc --noEmit -p tsconfig.app.json   # 321 errors, NOT 8 — §5b

# the @apply expander (safe: --check writes nothing)
node libs/css/scripts/expand-apply.mjs --check $(grep -rl '@apply' --include=*.css libs/css/src apps/web/src)

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

## Phase 1 — the icon classNames ✅ DONE

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

### What was done

An **`icons` P0 fixture** first, as §"suggested sequencing" says to: five `tw:` / `prop:` pairs
rendered in the same capture, so each substitution is checked against the thing it replaces rather
than against a memory of what the utility meant. All five agree on **every one of the ~70 audited
properties**, in light *and* dark:

| was | is | why |
|---|---|---|
| `className="size-4"` / `"h-4 w-4"` | `size={16}` | both compute to 16px; `size` sets the `<svg>` geometry attributes |
| `className="shrink-0"` | `style={{ flexShrink: 0 }}` | lucide is not Tamagui-backed — it takes `style`, not style props |
| `className="opacity-60"` | `style={{ opacity: 0.6 }}` | |
| `className="mt-0.5"` | `style={{ marginTop: '0.125rem' }}` | Tailwind's 0.5 step = 0.125rem = 2px |
| `className="text-agent"` | `style={{ color: 'var(--agent)' }}` | lucide paths are `stroke="currentColor"` |

Converted: `nav/sidebar-footer` (2), `components/auth/github-deployment-status` (6),
`components/auth/github-stars` (1), `chat/components/ConsentCard`,
`studio/presentation/Slide2Problem`.

**`style`, not props — and this is the trap, not a preference.** `Prim.Svg` is built by
`svgPrimitive`, which applies props *verbatim* to a raw `<svg>`. It therefore **ignores Tamagui style
props entirely**: converting a className on one to props deletes the styling with no error. The
`icons` fixture pins both passthrough cases so this cannot regress silently.

### The `shrink-0` that was not an icon

Three studio surfaces passed `className="shrink-0"` to `StudioAppSidebar` — not an icon, and it
would have died with Tailwind. It is now a declared `flexShrink?: number` prop threaded
`StudioAppSidebar` → `AppSidebar` → the shell `Prim.Box`, left `undefined` by default so **chat's
sidebar keeps exactly its current value**. Baking `flexShrink: 0` into the shared `SIDEBAR_SHELL`
would have been smaller but would have silently changed chat, and `app-sidebar` is precisely the
component P0 cannot render (SPIKE C, §5b) — so an unverifiable change there is the one to avoid.

**Gate met:** P0 **282 elements, zero delta**. Note what this does and does not prove: the fixture
proves the *substitutions* are equivalent; the call sites themselves are not all rendered by P0
(`sidebar-footer` and `ConsentCard` are not fixtures), so their conversion rests on that equivalence
plus `typecheck:syntax` + `lint:rn` + the 284 unit tests.

### Still Tailwind, and now clearly separable

The remaining classNames split three ways, and only the third is phase-3/4 work:

- **keyframe classes** — `lm-*`, and `animate-spin`/`animate-pulse`. **No longer Tailwind at all**
  after phase 2: they resolve from the hand-written `@lmthing/css/animations.css`. They satisfy the
  definition of done as they stand.
- **BEM component classNames** — `ide-file-tree__*`, `prompt-preview__code`, `workflow-list-item__*`,
  `property-row__*`, `user-detail__*`, `space-list__*`, `topic-editor__*`,
  `lm-setup-guide__summary`, `badge*`, `lm-markdown`. Not Tailwind utilities either. What is Tailwind
  is the **`@apply` inside the stylesheets they name** — so phase 4 rewrites those 11 stylesheets and
  leaves every one of these classNames alone. This is what makes phase 4 tractable.
- **real Tailwind utilities on Tamagui-backed components** — ~20 files, mostly *conditional*
  (`cn(a ? 'x' : 'y')`) and variant maps, which is why the codemod skipped all 42. → phase 3.

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

## Phase 3 — className→props ✅ DONE · inline-`style` tail ◐ PARTIAL

### The className axis is closed

**Zero real Tailwind utility classNames remain** on any surface component. The only `className=`
values left in `libs/ui/src` + `apps/web/src` are:

- keyframe classes — `lm-*`, `animate-spin`, `animate-pulse` — which resolve from the hand-written
  `@lmthing/css/animations.css` and are **not Tailwind** (phase 2);
- BEM component classNames (`ide-file-tree__*`, `workflow-list-item__*`, …), whose *stylesheets* are
  phase 4's problem, not the classNames;
- `{className}` pass-through props;
- **`prose` / `prose-sm` / `prose-*:` on two injected-HTML boxes** — the one genuine remainder, and
  §7 already assigns it to phase 4 (hand-written equivalents in `markdown/index.css`).

The conversions, all as `$`-token prop bags rather than strings:

| where | was |
|---|---|
| `chat/components/ui/Button` | the `variants` + `sizes` class maps → `VARIANT` / `SIZE` bags |
| `chat/components/ui/Toast` | the `vc` variant map → `TOAST_VARIANT`; `/40` alphas → `color-mix` |
| `chat/components/ui/Tabs`, `Input`, `Tooltip`, `Drawer`, `Dialog` | conditionals and inset/border utilities |
| `chat/app/Sidebar`, `ChatView`, `Composer`, `Message` | active/idle and enabled/disabled conditionals |
| `chat/app/AppShell` | `h-full`/`w-full`/`flex-1 min-h-0` → declared layout props on `Sidebar`/`DevPanel`/`ChatView` |
| `chat/app/inspector`, `WorkBlock` | `space-y-*` → `display:flex; flexDirection:column; gap` |

**`borderWidth: 0` is now explicit on every non-`outline` Button variant.** Under Tailwind it came
from PREFLIGHT (`*, ::before, ::after { border-width: 0 }`); leaving it implicit would have made the
buttons depend on a reset phase 4 removes, and surfaced a UA border app-wide.

### A bug this turned up

`ActivityStrip` passed `STATUS_COLOR[node.status]` to **`className`** — but `STATUS_COLOR` is a
`Record<string, Record<string, string>>`, i.e. already a prop bag. React stringified it, so every
activity chip has been rendering `class="[object Object]"` with **no status colour at all**. Now
spread. This is the failure mode the migration keeps producing: a value in the right shape wired to
the wrong channel, silent because CSS never errors.

### What is NOT closed: the inline-`style` tail

Measured, split by whether `style` is the *correct* destination:

| | count | verdict |
|---|---|---|
| `style` on passthrough primitives / lucide / `.native.tsx` | **78** | **correct, permanent** — these ignore style props (§6), and RN styles *are* `style` |
| `style` on Tamagui-backed targets | **127** | the remaining work |

Of those 127, the codemod reports **40**; the rest are `style={styles.foo}` **references** to
module-level `const styles = {…}` bags (`ReplChatView` alone has 20, plus `AgentChatPanel`,
`Message`, `common`, `waking-screen`). The codemod only lifts inline object *literals*, so it cannot
see them — closing this means converting those modules from `React.CSSProperties` to Tamagui prop
bags (`padding: '4px 12px'` → `paddingVertical/Horizontal`, `borderBottom: '1px solid …'` → the three
`borderBottom*` props, `flex: 1` → the grow/shrink/basis triple).

This axis does **not** block phase 4 — inline styles do not depend on Tailwind existing.

### Reference: the original plan for this phase

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

## Phase 4 — delete Tailwind ◐ SCOPED, NOT EXECUTED

**Entry condition met.** Phases 1–3 left **zero** Tailwind utility classNames (§3), well under the
"fewer than ~15" bar. Nothing now blocks this phase; what follows is the measured shape of it, plus
one decision that has to be made deliberately rather than discovered halfway through a deletion.

### Scope boundary found first: `libs/cli` keeps Tailwind, permanently

`libs/cli/src/app/build/pages.ts` runs the **Tailwind v4 compiler** (`@tailwindcss/node` +
`@tailwindcss/oxide`) over agent-authored **project app pages**. That is a shipped PRODUCT feature —
apps a user's agent writes are allowed to use Tailwind — and it has nothing to do with this
migration. Phase 4 deletes Tailwind from the **design system and the web surfaces**
(`libs/css`, `libs/ui`, `apps/web`) and must leave `libs/cli` alone. Its dependency is also useful:
it is where the tooling below resolves the compiler from.

### The `@apply` problem, measured — and why the plan's suggestion was wrong

The plan proposed "a small second emitter over `classnames-to-props-map.mjs`". That map is the wrong
source twice over: it emits Tamagui **props**, not declarations, and it only knows the utilities the
codemod met on JSX. The stylesheets use **~140 distinct utilities** across **87 `@apply` directives in
12 files**, including arbitrary values (`rounded-[9px]`, `tracking-[0.16em]`, `min-w-[160px]`), alpha
shorthands (`bg-brand-3/10`, `shadow-brand-3/25`), gradients, `ring-*`, `rotate-*`, `-translate-*`.
Hand-translating those is ~140 chances to be silently wrong, because CSS never errors.

So **`libs/css/scripts/expand-apply.mjs`** asks Tailwind itself — the same compiler the app build
uses — and splices its output back. Correct by construction. `--check` is safe; it runs clean over all
12 files today.

**But literal expansion is not sufficient, and this is the finding that shapes the phase.** Compiling
`@apply` in place reveals that most utilities do not expand to plain declarations — they expand to
declarations *referencing Tailwind's `--tw-*` custom properties*, which Tailwind declares separately
in an `@layer properties` / `@property` preamble:

```
@apply shadow-brand-3/25   →  --tw-shadow-color: …color-mix(… var(--tw-shadow-alpha) …)
@apply ring-2              →  --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 …
@apply bg-gradient-to-r    →  background-image: linear-gradient(var(--tw-gradient-stops))
@apply transition-all      →  transition-timing-function: var(--tw-ease, …)
@apply space-y-2           →  :where(& > :not(:last-child)) { --tw-space-y-reverse: 0; … }
```

Measured per stylesheet: **9 of 12 need `--tw-*` machinery; 8 emit their own `@property` block.**
Delete Tailwind and every one of those `var(--tw-…)` references resolves to nothing — shadows,
rings and gradients vanish, and P0 would catch only the ones it renders.

### The decision phase 4 has to make

| | approach | cost |
|---|---|---|
| **A** | compile each stylesheet in full, accept 8 duplicated `@property` preambles | fastest, exact, self-contained — but ships Tailwind's `--tw-*` indirection forever, into files that are **hand-maintained BEM** and would become machine-generated |
| **B** | as A, but hoist the shared `@property` block into one `libs/css/src/tw-vars.css` | less duplication, same indirection |
| **C** | hand-simplify only the ~20 utilities that need `--tw-*` (shadow/ring/gradient/transition/leading/tracking/font-weight) into direct declarations | readable, maintainable, genuinely Tailwind-free — most work, and each is a chance to be wrong, though P0 covers what it renders |

**Recommendation: C**, with A/B as a staging post if the phase has to land incrementally. These
stylesheets are hand-edited BEM; leaving them as compiler output trades one dependency for a worse
one. The `--tw-*` set needing hand treatment is ~20 utilities, not 140 — the expander handles the
rest, so C is far smaller than it first looks.

### The rest of phase 4, unchanged from the original plan

Still to do after the `@apply` question is settled, in this order (nothing deleted before its
replacement is proven):

1. **`prose-*`** — 2 injected-HTML boxes, hand-written equivalents in `markdown/index.css` (§7).
2. **preflight** — extract only the resets actually depended on into `libs/css/src/preflight.css`.
   Phase 3 already removed one such dependency deliberately: `borderWidth: 0` is now explicit on the
   chat Button variants, which used to lean on `*, ::before, ::after { border-width: 0 }`.
3. **`theme.css` rewrite** — `@theme` / `@theme inline` → plain `:root` custom properties, keeping
   every `--color-*` (SPIKE A1 resolves `$color` → `var(--color-<name>)`), via
   `generate-theme.mjs`, not by hand.
4. **`chat/app/styles.css`** — relocate what §2 found still living there (base `html/body/#root`,
   scrollbars, `:focus-visible`, the `--lm-*` bridge, safe-area), then delete the file and the
   `@lmthing/ui/chat/css` import.
5. **build wiring** — drop `@tailwindcss/vite` from `libs/utils/src/vite.mjs` and the P0 harness
   config, drop `@source`/`@layer`, remove the `tailwindcss` deps from `libs/css`/`apps/web`
   (**not** `libs/cli`).

**Gate:** a P0 delta is EXPECTED here and is the review artefact. Review it property by property. A
delta on `box-sizing`/`margin`/`border-width` means preflight was under-extracted; a delta on any
`color` means the `@theme` rewrite dropped a custom property; a delta on `box-shadow` means a
`--tw-*` reference was left dangling.

### Reference: the original notes for this phase

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
0.5 tw-animate-css   unused import               ✅ DONE
2. keyframes      out of the Tailwind entry      ✅ DONE
1. icons          lucide props + Prim.Svg style  ✅ DONE
3. classNames     zero Tailwind utilities left   ✅ DONE
   inline style   127 still on Tamagui targets   ◐ PARTIAL
5b. SPIKE C       one React 19, real renders     ✅ DONE (taken early — it
                                                   unblocks verifying the rest)
                        ↓
4. delete Tailwind      SCOPED, not executed — needs the §4 decision first
                        ↓
5a/5c one config + extraction               not started
```

**Next: the §4 `@apply` decision, then phase 4.** 5b was pulled forward out of order on purpose:
`libs/ui` could not be typechecked or render-tested at all, so every other phase was being verified
with one hand tied. It cost one dependency bump and returned 133 typecheck errors and three
previously-impossible render tests.

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
