/**
 * **The view-spec contract** — the single shared artifact every part of the
 * `system-viewbuilder` pipeline codes against.
 *
 * A page in a viewbuilder app is not TSX: it is a **spec**, a plain object the model
 * emits as a TypeScript object literal, validated here at save time and rendered by the
 * shared `ViewRenderer` on BOTH targets (web bundle + the native mobile app). Data and
 * behaviour stay real code — tables, endpoints, automations, handlers — and are reached
 * by NAME, never by URL and never by fetch code.
 *
 * ## Two representations, one file — on purpose
 *
 * This module holds **both** halves of the contract so they cannot drift:
 *  - the **TypeScript types** the renderer, the writers and the tests program against;
 *  - the **JSON Schema** (ajv-compiled) that validates what the model actually produced.
 * Enum-shaped facts (section kinds, element kinds, formats, tones, icon names, page
 * archetypes) are declared ONCE as a `const` tuple, used to derive the TS union AND
 * spliced into the JSON Schema, so a new kind is a one-line change in one place.
 * `schema.test.ts` asserts the two halves agree; §3's `AssertNever` types make a drift
 * between a tuple and its union a `pnpm typecheck` failure.
 *
 * ## Non-negotiables (owner directives — `design/appbuilder-viewspec-plan.md` B1)
 *
 *  1. **No `custom` kind, no escape hatch.** The section union is capped at 8 kinds; the
 *     element catalogue is the ceiling. A surface that cannot be expressed is reported as
 *     such by the planner (and is what `system-appbuilder` remains for) — it is NEVER
 *     approximated with a wrong section or smuggled in as code.
 *  2. **Bindings are PATHS, never expressions.** `$.field`, `$props.x`, `$params.id`,
 *     `$data.<sectionId>.<path>`. The spec language is deliberately not Turing-complete:
 *     no conditionals, no arithmetic, no template interpolation, no eval. An expression
 *     attempt (`{{ a ? b : c }}`, `${x}`, `$.a + $.b`) is a **validation error**, not a
 *     silent runtime nothing — see {@link BINDING_PATTERN} / {@link VALUE_PATTERN} and
 *     {@link looksLikeExpression}, which is what lets the writer emit a menu-shaped
 *     rejection pointing at a built-in or at the endpoint layer. Where the corpus needed
 *     conditional behaviour the answer is a **named declarative policy**, never a
 *     predicate: {@link Toned.toneMap}, {@link Poll.whileField}, `merge: 'fill-empty'`.
 *  3. **Everything optional, with a renderer default.** The minimum valid section is
 *     `{ kind: 'list', query: 'X' }`; the minimum valid page is one such section. Layout,
 *     shell and item shape are PREDICTED by the renderer when absent — omissions are
 *     defaults, not gaps. **Loading, error and empty states are renderer defaults and are
 *     NOT authorable**: the audit found 26 hand-built skeleton/spinner/error components
 *     and three of its five mapping passes wrongly proposed a `skeleton` element. There is
 *     no way to author one here, deliberately. (`empty` is an OVERRIDE of a default that
 *     always exists — not the authoring of a state.)
 *  4. **A `create` section declares no fields.** Form fields derive from the endpoint's
 *     Input JSON Schema (`EndpointContract.inputSchema`). There is no `fields` property to
 *     fill in, and `additionalProperties: false` makes writing one an error that names its
 *     instance path.
 *  5. **No pagination.** The audit measured demand across 153 components and 84 pages at
 *     exactly zero. `limit` is the whole story; do not add `page`/`cursor`/`hasMore`.
 *
 * ## Wave-2 amendments — the four things T1 could not say
 *
 * The T1 hand-migration of a real app is the first time the pinned vocabulary met a shipped
 * page. Four gaps came back, one of them blocking (the ratchet promotes a blocker on FIRST
 * occurrence — with no escape hatch, promotion is the only relief valve). Three are
 * WIDENINGS of an existing shape rather than new tokens, which is the right ratio: every
 * token is one a weak model must learn.
 *
 *  1. **{@link Arg} — literal arguments** (blocking). Argument maps were paths only, so
 *     `{ meal: 'dinner' }` was illegal and blog's three TL;DR / ELI5 / Why-me buttons — one
 *     endpoint, three constants — were inexpressible. A string argument is still judged by
 *     {@link VALUE_PATTERN}, so a literal stays distinguishable from a binding and there is
 *     no second convention.
 *  2. **{@link AGENT_NAME_PATTERN} — real agent slugs.** `chat.agent` was an identifier, so
 *     `pantry-keeper` was rejected — i.e. the pattern rejected the only naming style this
 *     codebase uses, and T1 dropped a chat dock rather than misname an agent.
 *  3. **{@link NavGroup.routes} may be parameterised.** A destination and a highlight family
 *     are two roles; only the first must be static.
 *  4. **`suffix` on any flat value** ({@link FlatValue}) — `"20 min"`, not `"20"`, without
 *     a `metaSuffix`/`captionSuffix` key family.
 *
 * ## Normative renderer semantics (T0 S1–S6 — pages break silently without these)
 *
 * The schema states these because they are the contract, not the renderer's private
 * business. Wave 1's UI-RENDERER implements them; `validate.ts` and the space prompts
 * rely on them.
 *
 *  - **S1 — a null binding omits its element.** A bound element whose binding resolves to
 *    null/undefined/empty renders NOTHING (and its label/wrapper with it). This is what
 *    replaces the ~15 hand-written `{x ? … : null}` guards T0 found across 10 pages, and
 *    it is how the no-conditionals rule stays honest. Without it every spec page fills
 *    with empty chrome; it is also what makes `empty` coherent.
 *  - **S2 — `prefill` with no `from` seeds the form on mount** from the endpoint's Output
 *    by matching field names. 5/5 catalogue apps have a settings page shaped exactly like
 *    this. A prefill whose `input` binds `$form.*` cannot run on mount (the form is still
 *    empty), so the renderer offers it as an explicit action instead — derived, not
 *    declared.
 *  - **S3 — the binding namespace is exactly {@link BINDING_PATTERN}'s**: `$`, `$.`,
 *    `$props.`, `$data.<sectionId>.`, `$route.<param>`, `$result.<field>`, `$form.<field>`,
 *    `$client.timezone`. Nothing else is a root.
 *  - **S4 — a facet maps to a QUERY INPUT, not a client filter**, and must work over an
 *    array-valued field (`tags: string[]`). Client-side faceting is simply wrong once
 *    `limit` exists.
 *  - **S5 — toggle mutations belong at the endpoint layer.** The spec language has no `!`,
 *    so `save`/`pin`/`dismiss`/`read` MUST be endpoints that flip the value server-side
 *    when the field is omitted. This is also an instruction the viewbuilder's
 *    endpoint-planning node carries — without it every toggle in every generated app is
 *    broken.
 *  - **S6 — view-time side effects belong in the read endpoint** (`markRead` becomes part
 *    of `getArticle`). There is no on-mount effect concept, and none is needed.
 *
 * ## Layout prediction — what the archetypes may and may not do
 *
 *  - **An archetype NEVER reorders sections.** Section order is authored (it is the array
 *    order). A "dashboard ⇒ stats strip on top" heuristic would bury `kitchen/index`'s hero
 *    card, the one thing that page exists to show. Archetypes govern container width, grid
 *    columns and responsive collapse ONLY.
 *  - `create + list on the same entity` ⇒ **list page with the create as a collapsible
 *    header form**. T0's commonest uncovered shape (5 of 10 pages); `kitchen/recipes`
 *    hand-builds exactly it.
 *  - **`stack` is the explicit fallback** — a plain constrained vertical stack. It turns
 *    T0's three fall-throughs into three hits at zero cost.
 *  - `master-detail` was exercised by **zero** of T0's 10 pages. It stays in the union, but
 *    the renderer should not sink v1 time into split-pane logic on its account.
 *
 * ## Scope of this file
 *
 * SHAPE ONLY. {@link validateViewSpecShape} answers "is this a well-formed spec?" — it
 * does not know the project. Name resolution (`query`/`mutation`/`agent`/`use` exist),
 * binding cross-checks against `ProjectContracts` (`$.field` is a real Output field),
 * component prop typing, and the app-wide checks live in `validate.ts` (Wave 1,
 * CLI-ENGINE), which imports these types and calls these validators first.
 *
 * @see `sdk/org/libs/cli/src/app/build/contracts.ts` — `ProjectContracts`, the endpoint
 *   vocabulary (`name`, `method`, `routePath`, `inputSchema`, `outputSchema`) every
 *   `query`/`mutation` name in a spec resolves against.
 * @see `sdk/org/libs/ui/src/chat/components/render-descriptor.tsx` — the already
 *   native-tested 42-type descriptor renderer this element catalogue is a curated,
 *   data-bound subset of. Prop names are kept identical where an element already exists
 *   there; the divergences are called out inline.
 * @see `design/viewspec-element-audit.md` — the Wave-0 completeness audit (153 components
 *   across 5 shipped apps) whose findings this schema implements. Every cut, every added
 *   prop and all four section-contract changes are cited to it below.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

/** A JSON-Schema-shaped object. Same loose alias the api build pipeline uses. */
export type JsonSchema = Record<string, unknown>;

// ──────────────────────────────────────────────────────────────────────────────
// 1. The closed vocabularies
//
// Everything a weak model must CHOOSE from rather than invent lives here as a `const`
// tuple. Each is the single source for both the TS union and the JSON Schema enum.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * **THE SECTION UNION — one of the two places the vocabulary is capped.**
 * (The other is {@link ELEMENT_KINDS}.) v1 is capped at 8 kinds, and **all 8 are now
 * pinned**: the 8th slot was decided by the T0 desk check
 * (`design/viewspec-T0-deskcheck.md` §3) in favour of `timeline`.
 *
 * `timeline` earned it on two pages that DEMAND it — `trips/[tripId]/timeline` (a
 * date-grouped, time-ordered stream; nothing else preserves the day grouping) and
 * `kitchen/index`'s `WeekGrid`, which without grouping degrades to an undifferentiated
 * meal list — plus three more that want it, and `render-descriptor.tsx:179-182` already
 * has a native-tested `timeline` case. Rejected alternatives, recorded so they are not
 * relitigated: `board` (one occurrence, and its value was drag-to-move, an excluded
 * interaction), `compare` (the blocker there is multi-select client state, not the
 * section kind) and `map` (already an element's job).
 *
 * **The union is FULL.** A ninth kind is a plan change decided by the improvement-loop
 * ratchet (bucket 1), not a patch.
 */
export const SECTION_KINDS = [
  'list',
  'detail',
  'create',
  'stats',
  'markdown',
  'chat',
  'toolbar',
  'timeline',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The v1 cap. A ninth kind is a plan change, not a patch. */
export const MAX_SECTION_KINDS = 8;

/**
 * **THE ELEMENT UNION — the other capped vocabulary.**
 *
 * 24 elements. Derivation from the plan's B1 table (which lists 28 despite saying "~26"),
 * as arbitrated from `design/viewspec-element-audit.md` §5.2 and §5.1:
 *  - **CUT 5** for measured zero-to-one demand across 153 components — `chip` (0 distinct
 *    from `badge`; `render-descriptor.tsx:150` already collapses badge/tag/pill into one
 *    case, so `badge.shape` pays for it), `avatar` (0), `code` (0 standalone — every
 *    `<pre>` in the corpus is inside a `MarkdownBody`), `quote` (1), `map` (2, and
 *    `homes/StaticMap` is an `<img>` whose Mercator math belongs in the endpoint Output).
 *  - **ADD 1** — `field`, the inline-editable control. Demand 12 across 5/5 apps, and the
 *    audit's one genuinely INEXPRESSIBLE finding: `button {mutate}` carries no argument,
 *    so without this a spec app renders every catalogue page and lets a user change
 *    nothing about a row.
 * The catalogue gets smaller and strictly more capable — the right direction for a
 * DeepSeek-class model, since every token is one it must learn.
 *
 * To add an element: append it here and add its `element(...)` line to `ELEMENT_DEFS`
 * in §5 plus its `interface …El` in §3. The compile-time coverage assertion at the end
 * of §3 fails until the TS union matches this list.
 */
export const ELEMENT_KINDS = [
  // layout
  'row',
  'col',
  'grid',
  'spacer',
  'divider',
  'surface',
  // typography
  'heading',
  'text',
  'caption',
  'markdown',
  // data display
  'badge',
  'statcard',
  'meter',
  'keyvalue',
  'table',
  'timeline',
  'rating',
  // media
  'image',
  'icon',
  // feedback
  'banner',
  'empty',
  // interactive
  'button',
  'link',
  'field',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/**
 * Value formatting is a MODIFIER, not an element — it rides on any bound value
 * (`{ el: 'text', text: '$.total', format: 'currency' }`), absorbing the per-app
 * `format.ts` all five catalogue apps hand-write.
 *
 * Widened per audit A7 (`datetime`/`time`/`percent`/`humanize`); pair `currency` with
 * {@link Formatted.currencyField} in the two multi-currency apps.
 */
export const FORMATS = [
  'currency',
  'date',
  'datetime',
  'time',
  'relative-time',
  'number',
  'percent',
  'humanize',
] as const;
export type Format = (typeof FORMATS)[number];

/**
 * Semantic tone. NEVER a colour — the renderer maps each to a design token, which is why
 * a spec cannot violate the design system. `auto` asks the renderer to derive the tone
 * from the bound value.
 *
 * Divergence from `render-descriptor`, deliberate: that renderer takes a free-string
 * `color` (and `variant` on banners). A free string is exactly what a weak model gets
 * wrong and what a menu prevents, so the spec has one finite `tone` everywhere.
 */
export const TONES = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'auto'] as const;
export type Tone = (typeof TONES)[number];

/**
 * The named icon set. Finite BY DESIGN: a spec names an icon, the renderer owns the
 * drawing (as SVG primitives — lucide is web-only, so a native fork cannot use it).
 *
 * Sized from the audit: the 5 apps hand-wrote 1,020 LOC of inline SVG for **67** distinct
 * glyphs, and `blog/components/icons.tsx` independently invented this exact model with a
 * **24-name** union — 24–67 is the empirical band. This list sits at 32: every name here is a
 * glyph the renderer must hand-draw, so the count is a real cost, not a vocabulary preference.
 *
 * The tuple below is the contract — count from it, not from this sentence.
 */
export const ICON_NAMES = [
  // navigation + control
  'home',
  'search',
  'plus',
  'edit',
  'trash',
  'check',
  'close',
  'chevron-right',
  'chevron-down',
  'arrow-left',
  'filter',
  'more',
  'refresh',
  // time + entities
  'calendar',
  'clock',
  'user',
  'users',
  'tag',
  'file',
  'map-pin',
  // status + feedback
  'alert',
  'info',
  'star',
  'bell',
  // data + transport
  'chart',
  'list',
  'link',
  'external-link',
  'download',
  'upload',
  'mail',
  'settings',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** How a `list` section presents its rows. Absent ⇒ the renderer picks per target. */
export const LIST_LAYOUTS = ['cards', 'rows', 'table', 'grid'] as const;
export type ListLayout = (typeof LIST_LAYOUTS)[number];

/**
 * Page archetypes. **A page's `layout` is normally ABSENT** — the renderer predicts the
 * archetype from the section composition:
 *  - `stats + several lists` ⇒ `dashboard`
 *  - a single list (+ toolbar) ⇒ `list`
 *  - `create + list on the same entity` ⇒ `list`, create as a collapsible header form
 *  - `detail + related lists` ⇒ `detail`
 *  - `list + detail on the same data` ⇒ `master-detail` (**unexercised** by T0's 10 pages)
 *  - create-only ⇒ `form`
 *  - anything else ⇒ **`stack`**, the explicit fallback.
 *
 * Archetypes govern width / grid / responsive collapse ONLY — never section order (see
 * the file header). How often the model has to set `layout` explicitly is the plan's
 * **layout-override rate** ratchet metric — low means the predictions work.
 */
export const PAGE_ARCHETYPES = ['dashboard', 'list', 'detail', 'master-detail', 'form', 'stack'] as const;
export type PageArchetype = (typeof PAGE_ARCHETYPES)[number];

/** Where the shell's navigation sits. `auto` (the default) is target-predicted. */
export const SHELL_PLACEMENTS = ['auto', 'tabs', 'sidebar', 'topbar'] as const;
export type ShellPlacement = (typeof SHELL_PLACEMENTS)[number];

/**
 * The shell is derived from the route list ONLY up to this many top-level static routes.
 *
 * T0 measured **0/5 catalogue apps reproducing** from a flat route list: 4 of 5 hand-group
 * 13–21 routes into 4–6 destinations, and a flat mapping produces an unusable 13–21-item
 * bottom bar on a phone. Above this threshold the model must declare
 * {@link ShellSpec.groups} — a small, finite, validatable object — rather than the
 * renderer mispredicting. (Deriving anyway would put the shell's layout-override rate at
 * ~80%, which by the plan's own metric means the prediction is wrong, not the model
 * over-specifying.)
 */
export const SHELL_DERIVE_MAX_ROUTES = 5;

/** The interactive control kinds of the `field` element (audit A2). */
export const FIELD_KINDS = ['toggle', 'rating', 'select', 'stepper', 'text'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

// ──────────────────────────────────────────────────────────────────────────────
// 2. Bindings — paths, never expressions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * One path segment: a JS-ish identifier with an optional numeric index (`items[0]`).
 * Note what it CANNOT contain — `(`, `?`, `+`, spaces, `-` — which is what turns every
 * expression attempt into a validation failure rather than a runtime `undefined`.
 */
const SEGMENT = '[A-Za-z_][A-Za-z0-9_]*(?:\\[[0-9]+\\])?';
const PATH = `(?:\\.${SEGMENT})+`;

/**
 * **The complete binding namespace (T0 S3). These roots and no others.**
 *
 *  - `$`            — the current scope's whole value (a list item, a detail record);
 *  - `$.field`      — a field of it (`$.recipe.title`, `$.tags[0]`);
 *  - `$props.x`     — a component's declared prop (only inside a component def);
 *  - `$route.id`    — a route parameter (`pages/recipes/[id]` ⇒ `$route.id`);
 *  - `$data.<sectionId>.<path>` — another section's result, which is how a **dependent
 *    query** is expressed (`input: { id: '$data.currentPlan.plan.id' }`). The renderer
 *    resolves the query DAG; an unresolved binding means the dependent section is
 *    disabled, replacing hand-coded `enabled:` flags;
 *  - `$result.<field>` — the Output of the mutation that just succeeded. Valid only under
 *    an `onSuccess`, and the reason a post-create redirect needs no route templating:
 *    `onSuccess: { navigate: 'searches/[searchId]/inbox', params: { searchId: '$result.id' } }`;
 *  - `$form.<field>`   — the current form's values. Valid only under `create.prefill.input`,
 *    where it lets an extract-from-a-blob endpoint see what the user has typed so far;
 *  - `$client.timezone` — the ONLY `$client` path. The client's IANA zone, passed as an
 *    endpoint param so a date-dependent selection ("tonight's meal") is computed
 *    server-side. Deliberately a menu of one: no `$client.locale`, no `$client.now`.
 *
 * There is deliberately no root for interaction state. The two places a value exists that
 * is not on a path — a `field`'s new control value and a list's multi-selection — are
 * named by an `arg` key on the mutation instead ({@link FieldEl.arg},
 * {@link MutateAction.arg}), because a `$value`/`$selection` root would have made every
 * binding site look like it might carry hidden client state. (This is also exactly why
 * `homes/compare` is out of scope: its query input is user-derived selection state.)
 */
export const BINDING_PATTERN = `^\\$$|^\\$client\\.timezone$|^\\$(?:props|route|data|result|form)?${PATH}$`;

/** Compiled twin of {@link BINDING_PATTERN}. */
export const BINDING_RE = new RegExp(BINDING_PATTERN);

/**
 * A **value**: either a literal string or a binding. This is what most element props
 * take (`{ el: 'text', text: 'Total' }` and `{ el: 'text', text: '$.total' }` are both
 * legal), so the pattern has two branches:
 *  - anything starting with `$` **must** be a valid binding — which is what rejects
 *    `${x}`, `$.a + $.b`, `$.status === 'x' ? 'a' : 'b'`, `$.items.map(i => i.name)`;
 *  - anything else is a literal, EXCEPT that `{{ … }}`, `${ … }`, or an **embedded binding
 *    root** anywhere in it are rejected as template-interpolation attempts
 *    (`'Total {{ count }}'`, `'/trips/$result.id/expenses'`). A literal dollar sign is
 *    fine (`'Cost: $5'`, `'Save $.50'`) — the embedded-root guard only fires on `$` plus a
 *    known root plus a dotted identifier, which no price ever is.
 */
export const VALUE_PATTERN =
  `^(?:\\$(?:props|route|data|result|form)?${PATH}|\\$client\\.timezone|\\$|` +
  `(?!\\$)(?![\\s\\S]*\\{\\{)(?![\\s\\S]*\\$\\{)` +
  `(?![\\s\\S]*\\$(?:props|route|data|result|form|client)?\\.[A-Za-z_])[\\s\\S]*)$`;

/** Compiled twin of {@link VALUE_PATTERN}. */
export const VALUE_RE = new RegExp(VALUE_PATTERN);

/**
 * A page route in the **authoring** form — the same grammar `writeProjectPage` takes and
 * `walkPages` discovers: no leading slash, no extension, `index` for a directory root,
 * `[param]` for a dynamic segment. `recipes/[id]`, not `/recipes/:id`.
 *
 * One route vocabulary is used everywhere in a spec — the page's own `route`, a shell nav
 * target, a `{ navigate }` action — so a nav target can be checked against the route list
 * with a string compare. (The renderer maps it to the router's `routePath` form exactly
 * as `pages.ts#routePathFor` does.)
 */
export const ROUTE_PATTERN = '^[a-z0-9][a-z0-9-]*(?:/(?:[a-z0-9-]+|\\[[a-z][A-Za-z0-9]*\\]))*$';

/** Compiled twin of {@link ROUTE_PATTERN}. */
export const ROUTE_RE = new RegExp(ROUTE_PATTERN);

/**
 * A route with **no dynamic segment** — the only kind that may be a nav destination.
 *
 * T0 finding: `/searches/[id]/compare`, `/feed/[articleId]`, `/documents/[docId]` are
 * drill-ins, not destinations, and a derived shell that lists them produces nonsense. A
 * parameterised route reaches the user through a `rowAction`, a `navigate`, or a
 * {@link SubnavSpec} — never through {@link ShellSpec.nav}.
 */
export const STATIC_ROUTE_PATTERN = '^[a-z0-9][a-z0-9-]*(?:/[a-z0-9-]+)*$';

/** Compiled twin of {@link STATIC_ROUTE_PATTERN}. */
export const STATIC_ROUTE_RE = new RegExp(STATIC_ROUTE_PATTERN);

/** An identifier: a section `id`, a component `name`, an endpoint `name`, a prop key. */
export const IDENT_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';
/** Compiled twin of {@link IDENT_PATTERN}. */
export const IDENT_RE = new RegExp(IDENT_PATTERN);

/**
 * **An agent slug** — `pantry-keeper`, `data-modeler`, `spec-builder`, `thing`.
 *
 * WAVE-2 AMENDMENT (T1, blocking). `chat.agent` was pinned to {@link IDENT_PATTERN}, which
 * rejects a hyphen — and **kebab-case is this codebase's own convention** for agent slugs
 * (every agent directory under a system space's `agents/` is one: `api-author`,
 * `data-modeler`, `spec-builder`). The pattern therefore rejected the only
 * naming style anyone uses, and the T1 migration had to DROP a chat dock outright — there
 * was no spec-side workaround, which is what makes it a bucket-1 blocker rather than an
 * inconvenience.
 *
 * Note what this pattern is and is not. It is a **syntax** check, and syntax was never the
 * valuable check here: the one worth running is *does this agent exist in this project's
 * space*, phrased as a menu of the real agents. That check needs the project, so it belongs
 * to `validate.ts` — this pattern's only remaining job is to keep a URL, a path or a
 * sentence out of the field.
 */
export const AGENT_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]*$';
/** Compiled twin of {@link AGENT_NAME_PATTERN}. */
export const AGENT_NAME_RE = new RegExp(AGENT_NAME_PATTERN);

/**
 * A component prop's declared type: a row type from `@app/types` (`Recipe`,
 * `Recipe[]`) or a scalar (`string`, `number`, `boolean`).
 */
export const TYPEREF_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*(?:\\[\\])?$';
/** Compiled twin of {@link TYPEREF_PATTERN}. */
export const TYPEREF_RE = new RegExp(TYPEREF_PATTERN);

/** True when `s` is a well-formed binding path. */
export function isBinding(s: string): boolean {
  return BINDING_RE.test(s);
}

/** True when `s` is a legal value (a literal, or a well-formed binding). */
export function isValue(s: string): boolean {
  return VALUE_RE.test(s);
}

/**
 * True when `s` is a recognisable **attempt at an expression** — the thing the spec
 * language deliberately does not have.
 *
 * This is the hook for the menu-shaped rejection: `validate.ts` uses it to tell
 * "you wrote an expression, the spec language has none — use a computed Output field on
 * the endpoint, a `toneMap`, or a `poll.whileField`" apart from "you mistyped a path".
 */
export function looksLikeExpression(s: string): boolean {
  if (s.includes('{{') || s.includes('${')) return true;
  if (!s.startsWith('$')) return false;
  return !isBinding(s);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. TypeScript types — elements, components, sections, pages, shell
// ──────────────────────────────────────────────────────────────────────────────

/** A binding path (`$.field`). Validated by {@link BINDING_PATTERN}. */
export type Binding = string;

/** A literal string OR a binding. Validated by {@link VALUE_PATTERN}. */
export type Value = string;

/**
 * **An ARGUMENT — a constant, or a binding.** The value type of every argument map in the
 * language (`input`, `mutate.input`, `navigate.params`, `link.params`, `prefill.input`,
 * `x-options.input`).
 *
 * WAVE-2 AMENDMENT (T1, blocking). These maps were `Record<string, Binding>` — paths only —
 * which made `{ meal: 'dinner' }` and `{ withinDays: 7 }` illegal. Calling one endpoint
 * with different constants is an ordinary shape, and it could not be said at all: T1's
 * kitchen migration had to push each constant into its endpoint's Input default (which only
 * worked because each endpoint took exactly one), and blog's three TL;DR / ELI5 / Why-me
 * buttons — **one endpoint, three different constants** — were inexpressible in the
 * vocabulary.
 *
 * Two things this deliberately is NOT:
 *  - **not a second string convention.** A string argument is a {@link Value}: it is a
 *    binding when it starts with a binding root and a literal otherwise, judged by the same
 *    {@link VALUE_PATTERN} every other authored string is judged by. `'dinner'` is a
 *    constant, `'$.id'` is a path, and `'/trips/$result.id'` is still an error.
 *  - **not an expression back-door.** A constant is a `string`, a `number` or a `boolean`
 *    and nothing else — no object, no array, no null. The language gains no operators, and
 *    the renderer still only ever walks a path or copies a constant.
 */
export type Arg = Value | number | boolean;

/** An authoring route (`recipes/[id]`). Validated by {@link ROUTE_PATTERN}. */
export type Route = string;

/** A component prop type (`Recipe`, `Recipe[]`, `string`). */
export type TypeRef = string;

/** Horizontal alignment / distribution — the descriptor renderer's own vocabulary. */
export type Justify = 'start' | 'center' | 'end' | 'between';
/** Cross-axis alignment — the descriptor renderer's own vocabulary. */
export type Align = 'start' | 'center' | 'end' | 'stretch';

/**
 * The formatting modifier, mixed into every element prop group that carries a bound
 * value. `currencyField` names the row field holding the ISO currency code — the two
 * multi-currency apps (`trips`, `homes`) need it and neither can express it with a
 * fixed symbol (audit A7).
 */
export interface Formatted {
  format?: Format;
  currencyField?: Binding;
}

/**
 * The tone modifier (audit A1 — demand ~32 across 5/5 apps, the single most demanded
 * amendment).
 *
 * `tone` alone is a literal token or `'auto'`. **`toneMap` is the load-bearing part**:
 * `tone: 'auto'` cannot know that `self_care` is good news and `emergency` is not, so the
 * model declares the mapping. It is a lookup table, NOT a predicate — which is how a
 * third of the corpus gets conditional colour without the language gaining conditionals.
 * `toneOf` names the value to key on when it is not the element's own bound value (a
 * `surface` tinted by `$.severity`).
 */
export interface Toned {
  tone?: Tone;
  toneMap?: Record<string, Tone>;
  toneOf?: Binding;
}

/**
 * **Poll-while-pending — the best-evidenced addition of Wave 0.** AUDIT's I4 (12 files)
 * and T0's ranked feature #1 (20 files across all 5 apps) are the same feature, found
 * independently from different evidence; this is the single implementation of both.
 *
 * A **named declarative policy**, not a predicate: refetch every `everyMs` for as long as
 * `while.field` holds one of `while.in`. Membership in a finite value set — the language
 * gains no comparison operators. Absent `while`, the section polls unconditionally.
 *
 * For a `list`/`timeline` section, `while.field` is evaluated **per row and matches if ANY
 * row matches** (`homes/inbox` polls while any capture is `pending`/`parsing`).
 *
 * This is the read side of what `create.async` covers on the write side. This app suite is
 * built on background agents; without it, 20 real surfaces look dead while an agent works.
 */
export interface Poll {
  everyMs: number;
  while?: { field: Binding; in: (string | number | boolean)[] };
}

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * Call a mutation endpoint by name.
 *
 * **This is the fix for audit I1** — the one finding that was outright inexpressible.
 * `input` binds the mutation's arguments from the current scope, so a row's "mark done"
 * button can carry that row's id (`input: { id: '$.id' }`) — and since the Wave-2
 * amendment each argument may equally be a CONSTANT ({@link Arg}), which is what lets one
 * endpoint back three buttons: `{ style: 'tldr' }`, `{ style: 'eli5' }`,
 * `{ style: 'why-me' }`. Arguments are paths or constants, so the no-expressions rule is
 * untouched.
 */
export interface MutateAction {
  mutate: string;
  input?: Record<string, Arg>;
  /**
   * Bulk commit (audit I5): send the enclosing list's current multi-selection. The
   * renderer supplies it under the Input key named by {@link MutateAction.arg}.
   * Only meaningful inside a `selectable` list's `bulkActions`.
   */
  over?: 'selection';
  /** Which Input property receives the renderer-supplied value (`over`'s selection). */
  arg?: string;
  /** Confirmation copy. Present ⇒ the renderer confirms before firing. */
  confirm?: string;
  /** Endpoint names whose cached results this mutation invalidates. */
  invalidates?: string[];
  /**
   * Where to go once it succeeds (T0 feature #3). Available on ANY mutation — a
   * `rowAction`, a `detail.actions` entry, a bulk action — because **the post-DELETE half
   * is the harder one**: deleting the record you are currently viewing has to send you
   * somewhere. The mutation's Output is reachable as `$result.*`, which is why this needs
   * no route templating:
   * `onSuccess: { navigate: 'searches/[searchId]/inbox', params: { searchId: '$result.id' } }`.
   */
  onSuccess?: Action;
}

/** What a button / row / toolbar entry DOES. Names only — no URLs, no handlers, no code. */
export type Action =
  | MutateAction
  /** Navigate to another page of the same app. */
  | { navigate: Route; params?: Record<string, Arg> }
  /**
   * Save an endpoint's Output to a file (T0 feature #5 — OPML export, `.ics` calendar,
   * markdown copy; 3 export user stories across 3 apps). Names an endpoint, never a URL
   * and never a Blob: the client download primitive is the renderer's, the bytes are the
   * endpoint's.
   */
  | { download: string; input?: Record<string, Arg>; filename?: Value }
  /** Print the current view (audit A11 — 7 print/export components across 4 apps). */
  | { print: true }
  /** Copy a bound value to the clipboard (audit A11 — 2 components). */
  | { copy: Value };

/**
 * A labelled action — a toolbar entry, a detail-header action, a list's bulk action.
 *
 * `reveals` (audit A3/I2, demand 11) is the element-level lift of the toolbar's
 * disclosure concept: show/hide sections by id. An item does something if it has an
 * `action`, a `reveals`, or both; one of the two is required.
 */
export interface ActionItem {
  label: Value;
  action?: Action;
  reveals?: string[];
  icon?: IconName;
  tone?: Tone;
  variant?: 'primary' | 'secondary' | 'ghost';
}

// ── elements ─────────────────────────────────────────────────────────────────
//
// Every element below is `{ el: '<kind>', …props }`. Prop names match
// `render-descriptor.tsx` wherever that renderer already has the element; the deliberate
// divergences are (a) `tone`/`toneMap` instead of free-string `color`/`variant` (see
// TONES + Toned), and (b) list-shaped props (`keyvalue.pairs`, `table.columns`,
// `timeline.items`) carry BINDINGS rather than pre-materialised data, because a spec is
// authored before the data exists.
//
// **Repeater convention** (stated once, used by `table`, `timeline` and the `list`
// section): an element with an `items`/`rows` BINDING to an array opens a new `$` scope
// for the value props evaluated per entry. Nothing else in the language creates scope.

/** Horizontal stack. */
export interface RowEl {
  el: 'row';
  children?: Slot[];
  gap?: number;
  justify?: Justify;
  align?: Align;
  wrap?: boolean;
  /**
   * Horizontal scrolling (audit A4). **Native correctness, not cosmetics**: Yoga has no
   * overflow scrolling, so without this a wide strip is silently clipped on a phone with
   * no gesture to reach the rest. 6 components + 13 files with `overflow-x-auto`.
   */
  scroll?: 'x';
}
/** Vertical stack (the descriptor renderer's `stack`). */
export interface ColEl {
  el: 'col';
  children?: Slot[];
  gap?: number;
  align?: Align;
}
/** Responsive grid (the descriptor renderer's `columns`). Columns collapse on a phone. */
export interface GridEl {
  el: 'grid';
  children?: Slot[];
  columns?: number;
  gap?: number;
  /** See {@link RowEl.scroll} — a week grid is unreachable on a phone without it. */
  scroll?: 'x';
}
/** Flexible gap that pushes its siblings apart. */
export interface SpacerEl {
  el: 'spacer';
}
/** Horizontal rule, optionally labelled. */
export interface DividerEl {
  el: 'divider';
  label?: Value;
}
/** A card-like container (the descriptor renderer's `card`/`panel`). */
export interface SurfaceEl extends Toned {
  el: 'surface';
  children?: Slot[];
  title?: Value;
  /** Present ⇒ tapping the surface fires the action (a tappable card). */
  action?: Action;
}

/** A heading. `level` defaults to the renderer's context-appropriate level. */
export interface HeadingEl {
  el: 'heading';
  text: Value;
  level?: 1 | 2 | 3 | 4;
}
/** Body text. */
export interface TextEl extends Formatted, Toned {
  el: 'text';
  text: Value;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  /**
   * Strike-through — a done shopping item, a packed bag, a superseded price. Three
   * occurrences in the audit's trees (`ShoppingRow`, `PackingRow`, `ListingCard`), which
   * clears the plan's own "one is bespoke, two is a pattern" bar; and a leaf prop is the
   * cheap kind to carry.
   */
  strike?: boolean;
  /** Clamp to N lines with an ellipsis (audit A8 — demand 12 across 5/5 apps). */
  maxLines?: number;
}
/** Small, quiet text (the descriptor renderer's `muted`). */
export interface CaptionEl extends Formatted, Toned {
  el: 'caption';
  text: Value;
  maxLines?: number;
}
/** Markdown, literal or bound. Absorbs the corpus's 5 hand-built `MarkdownBody` (1,435 LOC). */
export interface MarkdownEl {
  el: 'markdown';
  text: Value;
}

/**
 * A status pill. Absorbs `chip` (audit §5.2 — 0 demand distinct from `badge`;
 * `render-descriptor.tsx:150` already collapses badge/tag/pill into one case) via
 * `shape`, and the corpus's 9 near-identical `*Badge` components via `toneMap`.
 */
export interface BadgeEl extends Toned {
  el: 'badge';
  text: Value;
  shape?: 'badge' | 'pill' | 'tag';
  icon?: IconName;
}
/** A single metric tile. */
export interface StatcardEl extends Formatted, Toned {
  el: 'statcard';
  label: Value;
  value: Value;
  delta?: Value;
  icon?: IconName;
  action?: Action;
}
/**
 * A bar / ring / segmented indicator (the descriptor renderer's `progressbar`, which is
 * linear-only and has no tone). `variant` per audit A5; `tone`/`toneMap` per A1.
 */
export interface MeterEl extends Toned {
  el: 'meter';
  value: Value;
  max?: Value | number;
  label?: Value;
  variant?: 'bar' | 'ring' | 'segments';
}
/** A definition list. `layout: 'inline'` per audit A12 (`trips/BudgetStrip`). */
export interface KeyValueEl {
  el: 'keyvalue';
  pairs: ({ label: Value; value: Value } & Formatted)[];
  layout?: 'stacked' | 'inline';
}
/** A data table. `rows` binds the array; each column's `value` resolves in row scope. */
export interface TableEl {
  el: 'table';
  rows: Binding;
  columns: ({ label: Value; value: Value; align?: 'start' | 'center' | 'end' } & Formatted)[];
  /** See {@link RowEl.scroll} — a wide table is clipped on a phone without it. */
  scroll?: 'x';
}
/** A time-ordered list. `items` binds the array; the value props resolve in item scope. */
export interface TimelineEl extends Formatted {
  el: 'timeline';
  items: Binding;
  title: Value;
  time?: Value;
  detail?: Value;
  icon?: IconName;
}
/** A read-only star rating. The EDITABLE one is `field { kind: 'rating' }`. */
export interface RatingEl {
  el: 'rating';
  value: Value;
  max?: number;
}

/** An image. Also the home of static maps — the tile URL is an endpoint Output field. */
export interface ImageEl {
  el: 'image';
  src: Value;
  alt?: Value;
  fit?: 'contain' | 'cover';
  ratio?: 'square' | 'wide' | 'tall';
}
/** A named icon from {@link ICON_NAMES}. */
export interface IconEl {
  el: 'icon';
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  tone?: Tone;
}

/** An inline notice. */
export interface BannerEl extends Toned {
  el: 'banner';
  text: Value;
  title?: Value;
  icon?: IconName;
}
/**
 * An empty-state OVERRIDE. Every collection already has one by default — this exists to
 * say something better than the default, never to author a state that would otherwise be
 * missing. There is no `loading`/`error` counterpart, by design.
 *
 * `el` is optional here so that a section's `empty:` accepts the bare
 * `{ title: 'No expenses yet' }` form the desk check reached for eight times out of eight,
 * as well as the explicit element form. A plain sentence works too.
 */
export interface EmptyState {
  el?: 'empty';
  title?: Value;
  /**
   * The explanatory line under the title.
   *
   * Spelled `message`, not `text`, because the desk check reached for `message` **8 times
   * out of 8** unprompted. For a weak-model interface, measured evidence about what the
   * model actually writes beats internal consistency with `banner.text`. One spelling; no
   * alias.
   */
  message?: Value;
  icon?: IconName;
  action?: ActionItem;
}

/** {@link EmptyState} in its explicit element form, for use inside an element tree. */
export interface EmptyEl extends EmptyState {
  el: 'empty';
}

/**
 * A button. Does something via `action`, `reveals` (audit A3), or both — at least one is
 * required, since a button that does nothing is a defect a static gate should catch.
 */
export interface ButtonEl {
  el: 'button';
  label: Value;
  action?: Action;
  reveals?: string[];
  icon?: IconName;
  tone?: Tone;
  variant?: 'primary' | 'secondary' | 'ghost';
}
/**
 * A link — in-app (`to`, a route) or external (`href`).
 *
 * `external` per audit A10: `render-descriptor.tsx:105` HARDCODES `target=_blank`, which
 * is wrong for an in-app link and wrong on native; here it is opt-in. `href` also carries
 * `tel:`/`mailto:` schemes (`health/EmergencyContact`).
 */
export interface LinkEl {
  el: 'link';
  text: Value;
  to?: Route;
  params?: Record<string, Arg>;
  href?: Value;
  external?: boolean;
  icon?: IconName;
}

/**
 * **The inline-editable control — the one element added by the audit (A2/I1).**
 *
 * Demand 12 across 5/5 apps, and inexpressible before it: a shopping-list checkbox, a
 * star rating on a meal, a ± stepper on a topic weight, a bound select on a deal, a
 * reveal-then-submit note on a listing. `button {mutate}` could not carry the row's
 * argument, so a visuals-only audit would have pinned a schema that renders every page
 * beautifully and lets a user change nothing about a row.
 *
 * Deliberately NOT in `render-descriptor.tsx`, which renders form controls inert
 * ("there is nothing to submit it to") — this element is exactly the seam that gives them
 * something to submit to.
 *
 * `value` is the bound current state; on change the renderer calls `mutation` with
 * `input` (bindings from the row scope) plus the control's new value under the Input key
 * named by `arg` (default: the last segment of `value`'s path).
 */
export interface FieldEl {
  el: 'field';
  kind: FieldKind;
  /** The field being edited — the control's current state. */
  value: Binding;
  /** The mutation endpoint the change is submitted to. */
  mutation: string;
  /** Which Input property receives the new value. Defaults to `value`'s last segment. */
  arg?: string;
  /** The mutation's other arguments, bound from the row/section scope (`{ id: '$.id' }`). */
  input?: Record<string, Arg>;
  label?: Value;
  placeholder?: Value;
  /** `select` options: a literal list, or a binding to one. Enums also come from the Input schema. */
  options?: string[] | Binding;
  /** `rating`/`stepper` bounds. */
  min?: number;
  max?: number;
  step?: number;
  /** `text`: the submit affordance's copy. */
  submitLabel?: Value;
  invalidates?: string[];
}

/** Every `{ el: … }` node. Kept as one union so the catalogue has exactly one home. */
export type ElementNode =
  | RowEl
  | ColEl
  | GridEl
  | SpacerEl
  | DividerEl
  | SurfaceEl
  | HeadingEl
  | TextEl
  | CaptionEl
  | MarkdownEl
  | BadgeEl
  | StatcardEl
  | MeterEl
  | KeyValueEl
  | TableEl
  | TimelineEl
  | RatingEl
  | ImageEl
  | IconEl
  | BannerEl
  | EmptyEl
  | ButtonEl
  | LinkEl
  | FieldEl;

/**
 * A reference to a named view component — usable **anywhere an element node is**.
 * `props` values are data (literals or bindings); node-valued props (slots) are not in
 * v1.
 */
export interface ComponentRef {
  use: string;
  props?: Record<string, Value>;
}

/**
 * One slot in a {@link FlatItem} — **a binding/literal, or that same value with its
 * modifiers attached**.
 *
 * This union is what keeps the flat form flat. The obvious alternative — a paired
 * `meta`/`metaFormat`, `caption`/`captionFormat` key for every modifier — explodes
 * combinatorially (12 keys × 4 modifiers), gives the model two ways to say one thing, and
 * needs a new key for every future modifier. Here the simple case stays one string
 * (`title: '$.name'`), the modified case is one object (`meta: { value: '$.amount',
 * format: 'currency', currencyField: '$.currency' }`), and a new modifier is one property
 * on ONE definition.
 *
 * WAVE-2 AMENDMENT (T1): `suffix` is that promise being kept. `meta: '$.prepMinutes'`
 * rendered a bare **"20"** where the shipped page said **"20 min"**, and the unit had
 * nowhere to go — {@link FlatItem.suffix} attaches to `value` alone. The desk check had
 * assumed a `metaSuffix`; adding one (and then a `captionSuffix`, and a `noteSuffix`)
 * is precisely the key explosion the object form exists to prevent. So the modifier goes
 * where every other shared modifier already lives: `meta: { value: '$.prepMinutes',
 * suffix: 'min' }`, and every flat key gets units for free.
 *
 * It is a {@link Value}, so a bound unit works too (`suffix: '$.unit'`), and S1 applies to
 * it independently: an unresolved suffix appends nothing rather than printing "20 null".
 */
export type FlatValue =
  | Value
  | ({ value: Value; suffix?: Value; maxLines?: number } & Formatted & Toned);

/**
 * The **flat convenience form** for an item slot: no `el`, no `use`, just the things a
 * card or row shows. `item: { title: '$.name' }` is the shortest legal list item and is
 * what the model should reach for first.
 *
 * The key set is sized from T0's ten hand-written specs, not from taste: a flat form that
 * cannot express an ordinary row has failed at its only job, because the model then drops
 * to an element tree for every row — which is the verbosity this exists to prevent. It is
 * nonetheless **CLOSED**: an invented key is an `additionalProperties` error naming it,
 * against the finite menu of properties below.
 */
export interface FlatItem {
  title?: FlatValue;
  subtitle?: FlatValue;
  caption?: FlatValue;
  meta?: FlatValue;
  /** The row's headline figure — an amount, a score. Usually right-aligned. */
  value?: FlatValue;
  /** A unit or currency code shown against `value` (`'$.currency'`). */
  suffix?: FlatValue;
  /** A quieter secondary line — a warning note, an error, a blocked reason. */
  note?: FlatValue;
  /** A markdown body inside the row (a summary an agent wrote). */
  markdown?: FlatValue;
  badge?: FlatValue;
  /** A second, status-shaped badge (`$.status`), typically with `tone: 'auto'`. */
  status?: FlatValue;
  image?: FlatValue;
  icon?: IconName;
  /** A binding to a string array, rendered as one badge per entry (tags). */
  badges?: Binding;
  /** A compact definition list inside the row. */
  keyvalue?: ({ label: Value; value: Value } & Formatted)[];
  /** What tapping the row does. */
  action?: Action;
  /** Explicit per-row controls. */
  actions?: ActionItem[];
}

/** Anything that can fill a slot: an element tree, a component reference, or a flat item. */
export type Slot = ElementNode | ComponentRef | FlatItem;

/** A named, parameterised composition of elements — a spec fragment, never React. */
export interface ViewComponentSpec {
  /** PascalCase. The name a `{ use: … }` reference resolves against. */
  name: string;
  /** Declared props, typed against `@app/types` row types. Referenced as `$props.<key>`. */
  props?: Record<string, TypeRef>;
  /** The element tree. May reference elements and other components (acyclic). */
  node: Slot;
  description?: string;
}

// ── sections ─────────────────────────────────────────────────────────────────

/** Fields every section shares. */
export interface SectionBase {
  /** Stable id — the handle for `$data.<id>.…` and for a `reveals` target. */
  id?: string;
  /** Section heading. Optional; a renderer default is derived from the endpoint. */
  title?: Value;
}

/**
 * A facet filter the renderer builds itself — no client code, no expressions.
 * `counts` per audit I3 (`homes/FeedToolbar` shows a count beside every option).
 */
export interface Facet {
  field: Binding;
  label?: Value;
  options?: string[];
  counts?: boolean;
}

/** A sort option offered to the user (audit I3 — absent from the plan's section fields). */
export interface SortOption {
  label: Value;
  field: Binding;
  dir?: 'asc' | 'desc';
}

/**
 * **`from` — an embedded array as a section's source** (T0 feature #2, needed by 6 of 10
 * desk-checked pages and by every `include:[…]` endpoint in the catalogue:
 * `article.citations`, `medication.doses`/`.interactions`, `search.sources`,
 * `trip.destinations`/`.bookings`, `listExpenses.totalsByCategory`).
 *
 * Two forms:
 *  - `'$.citations'`         — a path into **this section's own** `query` Output;
 *  - `'$data.trip.days'`     — a path into **another section's** Output, in which case
 *                              `query` is omitted entirely and no request is made.
 *
 * This STRENGTHENS the view-shaped-endpoint rule rather than loosening it: the array is
 * already in an Output the app fetches, so `from` removes a round trip instead of adding
 * one — and the alternative is one extra endpoint per embedded array, inflating exactly
 * the api layer the plan wants left alone.
 */
export type From = Binding;

/**
 * A collection. Replaces ~38 catalogue pages' core.
 *
 * `query` names ONE endpoint whose Output must satisfy every binding in the section —
 * the **view-shaped-endpoint rule**. Cross-query joins and selection logic become
 * computed Output fields, not client glue.
 */
export interface ListSection extends SectionBase {
  kind: 'list';
  /**
   * Endpoint name (a GET). Required unless {@link ListSection.from} sources the rows from
   * another section's Output — `{ kind: 'list', query: 'X' }` remains the minimum section.
   */
  query?: string;
  /** Source the rows from an embedded array instead of the query's root. See {@link From}. */
  from?: From;
  /** Dependent-query arguments. An unresolved binding disables the section. */
  input?: Record<string, Arg>;
  /**
   * Which record, when the query takes one. Defaults to the route's single `[param]`, bound
   * under its own key — so `recipes/[id]` defaults to `$route.id`. (`$route` is the root;
   * `$params` was renamed and now hard-fails.)
   */
  param?: Binding;
  limit?: number;
  layout?: ListLayout;
  /** The per-row shape. Absent ⇒ the renderer derives it from the Output schema. */
  item?: Slot;
  /**
   * Faceted filtering. NORMATIVE (T0 S4): a facet maps to a **query input** — the endpoint
   * narrows the rows, so a facet is honest about `limit` instead of filtering a page that was
   * already truncated.
   */
  facet?: Facet[];
  /**
   * User-selectable orderings (audit I3). NORMATIVE: sorting is applied **client-side, over the
   * `limit`ed page**. Nothing measured demanded server-side ordering, and pushing it down would
   * mean an endpoint input for every sortable column.
   */
  sort?: SortOption[];
  /**
   * Free-text search. NORMATIVE: sent as a **query input** when the endpoint's Input schema
   * declares one of `search` / `q` / `query` / `term`; otherwise filtered client-side over
   * `search.fields`. Declaring the input is what makes search reach rows beyond `limit`, so an
   * endpoint that expects to be searched should declare it.
   */
  search?: boolean | { fields?: Binding[]; placeholder?: string };
  /** What tapping a row does. */
  rowAction?: Action;
  /** Row-level actions rendered on each row. */
  rowActions?: ActionItem[];
  /** Multi-select for a bulk commit (audit I5). */
  selectable?: boolean;
  /** Bulk actions over the selection. Their `mutate` carries `over: 'selection'`. */
  bulkActions?: ActionItem[];
  /** Refresh while a background job is producing rows (audit I4). */
  poll?: Poll;
  /** Override the default empty state — a sentence, or an element. */
  empty?: Value | EmptyState;
}

/** One record. Replaces ~20 catalogue pages' core. */
export interface DetailSection extends SectionBase {
  kind: 'detail';
  query: string;
  /** Which record. Defaults to the route's single `[param]` (`$params.id`). */
  param?: Binding;
  input?: Record<string, Arg>;
  /** The top of the record — a component ref, an element tree, or the flat form. */
  header?: Slot;
  /** The keyvalue body. */
  fields?: ({ label: Value; value: Value } & Formatted)[];
  /** Free-form body below the fields. */
  body?: Slot;
  actions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

/**
 * A form. Replaces the catalogue's 139 mutations' forms.
 *
 * **There is deliberately no `fields` property.** Fields are derived from the mutation
 * endpoint's Input JSON Schema (enums ⇒ selects, arrays of objects ⇒ repeating row
 * groups), exactly as `SettingsSchemaForm` does. `additionalProperties: false` turns an
 * attempt to declare fields into a validation error naming the instance path — this is
 * the property being structurally unable to go wrong. The audit confirms it: all 7
 * hand-built form components in the corpus are whole-page `create` sections, and not one
 * of the 5 apps has a file picker.
 */
export interface CreateSection extends SectionBase {
  kind: 'create';
  /** Mutation endpoint name (POST/PATCH/PUT/DELETE). */
  mutation: string;
  /** Values supplied by the page rather than the user (a parent id) — hidden from the form. */
  input?: Record<string, Arg>;
  submitLabel?: Value;
  /** Endpoint names whose cached results this mutation invalidates. */
  invalidates?: string[];
  /** The mutation runs in the background (an import): show a note, refetch after N ms. */
  async?: { note?: Value; refetchAfter?: number };
  /** Pre-populate from another endpoint. `merge: 'fill-empty'` is the only policy in v1. */
  prefill?: {
    endpoint: string;
    input?: Record<string, Arg>;
    /** Path into the prefill endpoint's Output to read the field map from. */
    from?: Binding;
    merge?: 'fill-empty';
  };
  onSuccess?: Action;
}

/** A metrics strip. Replaces 9 dashboards' strips. */
export interface StatsSection extends SectionBase {
  kind: 'stats';
  query: string;
  input?: Record<string, Arg>;
  cards: ({
    label: Value;
    value: Value;
    delta?: Value;
    icon?: IconName;
    meter?: boolean | { max?: Value | number; variant?: 'bar' | 'ring' | 'segments' };
    action?: Action;
  } & Formatted &
    Toned)[];
  poll?: Poll;
}

/** Prose. Literal (`source`) or bound to an endpoint field (`query` + `value`). */
export interface MarkdownSection extends SectionBase {
  kind: 'markdown';
  /** Literal markdown. Not a {@link Value} — markdown legitimately contains `${`. */
  source?: string;
  query?: string;
  input?: Record<string, Arg>;
  /** Which Output field holds the markdown. */
  value?: Binding;
  /** Refresh while an agent is still writing it (audit I4 — `blog/ArticleTakes`). */
  poll?: Poll;
}

/** An assistant dock — wraps the existing `<Chat>`. Replaces the catalogue's 4. */
export interface ChatSection extends SectionBase {
  kind: 'chat';
  /**
   * Agent slug within the project's space — `pantry-keeper`, `sous`, `data-modeler`.
   * Validated by {@link AGENT_NAME_PATTERN} (kebab-case is the codebase's convention);
   * whether the agent EXISTS is `validate.ts`'s check, against the real menu.
   */
  agent: string;
  /** Space name, when the agent is not in the project's own space. */
  space?: string;
  greeting?: Value;
  height?: 'sm' | 'md' | 'lg' | 'full';
}

/** A header of mode toggles and actions. Replaces the catalogue's mode-toggle headers. */
export interface ToolbarSection extends SectionBase {
  kind: 'toolbar';
  /** Section ids this toolbar shows/hides — the declarative replacement for `useState`. */
  reveals?: string[];
  actions?: ActionItem[];
}

/**
 * **The 8th kind** — a date-grouped, time-ordered stream. The group-aware sibling of
 * `list`, which is what earns it a KIND rather than an element: `group` is the part that
 * carries meaning, and absorbing it here is what keeps a `groupBy` from having to be added
 * to `list` separately.
 *
 * Prop names follow `render-descriptor.tsx:179-182`'s already native-tested `timeline`
 * case (`items: { title, time, detail }`) — `itemTime` is that `time`, `itemNote` that
 * `detail`.
 *
 * Semantics the renderer owns: an item with a null `itemTime` lands in the group's
 * untimed tray (`trips/DayTimeline` splits timed from "anytime" items); conflict and gap
 * annotations are computed Output fields bound through `itemNote`, never client logic.
 */
export interface TimelineSection extends SectionBase {
  kind: 'timeline';
  query?: string;
  /** Usually set — the stream is nearly always an embedded array. See {@link From}. */
  from?: From;
  input?: Record<string, Arg>;
  param?: Binding;
  /** The grouping key — a date-ish binding (`$.day`). Absent ⇒ one ungrouped stream. */
  group?: Binding;
  /** How to render the group heading. */
  groupFormat?: Format;
  limit?: number;
  /** The per-entry shape. Absent ⇒ derived from the Output schema. */
  item?: Slot;
  /** The entry's time label. Null ⇒ the entry is untimed. */
  itemTime?: Binding;
  itemEndTime?: Binding;
  /** A per-entry annotation (a conflict or gap note computed by the endpoint). */
  itemNote?: Binding;
  rowAction?: Action;
  rowActions?: ActionItem[];
  poll?: Poll;
  empty?: Value | EmptyState;
}

/** Every section. One union, one place. All 8 slots are pinned. */
export type SectionSpec =
  | ListSection
  | DetailSection
  | CreateSection
  | StatsSection
  | MarkdownSection
  | ChatSection
  | ToolbarSection
  | TimelineSection;

// ── page + shell ─────────────────────────────────────────────────────────────

/** One page. Everything but `route` and `sections` is optional. */
export interface ViewSpec {
  /** Authoring route (`index`, `recipes/[id]`). Persisted as `pages/<route>.view.json`. */
  route: Route;
  title?: string;
  /** Absent ⇒ the renderer PREDICTS the archetype from the section composition. */
  layout?: PageArchetype;
  sections: SectionSpec[];
}

/**
 * A live count on a nav destination — blog's unread Alerts, `homes`' AlertsBell,
 * `homes/inbox`'s pending captures.
 *
 * Declared as a DATA SOURCE (an endpoint name plus a path into its Output), not a free
 * binding: the shell has no section scope to bind against, and naming the endpoint keeps
 * the count resolvable at save time against `ProjectContracts` like everything else.
 *
 * Not cosmetic. These apps are built on background agents, and the badge IS the
 * "something needs you" signal they produce — every generated app losing it is a product
 * regression, not a missing flourish.
 */
export interface NavBadge {
  /** Endpoint name whose Output carries the count. */
  query: string;
  /** Path to the number (`$.unread`). */
  field: Binding;
}

/** One navigation destination. Always a STATIC route — see {@link STATIC_ROUTE_PATTERN}. */
export interface NavEntry {
  route: Route;
  label?: Value;
  icon?: IconName;
  badge?: NavBadge;
}

/**
 * A navigation GROUP — several routes behind one destination (T0 §5a finding 1).
 *
 * 4 of 5 catalogue apps hand-group 13–21 routes into 4–6 destinations, with one route as
 * the group's landing page and the rest reachable inside it. `home` is what the tab opens;
 * `routes` is the family it stays highlighted for (kitchen aliases `/shop`↔`/shopping`↔
 * `/trip/:planId` under one tab exactly this way).
 *
 * WAVE-2 AMENDMENT (T1): the two roles were conflated. **A destination must be static** —
 * `home` and {@link ShellSpec.nav} keep {@link STATIC_ROUTE_PATTERN}, because a tab that
 * opens `feed/[articleId]` opens nothing. **A highlight-family member may be
 * parameterised**, because a drill-in is exactly the page a tab should stay lit for:
 * kitchen's real `_layout.tsx` keeps the Shop tab highlighted on `trip/:planId`. Under the
 * static-only pattern such a page had no group, so `validateAppViews` called it an orphan
 * unless something happened to navigate to it — and T1 invented two toolbar buttons purely
 * to satisfy reachability, which is the tail wagging the dog.
 */
export interface NavGroup {
  label: Value;
  /** The tab's landing page. STATIC — a destination with a `[param]` opens nothing. */
  home: Route;
  /** The highlight family. Members MAY be parameterised — a drill-in belongs to its tab. */
  routes?: Route[];
  icon?: IconName;
  badge?: NavBadge;
}

/**
 * **Entity-scoped sub-navigation** — declared ONCE for a route family, never re-declared
 * per page.
 *
 * T0's largest un-designed area: `TripTabs` is 15 tabs in 3 groups under
 * `trips/[tripId]/*`, `homes` has `SearchTabs` under `searches/[searchId]/*`, and health
 * has a contextual pill bar. 3 of the 10 desk-checked pages render one, and without this a
 * spec app's per-entity pages **cannot reach each other at all**.
 *
 * `match` is the route PREFIX the family shares, including its parameter
 * (`trips/[tripId]`). Every page whose route starts with it gets the bar, and the current
 * route's parameter values carry into every item — so an item is written once as
 * `trips/[tripId]/expenses`, not once per trip and not once per page.
 */
export interface SubnavSpec {
  /** The parameterised route prefix this nav belongs to (`trips/[tripId]`). */
  match: Route;
  label?: Value;
  /** Flat form. */
  items?: NavEntry[];
  /** Grouped form, for the 15-tabs-in-3-groups case. */
  groups?: { label: Value; items: NavEntry[] }[];
}

/**
 * The app shell — the spec replacement for the hand-written `_app.tsx`/`_layout.tsx`
 * every catalogue app carries.
 *
 * **Optional, but not always derivable.** The renderer derives nav from the route list
 * ONLY when there are at most {@link SHELL_DERIVE_MAX_ROUTES} top-level STATIC routes;
 * above that the model declares {@link ShellSpec.groups}, because T0 measured 0/5
 * catalogue apps reproducing from a flat list. Parameterised routes are never nav items.
 */
export interface ShellSpec {
  brand?: string;
  /** Flat destinations. Static routes only. */
  nav?: NavEntry[];
  /** Grouped destinations — required above {@link SHELL_DERIVE_MAX_ROUTES} routes. */
  groups?: NavGroup[];
  /** Per-entity sub-navigation, one entry per route family. */
  subnav?: SubnavSpec[];
  placement?: ShellPlacement;
  /**
   * A persistent assistant dock (audit A9 / T0 §5a finding 5 — present in 4/5 apps as a
   * hand-built `ConciergeDock`/`CopilotDock`/`AssistantDock`). The `chat` section, hoisted
   * to the shell so it does not have to be repeated on every page.
   */
  assistant?: { agent: string; space?: string; greeting?: Value };
}

// ── the endpoint-side contract for form-field options ────────────────────────

/**
 * **`x-options` — a foreign-key form field's option source.**
 *
 * This is a JSON-Schema annotation on a **mutation's Input property**, NOT a view-spec
 * field, and that is the whole point: `create` sections derive their fields from the
 * endpoint's Input schema, so where an option list comes from belongs to that same
 * contract. The api author writes it; `contracts.ts` carries it through; the renderer's
 * schema-form honours it.
 *
 * ```ts
 * // api/expenses/POST.ts
 * export interface Input {
 *   description: string
 *   amount: number
 *   /** @x-options {"query":"listTravelers","label":"$.name","value":"$.id"} *\/
 *   paidByTravelerId: string
 * }
 * ```
 *
 * T0 blocked 2 of 10 pages on this: without it a foreign-key field renders as a UUID text
 * box and `trips`' settlement feature — that app's centrepiece — breaks outright.
 */
export interface XOptions {
  /** The endpoint whose Output supplies the options. */
  query: string;
  /** Its arguments, bound from the form/route (`{ id: '$route.tripId' }`). */
  input?: Record<string, Arg>;
  /** Path to each option's display label, in row scope (`$.name`). */
  label: Binding;
  /** Path to each option's submitted value, in row scope (`$.id`). */
  value: Binding;
}

/** The JSON-Schema keyword {@link XOptions} is carried under. */
export const X_OPTIONS_KEYWORD = 'x-options';

/** JSON Schema for an {@link XOptions} annotation, so the api build can validate one. */
export const X_OPTIONS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'label', 'value'],
  properties: {
    query: { type: 'string', pattern: IDENT_PATTERN },
    // An argument map like every other (Wave-2): a constant or a binding. `label`/`value`
    // stay strict bindings — they are paths INTO each option row, never constants.
    input: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'], pattern: VALUE_PATTERN } },
    label: { type: 'string', pattern: BINDING_PATTERN },
    value: { type: 'string', pattern: BINDING_PATTERN },
  },
};

/** Read an {@link XOptions} annotation off one Input-schema property, if it carries one. */
export function readXOptions(propertySchema: unknown): XOptions | undefined {
  if (!propertySchema || typeof propertySchema !== 'object') return undefined;
  const raw = (propertySchema as Record<string, unknown>)[X_OPTIONS_KEYWORD];
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as XOptions;
}

// ── compile-time coverage assertions ─────────────────────────────────────────
//
// These are the guardrail against §1's vocabularies drifting from §3's unions. They cost
// nothing at runtime and fail `pnpm typecheck` the moment a list and a union disagree.

/** Compiles only when `T` is `never`. */
type AssertNever<T extends never> = T;

/** Element kinds declared but not implemented as an interface, and vice versa. */
type _ElementDrift = Exclude<ElementKind, ElementNode['el']> | Exclude<ElementNode['el'], ElementKind>;
export type _ElementCoverage = AssertNever<_ElementDrift>;

/** Section kinds declared but not implemented as an interface, and vice versa. */
type _SectionDrift = Exclude<SectionKind, SectionSpec['kind']> | Exclude<SectionSpec['kind'], SectionKind>;
export type _SectionCoverage = AssertNever<_SectionDrift>;

// ──────────────────────────────────────────────────────────────────────────────
// 4. JSON Schema builders
// ──────────────────────────────────────────────────────────────────────────────

/** `$ref` shorthand. */
const ref = (name: string): JsonSchema => ({ $ref: `#/$defs/${name}` });

/** A value (literal or binding). */
const V: JsonSchema = ref('value');
/** A strict binding path. */
const B: JsonSchema = ref('binding');
/** A flat-item slot: a value, or a value plus its modifiers. */
const FLAT: JsonSchema = ref('flatValue');
/** Any slot-fillable node. */
const NODE: JsonSchema = ref('node');
/** An array of slot-fillable nodes. */
const NODES: JsonSchema = { type: 'array', items: ref('node') };
/** An action. */
const ACTION: JsonSchema = ref('action');
/** An icon name. */
const ICON: JsonSchema = { enum: [...ICON_NAMES] };
/** A tone token. */
const TONE: JsonSchema = { enum: [...TONES] };
/** A list of endpoint names to invalidate. */
const INVALIDATES: JsonSchema = { type: 'array', items: { type: 'string', pattern: IDENT_PATTERN } };
/** A list of section ids to reveal. */
const REVEALS: JsonSchema = { type: 'array', items: { type: 'string', pattern: IDENT_PATTERN } };
/** An endpoint name. */
const ENDPOINT: JsonSchema = { type: 'string', pattern: IDENT_PATTERN };
/**
 * An **argument map** — dependent-query inputs, navigate params, mutation args.
 *
 * Its values are {@link Arg}s: a binding path OR a constant. One shape for every argument
 * site in the language, so `{ id: '$.id', meal: 'dinner', withinDays: 7 }` is one object
 * rather than a path map plus a defaults mechanism somewhere else.
 */
const ARG_MAP: JsonSchema = {
  type: 'object',
  additionalProperties: ref('arg'),
  propertyNames: { pattern: IDENT_PATTERN },
};

/** The {@link Formatted} modifier, spliced into every prop group carrying a bound value. */
const FMT: Record<string, JsonSchema> = { format: { enum: [...FORMATS] }, currencyField: B };

/** The {@link Toned} modifier — literal token, `'auto'`, or a declared value→tone map. */
const TONED: Record<string, JsonSchema> = {
  tone: TONE,
  toneMap: { type: 'object', additionalProperties: TONE },
  toneOf: B,
};

/**
 * Build one element branch. `additionalProperties: false` is what makes an invented prop
 * an error with a named instance path instead of a silently ignored key. `extra` carries
 * per-branch keywords (`anyOf` for "must do something").
 */
function element(
  el: ElementKind,
  props: Record<string, JsonSchema>,
  required: string[] = [],
  extra: JsonSchema = {},
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['el', ...required],
    properties: { el: { const: el }, ...props },
    ...extra,
  };
}

/** Build one section branch. Same closed-object discipline as {@link element}. */
function section(
  kind: SectionKind,
  props: Record<string, JsonSchema>,
  required: string[] = [],
  extra: JsonSchema = {},
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', ...required],
    properties: {
      kind: { const: kind },
      id: { type: 'string', pattern: IDENT_PATTERN },
      title: V,
      ...props,
    },
    ...extra,
  };
}

/**
 * Build a **collection** section — `list` and its group-aware sibling `timeline`.
 *
 * They share every fact about where rows come from and what a row does, so they share one
 * builder: an amendment to sourcing (`from`, `poll`, `limit`, `rowAction`) lands on both
 * by construction rather than by two people remembering.
 *
 * `query` is not in `required`: a section can be sourced EITHER by naming an endpoint OR
 * by `from`-ing another section's Output. `anyOf` demands one of the two — so
 * `{ kind: 'list', query: 'X' }` remains the minimum valid section, and
 * `{ kind: 'list' }` alone is still an error naming the section.
 */
function listLike(kind: SectionKind, props: Record<string, JsonSchema>): JsonSchema {
  return section(
    kind,
    {
      query: ENDPOINT,
      from: B,
      param: B,
      input: ARG_MAP,
      limit: { type: 'integer', minimum: 1 },
      item: NODE,
      rowAction: ACTION,
      rowActions: { type: 'array', items: ref('actionItem') },
      poll: ref('poll'),
      empty: ref('emptyState'),
      ...props,
    },
    [],
    { anyOf: [{ required: ['query'] }, { required: ['from'] }] },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. The element + section schema tables
//
// These two tables are the JSON-Schema mirrors of §3's two unions. Keep each in ONE
// obvious place: an amendment is a row here and an interface there.
// ──────────────────────────────────────────────────────────────────────────────

const ELEMENT_DEFS: JsonSchema[] = [
  // layout
  element('row', {
    children: NODES,
    gap: { type: 'number' },
    justify: { enum: ['start', 'center', 'end', 'between'] },
    align: { enum: ['start', 'center', 'end', 'stretch'] },
    wrap: { type: 'boolean' },
    scroll: { const: 'x' },
  }),
  element('col', {
    children: NODES,
    gap: { type: 'number' },
    align: { enum: ['start', 'center', 'end', 'stretch'] },
  }),
  element('grid', {
    children: NODES,
    columns: { type: 'number' },
    gap: { type: 'number' },
    scroll: { const: 'x' },
  }),
  element('spacer', {}),
  element('divider', { label: V }),
  element('surface', { children: NODES, title: V, action: ACTION, ...TONED }),

  // typography
  element('heading', { text: V, level: { enum: [1, 2, 3, 4] } }, ['text']),
  element(
    'text',
    {
      text: V,
      bold: { type: 'boolean' },
      dim: { type: 'boolean' },
      italic: { type: 'boolean' },
      strike: { type: 'boolean' },
      maxLines: { type: 'integer', minimum: 1 },
      ...FMT,
      ...TONED,
    },
    ['text'],
  ),
  element('caption', { text: V, maxLines: { type: 'integer', minimum: 1 }, ...FMT, ...TONED }, ['text']),
  element('markdown', { text: V }, ['text']),

  // data display
  element('badge', { text: V, shape: { enum: ['badge', 'pill', 'tag'] }, icon: ICON, ...TONED }, ['text']),
  element('statcard', { label: V, value: V, delta: V, icon: ICON, action: ACTION, ...FMT, ...TONED }, [
    'label',
    'value',
  ]),
  element(
    'meter',
    {
      value: V,
      max: { oneOf: [V, { type: 'number' }] },
      label: V,
      variant: { enum: ['bar', 'ring', 'segments'] },
      ...TONED,
    },
    ['value'],
  ),
  element(
    'keyvalue',
    {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: { label: V, value: V, ...FMT },
        },
      },
      layout: { enum: ['stacked', 'inline'] },
    },
    ['pairs'],
  ),
  element(
    'table',
    {
      rows: B,
      columns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: { label: V, value: V, align: { enum: ['start', 'center', 'end'] }, ...FMT },
        },
      },
      scroll: { const: 'x' },
    },
    ['rows', 'columns'],
  ),
  element('timeline', { items: B, title: V, time: V, detail: V, icon: ICON, ...FMT }, ['items', 'title']),
  element('rating', { value: V, max: { type: 'number' } }, ['value']),

  // media
  element('image', { src: V, alt: V, fit: { enum: ['contain', 'cover'] }, ratio: { enum: ['square', 'wide', 'tall'] } }, [
    'src',
  ]),
  element('icon', { name: ICON, size: { enum: ['sm', 'md', 'lg'] }, tone: TONE }, ['name']),

  // feedback
  element('banner', { text: V, title: V, icon: ICON, ...TONED }, ['text']),
  element('empty', { title: V, message: V, icon: ICON, action: ref('actionItem') }),

  // interactive
  element(
    'button',
    {
      label: V,
      action: ACTION,
      reveals: REVEALS,
      icon: ICON,
      tone: TONE,
      variant: { enum: ['primary', 'secondary', 'ghost'] },
    },
    ['label'],
    // A button that neither acts nor reveals is a defect, and a static gate can say so.
    { anyOf: [{ required: ['action'] }, { required: ['reveals'] }] },
  ),
  element(
    'link',
    { text: V, to: ref('route'), params: ARG_MAP, href: V, external: { type: 'boolean' }, icon: ICON },
    ['text'],
  ),
  element(
    'field',
    {
      kind: { enum: [...FIELD_KINDS] },
      value: B,
      mutation: ENDPOINT,
      arg: { type: 'string', pattern: IDENT_PATTERN },
      input: ARG_MAP,
      label: V,
      placeholder: V,
      options: { oneOf: [{ type: 'array', items: { type: 'string' } }, B] },
      min: { type: 'number' },
      max: { type: 'number' },
      step: { type: 'number' },
      submitLabel: V,
      invalidates: INVALIDATES,
    },
    ['kind', 'value', 'mutation'],
  ),
];

const SECTION_DEFS: JsonSchema[] = [
  listLike('list', {
    layout: { enum: [...LIST_LAYOUTS] },
    facet: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field'],
        properties: {
          field: B,
          label: V,
          options: { type: 'array', items: { type: 'string' } },
          counts: { type: 'boolean' },
        },
      },
    },
    sort: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'field'],
        properties: { label: V, field: B, dir: { enum: ['asc', 'desc'] } },
      },
    },
    search: {
      oneOf: [
        { type: 'boolean' },
        {
          type: 'object',
          additionalProperties: false,
          properties: { fields: { type: 'array', items: B }, placeholder: { type: 'string' } },
        },
      ],
    },
    selectable: { type: 'boolean' },
    bulkActions: { type: 'array', items: ref('actionItem') },
  }),

  section(
    'detail',
    {
      query: ENDPOINT,
      param: B,
      input: ARG_MAP,
      header: NODE,
      fields: ref('fieldList'),
      body: NODE,
      actions: { type: 'array', items: ref('actionItem') },
      poll: ref('poll'),
      empty: ref('emptyState'),
    },
    ['query'],
  ),

  // NOTE: no `fields`. Form fields derive from the mutation's Input JSON Schema, and
  // `additionalProperties: false` (from `section()`) makes declaring them an error whose
  // instance path names the section — the "structurally impossible to get wrong" rule.
  section(
    'create',
    {
      mutation: ENDPOINT,
      input: ARG_MAP,
      submitLabel: V,
      invalidates: INVALIDATES,
      async: {
        type: 'object',
        additionalProperties: false,
        properties: { note: V, refetchAfter: { type: 'integer', minimum: 0 } },
      },
      prefill: {
        type: 'object',
        additionalProperties: false,
        required: ['endpoint'],
        properties: { endpoint: ENDPOINT, input: ARG_MAP, from: B, merge: { enum: ['fill-empty'] } },
      },
      onSuccess: ACTION,
    },
    ['mutation'],
  ),

  section(
    'stats',
    {
      query: ENDPOINT,
      input: ARG_MAP,
      cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: V,
            value: V,
            delta: V,
            icon: ICON,
            meter: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    max: { oneOf: [V, { type: 'number' }] },
                    variant: { enum: ['bar', 'ring', 'segments'] },
                  },
                },
              ],
            },
            action: ACTION,
            ...FMT,
            ...TONED,
          },
        },
      },
      poll: ref('poll'),
    },
    ['query', 'cards'],
  ),

  section('markdown', {
    // Literal markdown is NOT a `value` — prose legitimately contains `${` and `{{`.
    source: { type: 'string' },
    query: ENDPOINT,
    param: B,
    input: ARG_MAP,
    value: B,
    poll: ref('poll'),
  }),

  section(
    'chat',
    {
      // A SLUG, not an identifier: `pantry-keeper` is the naming style this codebase
      // actually uses, and the old identifier pattern rejected every one of them.
      agent: { type: 'string', pattern: AGENT_NAME_PATTERN },
      space: { type: 'string' },
      greeting: V,
      height: { enum: ['sm', 'md', 'lg', 'full'] },
    },
    ['agent'],
  ),

  section('toolbar', {
    reveals: REVEALS,
    actions: { type: 'array', items: ref('actionItem') },
  }),

  // The 8th kind. `list`'s group-aware sibling — same source/poll/row machinery, plus
  // `group` and the per-entry time/note bindings from `render-descriptor`'s timeline.
  listLike('timeline', {
    group: B,
    groupFormat: { enum: [...FORMATS] },
    itemTime: B,
    itemEndTime: B,
    itemNote: B,
  }),
];

// ──────────────────────────────────────────────────────────────────────────────
// 6. The shared `$defs` + the three published schemas
// ──────────────────────────────────────────────────────────────────────────────

/** Definitions shared by the page, component and shell schemas. */
const DEFS: Record<string, JsonSchema> = {
  binding: {
    type: 'string',
    pattern: BINDING_PATTERN,
    description:
      'A binding PATH: $, $.field, $props.x, $route.id, $data.<sectionId>.<path>, $result.field, ' +
      '$form.field, $client.timezone. Never an expression.',
  },
  value: {
    type: 'string',
    pattern: VALUE_PATTERN,
    description: 'A literal string, or a binding path. Expressions and {{ }} interpolation are not supported.',
  },
  /**
   * An ARGUMENT: a constant or a binding. `pattern` is a string-only keyword, so it grades
   * the string branch against {@link VALUE_PATTERN} — the same one literal/binding
   * discrimination used everywhere else — and leaves `number`/`boolean` alone. The closed
   * `type` list is what keeps this from becoming an expression back-door: an object or an
   * array here is a `type` error naming the argument.
   */
  arg: {
    type: ['string', 'number', 'boolean'],
    pattern: VALUE_PATTERN,
    description:
      'An endpoint argument: a constant (string, number or boolean) or a binding path ' +
      '($.field, $route.id, $data.<sectionId>.<path>). Never an expression.',
  },
  route: { type: 'string', pattern: ROUTE_PATTERN, description: 'An authoring route: index, recipes/[id].' },
  staticRoute: {
    type: 'string',
    pattern: STATIC_ROUTE_PATTERN,
    description: 'A nav destination: a route with no [param] segment.',
  },

  /** Poll-while-pending — a named policy over a finite value set, never a predicate. */
  poll: {
    type: 'object',
    additionalProperties: false,
    required: ['everyMs'],
    properties: {
      everyMs: { type: 'integer', minimum: 250 },
      while: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'in'],
        properties: {
          field: B,
          in: {
            type: 'array',
            minItems: 1,
            items: { type: ['string', 'number', 'boolean'] },
          },
        },
      },
    },
  },

  action: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['mutate'],
        properties: {
          mutate: ENDPOINT,
          input: ARG_MAP,
          over: { const: 'selection' },
          arg: { type: 'string', pattern: IDENT_PATTERN },
          confirm: { type: 'string' },
          invalidates: INVALIDATES,
          onSuccess: ACTION,
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['navigate'],
        properties: { navigate: ref('route'), params: ARG_MAP },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['download'],
        properties: { download: ENDPOINT, input: ARG_MAP, filename: V },
      },
      { type: 'object', additionalProperties: false, required: ['print'], properties: { print: { const: true } } },
      { type: 'object', additionalProperties: false, required: ['copy'], properties: { copy: V } },
    ],
  },

  actionItem: {
    type: 'object',
    additionalProperties: false,
    required: ['label'],
    // Same rule as `button`: an item must act, reveal, or both.
    anyOf: [{ required: ['action'] }, { required: ['reveals'] }],
    properties: {
      label: V,
      action: ACTION,
      reveals: REVEALS,
      icon: ICON,
      tone: TONE,
      variant: { enum: ['primary', 'secondary', 'ghost'] },
    },
  },

  fieldList: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'value'],
      properties: { label: V, value: V, ...FMT },
    },
  },

  /**
   * A section's empty-state override: a sentence, or the empty-state object (with `el`
   * optional, so both `empty: 'Nothing yet'` and `empty: { title: 'Nothing yet' }` work —
   * the bare object is the form the desk check reached for every single time).
   */
  emptyState: {
    oneOf: [
      V,
      {
        type: 'object',
        additionalProperties: false,
        properties: { el: { const: 'empty' }, title: V, message: V, icon: ICON, action: ref('actionItem') },
      },
    ],
  },

  /** The element union — discriminated on `el`, so ajv reports only the matching branch. */
  element: { type: 'object', required: ['el'], discriminator: { propertyName: 'el' }, oneOf: ELEMENT_DEFS },

  componentRef: {
    type: 'object',
    additionalProperties: false,
    required: ['use'],
    properties: {
      use: { type: 'string', pattern: IDENT_PATTERN },
      props: { type: 'object', additionalProperties: V, propertyNames: { pattern: IDENT_PATTERN } },
    },
  },

  /**
   * A flat-item slot: a value, or that value with its modifiers. See {@link FlatValue} —
   * this one definition is why there is no `metaFormat`/`captionFormat` key explosion.
   */
  flatValue: {
    oneOf: [
      V,
      {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        // `suffix` is a shared modifier like `format` — one property here, units on every
        // flat key, and no `metaSuffix`/`captionSuffix` family.
        properties: { value: V, suffix: V, maxLines: { type: 'integer', minimum: 1 }, ...FMT, ...TONED },
      },
    ],
  },

  flatItem: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: FLAT,
      subtitle: FLAT,
      caption: FLAT,
      meta: FLAT,
      value: FLAT,
      suffix: FLAT,
      note: FLAT,
      markdown: FLAT,
      badge: FLAT,
      status: FLAT,
      image: FLAT,
      icon: ICON,
      badges: B,
      keyvalue: ref('fieldList'),
      action: ACTION,
      actions: { type: 'array', items: ref('actionItem') },
    },
  },

  /**
   * Anything that fills a slot: an element (`el`), a component reference (`use`), or the
   * flat item form (neither).
   *
   * Dispatched with `if`/`then` rather than a three-branch `oneOf` **for the error
   * report**: a bare `oneOf` makes a single bad prop fail all three branches and emits
   * every branch's complaint, burying the one that matters. This way a node with `el`
   * reports ONLY the element union's errors, at the precise instance path.
   */
  node: {
    type: 'object',
    if: { required: ['el'] },
    then: ref('element'),
    else: { if: { required: ['use'] }, then: ref('componentRef'), else: ref('flatItem') },
  },

  /** The section union — discriminated on `kind`. */
  section: { type: 'object', required: ['kind'], discriminator: { propertyName: 'kind' }, oneOf: SECTION_DEFS },
};

/** JSON Schema for one page spec — what `writeProjectView` validates. */
export const VIEW_SPEC_SCHEMA: JsonSchema = {
  $id: 'lmthing://view-spec/page',
  type: 'object',
  additionalProperties: false,
  required: ['route', 'sections'],
  properties: {
    route: ref('route'),
    title: { type: 'string' },
    layout: { enum: [...PAGE_ARCHETYPES] },
    sections: { type: 'array', minItems: 1, items: ref('section') },
  },
  $defs: DEFS,
};

/** JSON Schema for one view component def — what `writeProjectViewComponent` validates. */
export const VIEW_COMPONENT_SCHEMA: JsonSchema = {
  $id: 'lmthing://view-spec/component',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'node'],
  properties: {
    name: { type: 'string', pattern: '^[A-Z][A-Za-z0-9]*$' },
    props: {
      type: 'object',
      additionalProperties: { type: 'string', pattern: TYPEREF_PATTERN },
      propertyNames: { pattern: IDENT_PATTERN },
    },
    node: NODE,
    description: { type: 'string' },
  },
  $defs: DEFS,
};

/** A live count on a nav item: an endpoint name plus a path into its Output. */
const NAV_BADGE: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'field'],
  properties: { query: ENDPOINT, field: B },
};

/** One nav destination — a STATIC route only; a `[param]` route is never a nav item. */
const NAV_ENTRY: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['route'],
  properties: { route: ref('staticRoute'), label: V, icon: ICON, badge: NAV_BADGE },
};

/** A sub-nav destination — same shape, but its route may (and usually does) carry a param. */
const SUBNAV_ENTRY: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['route'],
  properties: { route: ref('route'), label: V, icon: ICON, badge: NAV_BADGE },
};

/**
 * JSON Schema for the app shell. Every field optional — but see
 * {@link SHELL_DERIVE_MAX_ROUTES}: above 5 top-level static routes the renderer stops
 * deriving and `groups` becomes the honest declaration.
 */
export const SHELL_SPEC_SCHEMA: JsonSchema = {
  $id: 'lmthing://view-spec/shell',
  type: 'object',
  additionalProperties: false,
  properties: {
    brand: { type: 'string' },
    nav: { type: 'array', items: NAV_ENTRY },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'home'],
        properties: {
          label: V,
          // The DESTINATION is static — a tab that opens `feed/[articleId]` opens nothing.
          home: ref('staticRoute'),
          // The HIGHLIGHT FAMILY may be parameterised: a drill-in belongs to its tab, and
          // under the static-only pattern it had no group and was reported as an orphan.
          routes: { type: 'array', items: ref('route') },
          icon: ICON,
          badge: NAV_BADGE,
        },
      },
    },
    subnav: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['match'],
        // A sub-nav with neither items nor groups navigates nowhere.
        anyOf: [{ required: ['items'] }, { required: ['groups'] }],
        properties: {
          // The prefix MUST be parameterised — that is what makes it entity-scoped.
          match: { type: 'string', pattern: ROUTE_PATTERN },
          label: V,
          items: { type: 'array', items: SUBNAV_ENTRY },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'items'],
              properties: { label: V, items: { type: 'array', items: SUBNAV_ENTRY } },
            },
          },
        },
      },
    },
    placement: { enum: [...SHELL_PLACEMENTS] },
    assistant: {
      type: 'object',
      additionalProperties: false,
      required: ['agent'],
      // Same slug rule as `chat.agent` — one spelling of "an agent" in the whole contract.
      properties: { agent: { type: 'string', pattern: AGENT_NAME_PATTERN }, space: { type: 'string' }, greeting: V },
    },
  },
  $defs: DEFS,
};

// ──────────────────────────────────────────────────────────────────────────────
// 7. ajv — shape validation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ajv v8 is a CJS package with no `exports` map, so under `moduleResolution: NodeNext`
 * its default import resolves to the module namespace, not the class. Same dance as
 * `../build/validate.ts`.
 */
const AjvCtor: typeof import('ajv').Ajv =
  (Ajv as unknown as { default?: typeof import('ajv').Ajv }).default ?? (Ajv as unknown as typeof import('ajv').Ajv);

/**
 * One shared instance for the whole process.
 *
 * Differences from the api pipeline's ajv (`../build/validate.ts`) and why:
 *  - `coerceTypes: false` — a spec is authored, not received over the wire. Silently
 *    turning `limit: '10'` into `10` hides a model mistake we would rather name.
 *  - `useDefaults: false` — defaults live in the RENDERER, not in the persisted spec, so
 *    that a later default change applies retroactively via `BUILDER_VERSION`.
 *  - `discriminator: true` — the reason the errors are usable: with a discriminated
 *    `oneOf`, ajv reports the errors of the ONE matching branch (`sections/1/mutation`)
 *    instead of every branch's failure.
 *  - `strict: false` — `discriminator` alongside `$defs`/`$ref` trips ajv's strict-mode
 *    metaschema checks; the schema is hand-written and covered by this module's tests.
 *  - `verbose: true` — the errors are a MODEL-FACING interface, not a log line. Without it an
 *    `ErrorObject` carries neither the offending value (`data`) nor the schema it failed against
 *    (`parentSchema`), so `validate.ts` could not name the finite valid set an
 *    `additionalProperties`/`required` failure was measured against, and could not tell
 *    `looksLikeExpression` what string to inspect. Menu-shaped rejection is the whole retry-
 *    convergence mechanism (plan Part 3, bucket 2); it costs one extra field per error object,
 *    and only on the failure path.
 */
const ajv = new AjvCtor({ allErrors: true, discriminator: true, strict: false, verbose: true });

const compiledPage: ValidateFunction = ajv.compile(VIEW_SPEC_SCHEMA);
const compiledComponent: ValidateFunction = ajv.compile(VIEW_COMPONENT_SCHEMA);
const compiledShell: ValidateFunction = ajv.compile(SHELL_SPEC_SCHEMA);

/** The result of a shape check. `errors` carries ajv's `instancePath` for menu-shaping. */
export interface ShapeResult {
  ok: boolean;
  errors: ErrorObject[];
}

/**
 * Validate a page spec's SHAPE. Says nothing about whether `query: 'listRecipes'` is a
 * real endpoint — that is `validate.ts`'s job, which runs this first.
 */
export function validateViewSpecShape(spec: unknown): ShapeResult {
  const ok = compiledPage(spec) as boolean;
  return { ok, errors: ok ? [] : (compiledPage.errors ?? []) };
}

/** Validate a view component def's SHAPE. */
export function validateViewComponentShape(def: unknown): ShapeResult {
  const ok = compiledComponent(def) as boolean;
  return { ok, errors: ok ? [] : (compiledComponent.errors ?? []) };
}

/** Validate a shell spec's SHAPE. */
export function validateShellShape(shell: unknown): ShapeResult {
  const ok = compiledShell(shell) as boolean;
  return { ok, errors: ok ? [] : (compiledShell.errors ?? []) };
}
