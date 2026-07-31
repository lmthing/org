# `view-spec/` — the shared contract

> **Source of truth is [`org/docs/`](../../../../../../org/docs/README.md).** This README is a
> map of the module for the agents who own the files around it; the grounded, cited
> documentation is `org/docs/format/project/pages/view-spec.md` (owned by Wave 1's
> CLI-ENGINE agent). Where they disagree, `org/docs/` wins; where either disagrees with
> `schema.ts`, the code wins.

## What this is

A page the app builder writes is not TSX — it is a **spec**: a plain object the
model emits as a TypeScript object literal, validated at save time and rendered by the
shared `ViewRenderer` on **both** targets (the web bundle and the native mobile app, no
WebView). Data and behaviour stay real code — tables, endpoints, automations, handlers —
and are reached **by name**, never by URL and never by fetch code.

`schema.ts` holds **both halves of the contract in one file, on purpose**:

- the **TypeScript types** the renderer, the writers and the tests program against;
- the **JSON Schema** (ajv) that validates what the model actually produced.

Every enum-shaped fact (section kinds, element kinds, formats, tones, icon names,
archetypes) is declared once as a `const` tuple, used to derive the TS union *and* spliced
into the JSON Schema. `schema.test.ts` asserts the two halves agree; compile-time
`AssertNever` guards make a drift between a tuple and its union a `pnpm typecheck` failure.

```
schema.ts        types + JSON Schema + shape validators   ← the pinned contract
messages.ts      menu-shaped rejections (the model-facing text)
validate.ts      name resolution, binding cross-checks,
                 app-wide checks, render smoke
files.ts         the on-disk layout (spec / wrapper / component / shell paths)
wrapper.ts       the generated `pages/<route>.tsx` that renders a spec
```

`schema.ts` answers *"is this well-formed?"*; `validate.ts` answers *"is this true of THIS
project?"* — and `messages.ts` is how either answer is phrased, because a rejection that does
not name the finite valid set costs a fork per retry.

The writers that call all of this live in [`../authoring/globals.ts`](../authoring/globals.ts)
(`writeProjectView` · `writeProjectViewComponent` · `writeProjectViewShell`), gated on
**`views:write`** — a separate capability from `pages:write`, which is what makes freehand TSX in
every `system-appbuilder` agent a typecheck error rather than a policed instruction.

`schema.ts` is **shape only**. It does not know the project: whether `query: 'listRecipes'`
is a real endpoint, whether `$.title` is a real Output field, whether `{ use: 'RecipeCard' }`
resolves — all of that is `validate.ts`, which runs these validators first and then
cross-checks against `ProjectContracts`
([`../build/contracts.ts`](../build/contracts.ts)).

## The non-negotiables

1. **No `custom` kind. No escape hatch — and nowhere to escape to.** The section union is
   capped at 8 (all pinned); the element catalogue is the ceiling. `system-appbuilder` is the
   only app builder and this is its only medium, so a surface that cannot be expressed is
   *reported* as such by the planner and carried out to the user — never approximated with a
   wrong section, never smuggled in as code, never handed to some other builder.
2. **Bindings are PATHS, never expressions.** `$`, `$.field`, `$props.x`, `$route.id`,
   `$data.<sectionId>.<path>`, `$result.field`, `$form.field`, `$client.timezone` — and
   nothing else. No conditionals, no arithmetic, no interpolation, no eval. An expression
   attempt is a **validation error**, not a silent runtime nothing. Where the corpus needed
   conditional behaviour the answer is a **named declarative policy**: `toneMap`,
   `poll.while`, `merge: 'fill-empty'`.
3. **Everything is optional and has a renderer default.** The minimum valid section is
   `{ kind: 'list', query: 'X' }`. Layout, shell, and item shape are *predicted* when
   absent. Omissions are defaults, not gaps.
4. **Loading / error / empty states are renderer defaults and are not authorable.** There
   is no `skeleton`, no `spinner`, no `loading`. (`empty` exists only to say something
   better than a default that always exists.)
5. **A `create` section declares no fields.** They derive from the mutation endpoint's
   Input JSON Schema. There is no `fields` property to fill in, and every object is
   `additionalProperties: false`, so writing one is an error that names its instance path.
6. **No pagination.** Measured demand across 153 components and 84 pages: zero. `limit` is
   the whole story.

## The vocabulary, in one glance

**8 section kinds** (the union is FULL): `list · detail · create · stats · markdown · chat ·
toolbar · timeline`.

**24 elements** (B1's table listed 28 rows, not the "~26" its prose says; the audit cut 5 —
`chip`, `avatar`, `code`, `quote`, `map` — and added 1, `field`): `row · col · grid · spacer ·
divider · surface · heading · text · caption · markdown · badge · statcard · meter · keyvalue ·
table · timeline · rating · image · icon · banner · empty · button · link · field`.

> **`timeline` is deliberately both an element and a section kind, and that is not a bug.**
> The *element* is an inline ungrouped stream inside a card (the descriptor renderer's
> already-native-tested `timeline` case). The *section* is the page-level, day-grouped one
> with its own source, `poll`, row actions and empty state. A model that reaches for the
> wrong one gets a menu-shaped error and fixes it in one retry.

**The flat item** is the shortest way to write a row (`item: { title: '$.name' }`) and its key
set is sized from T0's ten real specs, because a flat form that cannot express an ordinary row
just pushes every row into an element tree — the verbosity it exists to prevent. The set is
closed: `title · subtitle · caption · meta · value · suffix · note · markdown · badge · status ·
image · icon · badges · keyvalue · action · actions`.

Every text-ish key takes **either a string or `{ value, format?, currencyField?, tone?,
toneMap?, toneOf?, suffix?, maxLines? }`** — count that set from the `flatValue` `$def`, not from
this sentence. That is why there is no `metaFormat`/`captionFormat` pairing:
modifiers live on one definition, so a future modifier is one property rather than eleven new keys —
`suffix` (Wave 2) is that promise being kept, and is how `meta` renders "20 min" rather than "20".

**An argument is a constant or a binding.** Every argument map (`input`, `mutate.input`,
`navigate.params`, `link.params`, `prefill.input`, `x-options.input`) takes an `Arg`: a path, or a
`string`/`number`/`boolean` constant. A string argument is graded by `VALUE_PATTERN` like every
other authored string, so a literal stays distinguishable from a path; a constant is a scalar, so
nothing here is an expression back-door.

## Where to make a change

The two capped vocabularies each live in exactly one obvious place, and each has exactly
two edit sites:

| to change | edit |
|---|---|
| a **section kind** | `SECTION_KINDS` (§1) + its `interface …Section` (§3) + its `section()`/`listLike()` call in `SECTION_DEFS` (§5) + the `SectionSpec` union |
| an **element** | `ELEMENT_KINDS` (§1) + its `interface …El` (§3) + its `element()` row in `ELEMENT_DEFS` (§5) + the `ElementNode` union |
| a **format / tone / icon / archetype** | the `const` tuple in §1 — the JSON Schema picks it up automatically |
| a **flat-item modifier** | one property on the `flatValue` `$def` — never a new paired key |

The tests fail until all sites agree, which is the point.

### Wave-2 amendments (the T1 migration of a real app)

The first time the pinned vocabulary met a shipped page it came back with four gaps — one
**blocking**, which the ratchet promotes on FIRST occurrence because with no escape hatch promotion
is the only relief valve. Three are widenings of an existing shape rather than new tokens; the
vocabulary counts are unchanged (**8 kinds · 24 elements · 16 flat-item keys**).

| # | amendment | shape |
|---|---|---|
| 1 | **literal arguments** (blocking) | argument maps take `Arg = Value \| number \| boolean` — `{ meal: 'dinner', withinDays: 7 }`. One endpoint with three different constants was inexpressible. |
| 2 | **`chat.agent` takes a real slug** | `AGENT_NAME_PATTERN` (`pantry-keeper`), not `IDENT_PATTERN`. The old pattern rejected the only naming style this codebase uses. |
| 3 | **`groups[].routes` may be parameterised** | a *destination* (`nav`, `groups[].home`) stays static; a *highlight family* member may carry a `[param]`. |
| 4 | **`suffix` on any flat value** | `meta: { value: '$.prepMinutes', suffix: 'min' }` — one shared modifier, not a `<key>Suffix` family. |

Deliberately NOT widened, so it is not relitigated: **`ComponentRef.props` stays `Value`-only**
(strings). A component prop declared `number` receiving a literal is the same class of gap, but T1
did not hit it — and the ratchet promotes on evidence, not on symmetry.

Promotions into these vocabularies are governed by the plan's improvement-loop ratchet
(bucket 1: promote on the *second* occurrence, or the first if it blocks), not by taste.

## Normative renderer semantics

These are contract, not renderer implementation detail — Wave 1's UI-RENDERER implements
them and `validate.ts` relies on them. Full text in `schema.ts`'s header:

- **S1** a null binding omits its element (this is how the no-conditionals rule stays
  honest — it replaces the hand-written `{x ? … : null}` guards);
- **S2** `prefill` with no `from` seeds the form on mount by matching field names;
- **S3** the binding namespace is exactly the eight roots above;
- **S4** a facet maps to a **query input**, not a client filter, and works over array fields;
- **S5** toggle mutations belong at the **endpoint** layer (the spec language has no `!`);
- **S6** view-time side effects belong in the **read endpoint**.

And for layout: **an archetype never reorders sections** — it governs width, grid columns
and responsive collapse only. Section order is the model's.

## Provenance

Pinned in Wave 0 from three inputs, all of which should be read before amending it:

- the plan's **B1** — `design/appbuilder-viewspec-plan.md`;
- the **element-catalogue completeness audit** — `design/viewspec-element-audit.md`
  (153 components across 5 shipped apps): cut 5 elements, added `field`, and found the four
  section-contract changes;
- the **T0 desk check** — `design/viewspec-T0-deskcheck.md` (10 shipped pages hand-expressed
  as specs): pinned `timeline` as the 8th kind and produced `poll`, `from`, `onSuccess`,
  `x-options`, the shell-grouping rule and the archetype corrections.

## Tests

```bash
cd sdk/org && pnpm test libs/cli/src/app/view-spec
```
