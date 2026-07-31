---
input:
  query: string
  attachmentIds: array
---

Build a complete, openable live-project app from supplied material — as a CONTRACT → BUILD → PROVE
pipeline, so no single model turn has to author a whole app at once and no file is ever written before
the types it must satisfy exist.

**Pages here are SPECS, not code.** A page is an ordered list of SECTIONS drawn from a closed menu of
eight kinds (`list`, `detail`, `create`, `stats`, `markdown`, `chat`, `toolbar`, `timeline`), each
naming ONE endpoint and binding paths (`$.field`) into its response; a reusable card or row shape is a
named composition of a closed 24-element vocabulary with declared props. There is no TSX, no imports,
no class names, no colours and no escape hatch — the vocabulary is the ceiling. Two things follow.
The first is that a spec is DATA, so the same app renders natively in the mobile app with no WebView.
The second is that a whole failure class — a dangling import, a re-cased field, a stray comma in a
JSX container, a surface token used as a text colour — cannot be authored here at all, so none of the
machinery that would defend against it exists in this pipeline. What CAN go wrong is different, and
the gates below are aimed at it.

First read the attachments, then distil the request + material into the USER STORIES the app must
satisfy, then make a holistic, BINDING plan of the app (its tables, endpoints, reusable view
components, and MULTIPLE pages) that serves every story — the binding plan keeps the PAGE LIST
lightweight (route + purpose), so no node ever holds every page's detail at once.

**The whole CONTRACT is designed before any code is written.** `plan_tables` (columns with real
TypeScript types), `plan_endpoints` (name, route, source tables, and the exact response fields WITH
TYPES), `plan_view_components` (typed props) and the per-page `plan_views` (route, its sections, each
section's kind + endpoint + the `$.field` bindings it will show) run as one design pass, each seeing
the previous stage's contract so every reference is made against a real name instead of an invented
one.

**`plan_endpoints` carries the two rules a spec app lives or dies by.** One section reads ONE
endpoint, and that endpoint's response must satisfy every binding the section shows — so a
cross-table name, a group-by total, a selection ("tonight's meal"), a status label, a percentage and a
boolean a row's controls read are all COMPUTED FIELDS on the endpoint, because the page has no `.map`,
no join and no ternary to compute them with. And because the spec language has no `!`, every toggle —
save, pin, dismiss, archive, mark-read — must be an endpoint that FLIPS the stored value server-side;
planned any other way, every toggle in the app ships dead.

`validate_contract`, a HOST-RUN code node, then cross-checks the whole graph while it is still cheap
to fix: the structural checks (every table ref real, no duplicate name/route, every `[id]` route has
a caller, no unread table, no dead endpoint, every automation grounded) PLUS the view checks — every
section's kind is one of the eight, every section's endpoint exists, every `$data.<id>` and every
`reveals` target is a section on that same page, every `{ use: … }` resolves, and **every section's
full binding set is satisfiable by its ONE endpoint's declared Output.** A miss there is routed to
`plan_endpoints`, not to the page: the endpoint grows the computed field, the page never grows glue.
On failure the node RESUMES `plan_tables` through `onFail`, carrying `errors` — each naming the
offending node, the exact reference, and the REAL options — so the redesign is told what broke rather
than re-running blind. `emit_types` then writes the validated contract into the project's own `.d.ts`,
so the types exist before the first line of app code.

Only then does implementation run, each fork receiving its own slice of the contract: write each table
(with its source-derived rows) → `reconcile_tables` (host-run) checks what actually reached disk →
write each typed API → `smoke_endpoints` (host-run) INVOKES every endpoint, because nothing else ever
runs one and a handler returning structurally-valid zeros passes every static check → write each view
component (ONE `writeProjectViewComponent` object literal) → write each page (ONE `writeProjectView`
object literal) → write the SHELL (nav, per-entity sub-nav, the assistant dock) → write each planned
automation as a `hooks/<slug>.ts`. Every writer VALIDATES at save time and returns a MENU-SHAPED error
— the instance path, the offense, and the finite set of valid values — so the retry loop's whole job
is to read the menu and edit one field.

Beyond SHAPE, two gates prove the app is RIGHT. `plan_acceptance` + `check_acceptance` (host-run) call
each endpoint against the seeded data and evaluate source-grounded checks, catching a handler that
answers a valid shape with meaningless numbers. Every arithmetic rule the brief STATES becomes a check
carrying its WORKED-OUT expected value ("labour is £45/hour, a total is labour plus parts" + a 2.5-hour
job with £70.49 of parts ⇒ that job's total is 182.99), because a dropped term is the one defect every
static gate passes: right shape, right type, confident wrong number. A miss routes to the ENDPOINT that
computed it, and a check the gate cannot EVALUATE is reported and resumes the planner rather than
silently reading as covered. Then `verify` (host-run) merges THREE ground truths:
the real `buildProjectApp` typecheck+bundle over the generated wrappers, `validateAppViews` (the
app-wide checks a per-page save cannot make — an orphan route, a dangling nav target, a dead
component, a page with no data-bound section), and `renderSmokeViews`, which MOUNTS every view against
the app's live endpoint responses over the seeded rows and reports render errors, binding coverage and
**empty renders**. That last one is the failure only it can see: a page whose every name resolves and
whose every binding is contract-valid still shows nothing when the endpoint's computed field is not
actually computed. **An always-null binding is an ENDPOINT defect**, so `verify` routes it to the
handler's file — pointing it at the view would teach the fixer to delete the binding, i.e. to delete
the feature.

`fix` fans out one fork per offending artifact — a view, a view component, the shell, an api handler
or a hook — reading THAT artifact's real errors plus the plan, and then RESUMES the gate through
`onFail`, so the verify→fix cycle loops until clean. `finalize` runs no build of its own (the last
`verify` IS the authoritative one) and reports HONESTLY: it resolves `ok` only when the build, the
app-wide validation and the render smoke ALL ran and were ALL clean, and it FAILS LOUDLY carrying the
residual errors and anything planned that is missing. It also carries forward, verbatim, any surface
the planner said it **could not express** — with no escape hatch, an honest "this part needs a
multi-select the spec language does not have" is a correct answer and the user must hear it, where a
page forced into the wrong section kind is the failure this pipeline exists to prevent.
