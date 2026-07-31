/**
 * **Menu-shaped errors** — the model-facing half of the view-spec contract.
 *
 * Every rejection this module builds names three things, in this order:
 *
 *   1. **the instance path** — `sections[1].mutation`, so the model edits ONE field;
 *   2. **the offence** — what it wrote and why that is not a thing;
 *   3. **the finite valid set** — the actual menu, from the actual project.
 *
 * ```
 * sections[1].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe?
 * Mutations: addRecipe, importRecipe, importRecipeText
 * ```
 *
 * This is not polish. The plan measures **retry convergence** (Part 3, bucket 2: "model retries
 * >1 on a writer error" is a classified failure with its own fix layer), and an error that says
 * only *"invalid"* costs a fork per attempt while the model guesses at a set it cannot see. A
 * menu costs one retry, because the answer is IN the message. That makes this text part of the
 * interface: `messages.test.ts` asserts it verbatim, and changing it is a contract change.
 *
 * ## The two `$`-shaped failures are DIFFERENT failures
 *
 * `schema.ts#looksLikeExpression` answers "is this `$`-string wrong at all". It cannot say
 * which of the two ways it is wrong, and they need opposite advice:
 *
 *  - **an expression** (`'$.price * $.qty'`, `'{{ n }} left'`) — the language has none, by
 *    design, so the fix is at the ENDPOINT (a computed Output field) or a named policy
 *    (`format`, `toneMap`, `poll.while`). Telling this model "not a valid path" invites it to
 *    keep rewriting the same arithmetic;
 *  - **a mistyped path** (`'$params.id'`, `'$item.name'`) — the fix is one token, and the
 *    message should hand it over.
 *
 * {@link classifyBadBinding} splits them on the presence of operator/whitespace characters, and
 * the two produce visibly different text.
 */

import {
  AGENT_NAME_PATTERN,
  BINDING_PATTERN,
  IDENT_PATTERN,
  ROUTE_PATTERN,
  STATIC_ROUTE_PATTERN,
  TYPEREF_PATTERN,
  VALUE_PATTERN,
  type JsonSchema,
} from './schema.js';

/**
 * The eight binding roots (schema §2, T0 S3) as a MENU, because that is how a rejection has to
 * present them. Kept beside the messages rather than in `schema.ts` so the contract file stays
 * shape-only; `messages.test.ts` asserts this list against `BINDING_PATTERN`, so a root added
 * there without a menu entry here fails a test rather than shipping a lying error.
 */
export const BINDING_ROOTS_HELP = {
  roots: ['$', '$props', '$route', '$data', '$result', '$form', '$client'] as const,
  sentence:
    'Bindings are paths from one of eight roots: $ (the current row/record), $.field, ' +
    '$props.name (inside a component), $route.param, $data.<sectionId>.path (another section on ' +
    'this page), $result.field (under onSuccess), $form.field (under create.prefill.input), ' +
    '$client.timezone.',
};

/** What kind of thing was rejected — the handle a fix router (`17-fix`) groups findings by. */
export type ViewErrorCode =
  /** ajv shape failure (unknown property, wrong type, missing required, bad enum). */
  | 'shape'
  /** A `query`/`mutation`/`prefill.endpoint`/`mutate`/`download`/`invalidates` name that is not an endpoint. */
  | 'unknown-endpoint'
  /** The endpoint exists but its HTTP method is wrong for the slot (a POST used as a `query`). */
  | 'wrong-method'
  /** An input key the endpoint's Input schema does not declare — silently dropped at runtime. */
  | 'unknown-input'
  /** A `$.field` that the bound endpoint's Output does not declare. */
  | 'unknown-field'
  /** An expression where the language has only paths. */
  | 'expression'
  /** A `$`-string whose root is not one of the eight. */
  | 'bad-binding'
  /** A `{ use: … }` naming a component the app does not define. */
  | 'unknown-component'
  /** A component reference passing a prop the def does not declare, or omitting one it requires. */
  | 'bad-prop'
  /** Component definitions that reference each other in a cycle. */
  | 'component-cycle'
  /** A `chat.agent` / `assistant.agent`, or its `space`, that this project does not define. */
  | 'unknown-agent'
  /** A `reveals` / `$data.<id>` target that is not a section id on this page. */
  | 'unknown-section'
  /** A `navigate` / nav / subnav target that is not a route the app has. */
  | 'unknown-route'
  /** A page no navigation reaches. */
  | 'orphan-route'
  /** A component nothing references (warning). */
  | 'dead-component'
  /** A page with no data-bound section — it renders, and shows nothing real. */
  | 'no-data'
  /** A `create` section whose mutation Input derives no form fields — "Nothing to fill in." */
  | 'empty-form'
  /** A view artifact on disk that did not parse. */
  | 'malformed'
  /** The renderer threw while mounting the spec against live data. */
  | 'render-error'
  /** A binding that is contract-valid but null on every live row — usually an uncomputed Output field. */
  | 'null-binding'
  /** A page that mounted cleanly and produced nothing visible. */
  | 'empty-render';

/** One structured finding. Never a free-form string: the fix loop routes on `code` and `path`. */
export interface ViewError {
  code: ViewErrorCode;
  /** Instance path into the artifact — `sections[1].item.title`. `''` for artifact-level findings. */
  path: string;
  /** The full menu-shaped sentence. This text is the interface; assert it in tests. */
  message: string;
  /** `warning` findings are reported but do not fail the gate. */
  severity: 'error' | 'warning';
  /** Which artifact carries it (`pages/index.view.json`), when the finding is app-wide. */
  file?: string;
  /**
   * The endpoint to fix instead of the view. Set by `renderSmokeViews` for an always-null
   * binding: the view named a field the contract declares, so the defect is that the endpoint
   * never computes it. Routing this finding at the page would have the model delete the binding.
   */
  endpoint?: string;
}

/** The shape every validator returns. Scalars first — see {@link ViewValidationResult}. */
export interface ViewValidationResult {
  /** No `severity: 'error'` finding. Warnings do not clear it to `false`. */
  ok: boolean;
  /** `errors.filter(e => e.severity === 'error').length` — a code node can branch on a scalar. */
  errorCount: number;
  warningCount: number;
  /** How many artifacts were examined. `0` with `ok:true` means NOTHING RAN, not "clean". */
  checked: number;
  /** Every finding, errors and warnings together, in artifact order. */
  errors: ViewError[];
}

/** Assemble a {@link ViewValidationResult} from a finding list. */
export function resultOf(errors: ViewError[], checked: number): ViewValidationResult {
  const errorCount = errors.filter((e) => e.severity === 'error').length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount: errors.length - errorCount,
    checked,
    errors,
  };
}

// ── the "did you mean" ────────────────────────────────────────────────────────

/** Classic Levenshtein. Inputs here are identifiers, so the O(n·m) table is free. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[cols - 1];
}

/**
 * The nearest candidate to `bad`, or `undefined` when nothing is near enough to be a
 * *suggestion* rather than a guess.
 *
 * The threshold is half the word (minimum 2, capped at 4). Two is the floor because the commonest
 * real mistake is a TRANSPOSITION — `titel` for `title` — which plain Levenshtein scores as 2, and
 * a threshold of 1 would silently withhold the answer in exactly the case the model most needs it.
 * Case-insensitive comparison; the SUGGESTION comes back in its real casing.
 */
export function suggest(bad: string, candidates: readonly string[]): string | undefined {
  if (!bad || candidates.length === 0) return undefined;
  const lower = bad.toLowerCase();
  const threshold = Math.min(4, Math.max(2, Math.floor(bad.length / 2)));
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return bestScore <= threshold ? best : undefined;
}

/** `Did you mean addRecipe? ` — or `''`. Always ends with a space when present. */
function didYouMean(bad: string, candidates: readonly string[], prefix = ''): string {
  const s = suggest(bad, candidates);
  return s ? `Did you mean ${prefix}${s}? ` : '';
}

/** `Mutations: a, b, c` — or an honest sentence when the menu is empty. */
function menu(label: string, items: readonly string[]): string {
  const sorted = [...items].sort();
  return sorted.length ? `${label}: ${sorted.join(', ')}` : `${label}: (none — this app has none yet)`;
}

// ── path rendering ────────────────────────────────────────────────────────────

/** ajv's `/sections/1/item/title` → the model's `sections[1].item.title`. */
export function prettyPath(instancePath: string): string {
  const segs = instancePath.split('/').filter((s) => s.length > 0);
  let out = '';
  for (const seg of segs) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(key)) out += `[${key}]`;
    else out += out ? `.${key}` : key;
  }
  return out;
}

/** Prefix a path onto a message, or return the message alone at the artifact root. */
function at(path: string, rest: string): string {
  return path ? `${path}: ${rest}` : rest;
}

// ── the builders ──────────────────────────────────────────────────────────────

const err = (code: ViewErrorCode, path: string, message: string, extra?: Partial<ViewError>): ViewError => ({
  code,
  path,
  message,
  severity: 'error',
  ...extra,
});

const warn = (code: ViewErrorCode, path: string, message: string, extra?: Partial<ViewError>): ViewError => ({
  code,
  path,
  message,
  severity: 'warning',
  ...extra,
});

/** `sections[1].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe? Mutations: …` */
export function unknownEndpoint(path: string, bad: string, label: string, names: readonly string[]): ViewError {
  return err(
    'unknown-endpoint',
    path,
    at(path, `"${bad}" is not an endpoint. ${didYouMean(bad, names)}${menu(label, names)}`),
  );
}

/**
 * The name resolves, but to the wrong half of the api. `query` reads (GET), everything else
 * writes — a spec that mixes them produces a page that fetches on a POST route and 405s.
 */
export function wrongMethod(
  path: string,
  bad: string,
  actual: string,
  slot: 'query' | 'mutation',
  label: string,
  names: readonly string[],
): ViewError {
  const wanted = slot === 'query' ? 'a GET endpoint' : 'a POST/PUT/PATCH/DELETE endpoint';
  // No "did you mean" here: the name resolved exactly. The model reached for the right endpoint in
  // the wrong half of the api, and guessing at a near-miss would send it somewhere else entirely.
  return err(
    'wrong-method',
    path,
    at(path, `"${bad}" is a ${actual} endpoint, and a ${slot} needs ${wanted}. ${menu(label, names)}`),
  );
}

/** `sections[0].item.title: "$.titel" is not a field of listRecipes's Output. …` */
export function unknownField(path: string, bad: string, endpoint: string, fields: readonly string[]): ViewError {
  const leaf = bad.replace(/^\$\./, '').split('.')[0];
  return err(
    'unknown-field',
    path,
    at(
      path,
      `"${bad}" is not a field of ${endpoint}'s Output. ${didYouMean(leaf, fields, '$.')}${menu('Fields', fields)}. ` +
        `If the value should exist, add it to ${endpoint}'s Output and compute it there — a page cannot compute.`,
    ),
  );
}

/** An `input`/`prefill.input` key the endpoint's Input does not declare (silently dropped). */
export function unknownInput(path: string, bad: string, endpoint: string, keys: readonly string[]): ViewError {
  return err(
    'unknown-input',
    path,
    at(
      path,
      `"${bad}" is not an input of ${endpoint}. ${didYouMean(bad, keys)}${menu('Inputs', keys)}. ` +
        `An undeclared key is dropped before the request, so the endpoint never sees it.`,
    ),
  );
}

/** Characters no path may contain — arithmetic, comparison, calls, whitespace, interpolation. */
const EXPRESSION_CHARS = /[+*/%?:()!<>=&|,'"`]|\s|-|\{\{|\$\{/;

/** Which of the two `$`-shaped failures this is. Exported for the writers' own routing. */
export function classifyBadBinding(value: string): 'expression' | 'bad-binding' {
  return EXPRESSION_CHARS.test(value) ? 'expression' : 'bad-binding';
}

/**
 * `"$.price * $.qty" is not a binding — the spec language has no expressions.`
 *
 * The advice is the load-bearing part: this model will otherwise retry the same arithmetic in a
 * different syntax. Three real destinations, named.
 */
export function expressionAttempt(path: string, bad: string): ViewError {
  return err(
    'expression',
    path,
    at(
      path,
      `"${bad}" is not a binding — the spec language has no expressions, on purpose. ` +
        `Bindings are paths only. Compute the value in the endpoint's Output and bind the result, ` +
        `or use a named policy: format (currency/date/relative-time/number), toneMap (value → tone), ` +
        `poll.while (refresh while a field is in a set).`,
    ),
  );
}

/**
 * The roots a model reaches for that do not exist, mapped to the one that does.
 *
 * Edit distance cannot make this jump — `$params`→`$route` is five edits — and these are not
 * random misspellings but the conventions of the frameworks this model has read far more of than
 * it has read this schema. Naming the replacement turns a dead end into a one-token fix.
 */
const ROOT_ALIASES: Record<string, string> = {
  $params: '$route',
  $param: '$route',
  $query: '$route',
  $search: '$route',
  $item: '$',
  $row: '$',
  $record: '$',
  $self: '$',
  $this: '$',
  $prop: '$props',
  $state: '$',
  $ctx: '$',
};

/** `"$params.id" is not a binding root. Roots: … Did you mean "$route.id"?` */
export function badBindingRoot(path: string, bad: string): ViewError {
  const root = /^\$[A-Za-z_]*/.exec(bad)?.[0] ?? bad;
  const rest = bad.slice(root.length);
  const near = ROOT_ALIASES[root] ?? suggest(root, BINDING_ROOTS_HELP.roots);
  const fix = near ? `Did you mean "${near}${rest}"? ` : '';
  return err(
    'bad-binding',
    path,
    at(path, `"${bad}" is not a valid binding. ${fix}${BINDING_ROOTS_HELP.sentence}`),
  );
}

/** `sections[0].item.use: "RecipeCards" is not a view component. …` */
export function unknownComponent(path: string, bad: string, names: readonly string[]): ViewError {
  return err(
    'unknown-component',
    path,
    at(
      path,
      `"${bad}" is not a view component. ${didYouMean(bad, names)}${menu('Components', names)}. ` +
        `Write it first with writeProjectViewComponent('${bad}', { … }).`,
    ),
  );
}

/** A prop a component def does not declare, or a declared prop a use site omits. */
export function badProp(
  path: string,
  kind: 'unknown' | 'missing',
  bad: string,
  component: string,
  props: readonly string[],
): ViewError {
  const head =
    kind === 'unknown'
      ? `"${bad}" is not a prop of ${component}. ${didYouMean(bad, props)}`
      : `${component} requires the prop "${bad}", which this reference does not pass. `;
  return err('bad-prop', path, at(path, `${head}${menu('Props', props)}`));
}

/**
 * A `chat.agent` no space in this project defines.
 *
 * The check `AGENT_NAME_PATTERN` cannot do. A pattern says the slug is *shaped* like an agent; only
 * the project says whether it IS one, and a dock pointed at a name that does not resolve is a dock
 * that renders an error on every load.
 */
export function unknownAgent(path: string, bad: string, space: string, agents: readonly string[]): ViewError {
  return err(
    'unknown-agent',
    path,
    at(
      path,
      `"${bad}" is not an agent of the "${space}" space. ${didYouMean(bad, agents)}${menu('Agents', agents)}. ` +
        `Agents are directories under spaces/${space}/agents/.`,
    ),
  );
}

/** A `chat.space` that is not one of the project's spaces. */
export function unknownSpace(path: string, bad: string, spaces: readonly string[]): ViewError {
  return err(
    'unknown-agent',
    path,
    at(
      path,
      `"${bad}" is not a space in this project. ${didYouMean(bad, spaces)}${menu('Spaces', spaces)}. ` +
        `Spaces are directories under spaces/.`,
    ),
  );
}

/** `reveals` and `$data.<id>` both address a section by id on the SAME page. */
export function unknownSection(path: string, bad: string, ids: readonly string[]): ViewError {
  return err(
    'unknown-section',
    path,
    at(
      path,
      `"${bad}" is not a section id on this page. ${didYouMean(bad, ids)}${menu('Section ids', ids)}. ` +
        `Give the target section an \`id\` — it has none unless you write one.`,
    ),
  );
}

/**
 * A navigation destination that is not a page.
 *
 * **A warning while the app is still being written** (`complete: false`), and an error only once
 * every page is on disk. `recipes` links to `recipes/[id]` and `recipes/[id]` links back: at save
 * time whichever lands first names a route that does not exist yet, so **no write order satisfies
 * both** and a hard failure here is a writer the model cannot satisfy — it retries until its budget
 * dies. The check loses nothing by waiting: `validateAppViews` re-runs this exact resolution against
 * the full route list, where an unreachable target is a genuine defect.
 */
export function unknownRoute(
  path: string,
  bad: string,
  routes: readonly string[],
  complete = true,
): ViewError {
  if (!complete) {
    return warn(
      'unknown-route',
      path,
      at(
        path,
        `"${bad}" is not a route in this app YET. ${menu('Routes written so far', routes)}. ` +
          `Write pages in any order — this is only an error once the app is complete, where ` +
          `validateAppViews re-checks it against every route on disk.`,
      ),
    );
  }
  return err(
    'unknown-route',
    path,
    at(path, `"${bad}" is not a route in this app. ${didYouMean(bad, routes)}${menu('Routes', routes)}`),
  );
}

/** A page nothing navigates to — it exists, and no user can reach it. */
export function orphanRoute(route: string, file: string, navTargets: readonly string[]): ViewError {
  return err(
    'orphan-route',
    '',
    `pages/${route}: no navigation reaches this page. Add it to the shell (nav/groups/subnav), ` +
      `or give some page a { navigate: '${route}' } action / rowAction. ` +
      `${menu('Reachable today', navTargets)}`,
    { file },
  );
}

/** A component nothing uses. A warning: harmless, but it is 100% of a wasted authoring fork. */
export function deadComponent(name: string, file: string): ViewError {
  return warn(
    'dead-component',
    '',
    `component ${name} is defined but no view references it with { use: '${name}' } — ` +
      `either use it or drop it.`,
    { file },
  );
}

/**
 * A page whose sections bind no endpoint at all. It builds, it routes, it renders chrome — and it
 * is the "structurally-valid zeros" failure the whole gate exists for.
 */
export function pageHasNoData(route: string, file: string, kinds: readonly string[]): ViewError {
  return err(
    'no-data',
    '',
    `pages/${route}: no section on this page reads data (sections: ${kinds.join(', ') || 'none'}). ` +
      `A page with no query/mutation renders chrome over nothing. Add a list, detail, stats, ` +
      `timeline or create section bound to an endpoint.`,
    { file },
  );
}

/**
 * A `create` section that renders a Save button over **no inputs at all**.
 *
 * A create section declares no fields on purpose — it renders the mutation's Input JSON Schema
 * (`libs/ui/src/view/form.tsx#deriveFields`), minus the keys the page already supplies through
 * `create.input`. When that derivation is empty the renderer draws the literal string
 * "Nothing to fill in." above the submit button, and the app cannot take data — the one thing the
 * page exists to do. Every input of that derivation is on the CONTRACT, so this is decidable the
 * moment the spec is written.
 *
 * The fix is routed at the ENDPOINT (`endpoint` is set), because that is where the fields live. The
 * second half of the menu matters just as much: a mutation that genuinely takes nothing from the
 * user is a *button*, not a form, and naming that alternative is what stops the model deleting the
 * section to make the rejection go away.
 */
export function emptyForm(
  path: string,
  endpoint: string,
  declared: readonly string[],
  supplied: readonly string[],
  routeParams: readonly string[],
): ViewError {
  const list = (xs: readonly string[]): string => [...xs].sort().join(', ');
  const plural = declared.length === 1;
  const why =
    declared.length === 0
      ? `${endpoint}'s Input declares no properties at all`
      : declared.every((k) => supplied.includes(k))
        ? `every property it declares (${list(declared)}) is already supplied by this section's ` +
          `input, so none is left for the user`
        : `the only propert${plural ? 'y' : 'ies'} it declares (${list(declared)}) ` +
          `${plural ? 'is' : 'are'} this page's own route parameter${plural ? '' : 's'} ` +
          `(${list(routeParams)}), which the page already knows`;
  return err(
    'empty-form',
    path,
    at(
      path,
      `a create section has no fields of its own — it renders "${endpoint}"'s Input schema, and that ` +
        `derives NONE here: ${why}. The page would show "Nothing to fill in." above a Save button, ` +
        `so the app cannot take data. Declare what the user fills in on ${endpoint}'s Input ` +
        `(export interface Input { … } in its handler) — or, if there is genuinely nothing to fill ` +
        `in, this is not a create section: use a button with { action: { mutate: '${endpoint}' } }.`,
    ),
    { endpoint },
  );
}

/** An artifact on disk that did not parse. */
export function malformedArtifact(file: string, message: string): ViewError {
  return err('malformed', '', `${file}: ${message}`, { file });
}

/**
 * The finding `renderSmokeViews` exists to produce: a binding the contract allows, that is null on
 * every row of real data. The message points at the ENDPOINT, because that is where the fix is.
 */
export function alwaysNullBinding(
  path: string,
  binding: string,
  endpoint: string,
  rows: number,
  file: string,
): ViewError {
  return err(
    'null-binding',
    path,
    at(
      path,
      `"${binding}" is null on all ${rows} row(s) ${endpoint} actually returned. The field is declared ` +
        `on ${endpoint}'s Output but never computed, so this renders as nothing. ` +
        `Fix ${endpoint} to populate it — do not remove the binding.`,
    ),
    { file, endpoint },
  );
}

/** A page that mounted and produced nothing a user would see. */
export function emptyRender(route: string, file: string, detail: string): ViewError {
  return err(
    'empty-render',
    '',
    `pages/${route}: renders empty against live data — ${detail}. This passes every static gate ` +
      `and ships a blank page. Check that the sections' endpoints return rows (smoke_endpoints), ` +
      `and that the bound fields are populated.`,
    { file },
  );
}

/**
 * One SECTION that mounted over real data and drew nothing but its heading.
 *
 * The page-level {@link emptyRender} is all-or-nothing, so a single populated list conceals every
 * dead section beside it — which is how `30-bike-workshop` shipped a front page of two headings
 * with every gate green. The finding is per section because the fix is: one endpoint, or one
 * binding, and `17-fix` needs to know which.
 */
export function emptySection(
  route: string,
  file: string,
  index: number,
  kind: string,
  detail: string,
): ViewError {
  return err(
    'empty-render',
    `sections[${index}]`,
    `pages/${route} sections[${index}]: this ${kind} section draws NOTHING against live data — ` +
      `${detail}. Its heading is all a user sees. A bound value that resolves to nothing renders ` +
      `nothing, label and wrapper included (S1), so a section whose every binding is null is a ` +
      `heading over an empty box.`,
    { file },
  );
}

/** The renderer threw. */
export function renderThrew(route: string, file: string, message: string): ViewError {
  return err('render-error', '', `pages/${route}: the renderer threw while mounting — ${message}`, { file });
}

// ── ajv → menu ────────────────────────────────────────────────────────────────

/** ajv's `ErrorObject`, with the fields `verbose: true` adds. */
interface VerboseError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
  data?: unknown;
  parentSchema?: JsonSchema;
}

/**
 * What a string SLOT actually accepts, in words.
 *
 * A regex is not a menu. `"recipes/[id]" does not match the expected form
 * (^[a-z0-9][a-z0-9-]*(?:/[a-z0-9-]+)*$)` — a real rejection, from a nav destination that may not
 * be parameterised — asks the model to read a character class and infer the rule, when the honest
 * answer is one sentence. The schema has a finite, nameable set of string forms, so each one gets
 * its sentence and its examples. The default branch still names the pattern: an unnamed form is a
 * gap in THIS table, and reporting nothing would be worse than reporting a regex.
 */
function patternHelp(pattern: string, parent: JsonSchema | undefined): string {
  switch (pattern) {
    case ROUTE_PATTERN:
      return (
        'A route is lowercase, slash-separated, and may end a segment with a [param]: ' +
        'index, recipes, recipes/[id], trips/[tripId]/expenses.'
      );
    case STATIC_ROUTE_PATTERN:
      return (
        'A nav destination is a route with NO [param] segment — navigation goes to a list page, ' +
        'and a row action carries the id from there.'
      );
    case IDENT_PATTERN:
      return 'Expected a plain name: letters, digits and _, starting with a letter or _ (no spaces, dashes, dots or slashes).';
    case AGENT_NAME_PATTERN:
      return 'An agent is a slug from the project\'s space — letters, digits, _ and - (pantry-keeper, sous, data-modeler).';
    case TYPEREF_PATTERN:
      return 'A prop type is a type NAME, optionally an array: string, number, boolean, Recipe, Recipe[].';
    case BINDING_PATTERN:
    case VALUE_PATTERN:
      return BINDING_ROOTS_HELP.sentence;
    default: {
      const described = typeof parent?.['description'] === 'string' ? ` ${String(parent['description'])}` : '';
      return `Expected the form /${pattern}/.${described}`;
    }
  }
}

/** The property menu of the schema an error was measured against. */
function propertiesOf(schema: JsonSchema | undefined): string[] {
  const props = schema?.['properties'];
  return props && typeof props === 'object' ? Object.keys(props as Record<string, unknown>) : [];
}

/**
 * Turn one ajv failure into a menu-shaped {@link ViewError}.
 *
 * `discriminator: true` is what makes this tractable: with a discriminated `oneOf`, ajv reports
 * the errors of the ONE branch whose `kind`/`el` matched, so `parentSchema` here is the *create
 * section*'s schema — and its property list is the real menu — rather than a pile of eight
 * branches' failures with no menu at all.
 */
export function shapeErrorToViewError(raw: unknown): ViewError {
  const e = raw as VerboseError;
  const path = prettyPath(e.instancePath);
  const p = e.params ?? {};

  switch (e.keyword) {
    case 'additionalProperties': {
      const bad = String(p['additionalProperty'] ?? '');
      const allowed = propertiesOf(e.parentSchema);
      return err(
        'shape',
        path,
        at(path, `"${bad}" is not a property here. ${didYouMean(bad, allowed)}${menu('Properties', allowed)}`),
      );
    }
    case 'required': {
      const missing = String(p['missingProperty'] ?? '');
      const allowed = propertiesOf(e.parentSchema);
      return err(
        'shape',
        path,
        at(path, `"${missing}" is required here. ${menu('Properties', allowed)}`),
      );
    }
    case 'enum': {
      const allowed = (p['allowedValues'] as unknown[] | undefined)?.map(String) ?? [];
      const bad = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
      return err(
        'shape',
        path,
        at(path, `${bad} is not allowed here. ${didYouMean(String(e.data ?? ''), allowed)}${menu('Allowed', allowed)}`),
      );
    }
    case 'discriminator': {
      const tag = String(p['tag'] ?? 'kind');
      const bad = String(p['tagValue'] ?? e.data ?? '');
      return err('shape', path, at(path, `"${bad}" is not a valid ${tag}.`));
    }
    case 'discriminantChoice': {
      const discriminants = (p['discriminants'] as string[] | undefined) ?? [];
      const present = (p['present'] as string[] | undefined) ?? [];
      const chosen = present.filter((k) => discriminants.includes(k));
      const said =
        chosen.length >= 2
          ? `"${chosen.join('" and "')}" — pick exactly ONE of these, not several.`
          : (() => {
              const bad = present.find((k) => !discriminants.includes(k)) ?? present[0];
              return bad ? `"${bad}" does not choose one.` : 'this does not choose one.';
            })();
      return err('shape', path, at(path, `${said} ${menu('Set exactly one key', discriminants)}`));
    }
    case 'pattern': {
      const value = typeof e.data === 'string' ? e.data : String(e.data);
      if (value.startsWith('$') || value.includes('{{') || value.includes('${')) {
        return classifyBadBinding(value) === 'expression'
          ? expressionAttempt(path, value)
          : badBindingRoot(path, value);
      }
      return err('shape', path, at(path, `"${value}" is not valid here. ${patternHelp(String(p['pattern'] ?? ''), e.parentSchema)}`));
    }
    case 'type': {
      // `type` is a LIST wherever a slot takes more than one (an `arg` is string|number|boolean),
      // and `String(['string','number','boolean'])` renders it as `string,number,boolean` — which
      // reads as one exotic type name rather than a choice of three.
      const types = p['type'];
      const want = Array.isArray(types) ? types.map(String).join(', ') : String(types ?? '');
      const got = Array.isArray(e.data) ? 'array' : e.data === null ? 'null' : typeof e.data;
      return err('shape', path, at(path, `expected ${want}, got ${got} (${JSON.stringify(e.data)}).`));
    }
    default:
      return err('shape', path, at(path, `${e.message ?? 'is invalid'}.`));
  }
}

/**
 * Keywords that describe the SHAPE OF THE SCHEMA rather than the model's mistake. ajv emits one
 * per composition level, so a single bad string inside a union inside a conditional arrives as
 * five errors, four of which say "must match exactly one schema in oneOf" — the exact opposite of
 * a menu.
 */
const STRUCTURAL_KEYWORDS = new Set(['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', 'not']);

/** How informative a keyword's message is. Higher wins when several fire at one path. */
const KEYWORD_RANK: Record<string, number> = {
  pattern: 5,
  enum: 5,
  additionalProperties: 4,
  required: 4,
  discriminator: 3,
  type: 1,
};

/**
 * A union where every branch requires exactly one, distinct key — `Action`'s five verbs
 * (`mutate` / `navigate` / `download` / `print` / `copy`) are the paradigm case. Returns those
 * keys, or `undefined` when the union is not this shape (a branch has zero or >1 required keys,
 * or two branches share one — then "none matched" is not actually informative).
 */
function discriminantKeysOf(branches: readonly unknown[]): string[] | undefined {
  const keys: string[] = [];
  for (const b of branches) {
    const required = (b as Record<string, unknown> | null)?.['required'];
    if (!Array.isArray(required) || required.length !== 1) return undefined;
    keys.push(String(required[0]));
  }
  return new Set(keys).size === keys.length ? keys : undefined;
}

/**
 * Drop the branches of a union the model was NOT writing.
 *
 * `Action` is `oneOf: [{required:['mutate']}, {required:['navigate']}, {required:['download']}, …]`
 * with `additionalProperties: false` on every branch, so ONE bad key inside a `{ mutate }` action
 * produces the real error plus one *"`mutate` is not a property here"* per sibling branch — seven
 * lines of debris around one line of signal. The debris is not merely noisy, it is **actively
 * wrong**: a model that reads "`mutate` is not a property here" concludes `mutate` is illegal in a
 * `rowAction` and rewrites it as a `navigate`, silently deleting the feature. Measured in T1.
 *
 * The branch the model MEANT is not ambiguous — each branch is keyed by its own discriminant
 * (`mutate` / `navigate` / `download` / `print` / `copy`) and exactly one of those keys is present
 * in the data. Keeping only that branch's errors leaves the sentence that names the actual offence.
 *
 * TWO more cases, both found live (T3, bucket 2 — the class that never converged): **zero**
 * discriminants present (`{ endpoint: 'doThing' }`, a key naming none of the five verbs) and
 * **two or more** present at once (`{ mutate: …, navigate: … }`). Neither is actually ambiguous —
 * zero is the single clearest case of all, and two-at-once names its own two offending keys — but
 * both used to fall through untouched and left five *"required"* + N *"not a property"* lines that
 * directly contradict each other (one line says `mutate` is required, its sibling says `mutate` is
 * not a property). When the union is a clean one-required-key-per-branch shape
 * ({@link discriminantKeysOf}), replace the whole pile with ONE synthetic `discriminantChoice`
 * finding naming the actual offence (the bogus key, or the too-many keys) and the real menu.
 */
function pruneUnionBranches(raw: readonly unknown[]): readonly unknown[] {
  const drops: { instancePath: string; prefix: string; keep: number }[] = [];
  const replaced: { instancePath: string; prefix: string }[] = [];
  const synthesized: VerboseError[] = [];
  for (const e of raw as VerboseError[]) {
    if (e.keyword !== 'oneOf' && e.keyword !== 'anyOf') continue;
    const branches = (e.parentSchema as Record<string, unknown> | undefined)?.[e.keyword];
    if (!Array.isArray(branches)) continue;
    const data = e.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const present = new Set(Object.keys(data as Record<string, unknown>));
    const matched: number[] = [];
    branches.forEach((b, i) => {
      const required = (b as Record<string, unknown> | null)?.['required'];
      if (Array.isArray(required) && required.length && required.every((k) => present.has(String(k)))) {
        matched.push(i);
      }
    });
    if (matched.length === 1) {
      drops.push({ instancePath: e.instancePath, prefix: e.schemaPath, keep: matched[0]! });
      continue;
    }
    const discriminants = discriminantKeysOf(branches);
    if (!discriminants) continue;
    replaced.push({ instancePath: e.instancePath, prefix: e.schemaPath });
    synthesized.push({
      instancePath: e.instancePath,
      schemaPath: e.schemaPath,
      keyword: 'discriminantChoice',
      params: { discriminants, present: [...present] },
    });
  }
  if (drops.length === 0 && replaced.length === 0) return raw;
  const kept = (raw as VerboseError[]).filter((e) => {
    for (const d of drops) {
      if (!e.instancePath.startsWith(d.instancePath)) continue;
      if (!e.schemaPath.startsWith(`${d.prefix}/`)) continue;
      const branch = /^\/(\d+)(?:\/|$)/.exec(e.schemaPath.slice(d.prefix.length))?.[1];
      if (branch !== undefined && Number(branch) !== d.keep) return false;
    }
    for (const r of replaced) {
      if (e.instancePath === r.instancePath && e.schemaPath.startsWith(`${r.prefix}/`)) return false;
    }
    return true;
  });
  return [...kept, ...synthesized];
}

/**
 * Reduce ajv's error list to **one finding per instance path**, keeping the most informative.
 *
 * The union-typed slots make this necessary rather than cosmetic. `title: '$.price * $.qty'` fails
 * the string branch's `pattern` AND the object branch's `type` AND the union AND the enclosing
 * `if/then` — five errors for one mistake, only the first of which the model can act on. Dropping
 * the structural ones and keeping the highest-ranked keyword per path leaves exactly the sentence
 * that names the offence.
 *
 * {@link pruneUnionBranches} runs FIRST, because per-path ranking cannot fix a discriminated union:
 * every branch fails at the same path, so the surviving errors would still be one real finding and
 * N contradictory ones.
 */
export function shapeErrorsToViewErrors(rawInput: readonly unknown[]): ViewError[] {
  const raw = pruneUnionBranches(rawInput);
  const best = new Map<string, { rank: number; error: unknown }>();
  for (const e of raw) {
    const v = e as VerboseError;
    if (STRUCTURAL_KEYWORDS.has(v.keyword)) continue;
    const key = `${v.instancePath}\u0000${v.keyword === 'additionalProperties' ? String(v.params?.['additionalProperty']) : v.keyword === 'required' ? String(v.params?.['missingProperty']) : ''}`;
    const rank = KEYWORD_RANK[v.keyword] ?? 2;
    const prev = best.get(key);
    if (!prev || rank > prev.rank) best.set(key, { rank, error: e });
  }
  // Nothing survived the filter (a pure `oneOf` failure) — fall back rather than report clean.
  if (best.size === 0 && raw.length > 0) return [shapeErrorToViewError(raw[0])];
  return [...best.values()].map((b) => shapeErrorToViewError(b.error));
}

export { err as viewError, warn as viewWarning };
