/**
 * **The three view-spec validators** — deterministic HOST checks on what the agent creates.
 *
 * All three return a structured finding list. That is the design, not a style choice: a build
 * gate whose verdict is the model's own summary of its work is not a gate (the appbuilder's
 * measured failures — `built: true` on a dead app, a dashboard rendering €0 over a populated db —
 * are all cases where nothing ever *ran* the thing it approved). Exit status is ground truth, the
 * same philosophy as `buildApp` and `smoke_endpoints`.
 *
 * | function | when | what only IT can catch |
 * |---|---|---|
 * | {@link validateViewSpec} | save time, inside the writer | a wrong name / binding / prop, while the model is still holding the page |
 * | {@link validateAppViews} | after implementation | app-wide facts one page cannot see: an unreachable page, a dead component, a nav target that is not a route |
 * | {@link renderSmokeViews} | after seeding | that the page is *empty against real data* — structurally perfect, semantically nothing |
 *
 * The writer, the space's tasklist nodes and the tests all call THESE functions. There is
 * deliberately no second copy of the rules in a prompt: a rule that lives in prose is a rule the
 * model can talk its way past, and a rule in two places is a rule that will disagree with itself.
 *
 * ## What is checked, and what is deliberately not
 *
 * Checked: shape (ajv, via `schema.ts`), endpoint name + method resolution, input-key resolution,
 * `$.field` resolution against the endpoint's Output, binding roots and their legal contexts,
 * component references and their props (including cycles), section-id targets (`reveals`,
 * `$data.<id>`), and route targets (`navigate`, nav, subnav).
 *
 * NOT checked, on purpose: a binding's scope inside a repeater is resolved against the **union**
 * of the endpoint's top-level and row fields rather than exactly. Being precise there would need
 * a type checker over JSON Schema, and the failure mode of getting it wrong is a REJECTED SPEC
 * THAT WOULD HAVE WORKED — the one outcome a save-time gate must never produce. The union still
 * catches the whole typo class (`$.titel`), which is what the evidence says actually happens.
 *
 * @see `./messages.ts` — every rejection's text, which is part of the model interface.
 * @see `./schema.ts` — the pinned shape contract these run first.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { EndpointContract } from '../build/schema.js';
import { braceBody } from '../authoring/lint.js';
import { loadProjectViews, viewSpecPath } from './files.js';
import {
  alwaysNullBinding,
  badBindingRoot,
  badProp,
  classifyBadBinding,
  deadComponent,
  emptyForm,
  emptyRender,
  emptySection,
  expressionAttempt,
  malformedArtifact,
  orphanRoute,
  pageHasNoData,
  prettyPath,
  renderThrew,
  resultOf,
  shapeErrorsToViewErrors,
  unknownAgent,
  unknownComponent,
  unknownEndpoint,
  unknownField,
  unknownInput,
  unknownRoute,
  unknownSection,
  unknownSpace,
  viewError,
  wrongArity,
  wrongMethod,
  type ViewError,
  type ViewValidationResult,
} from './messages.js';
import {
  isBinding,
  looksLikeExpression,
  validateShellShape,
  validateViewComponentShape,
  validateViewSpecShape,
  type JsonSchema,
  type SectionSpec,
  type ShellSpec,
  type ViewComponentSpec,
  type ViewSpec,
} from './schema.js';

export type { ViewError, ViewErrorCode, ViewValidationResult } from './messages.js';

// ──────────────────────────────────────────────────────────────────────────────
// 1. The project vocabulary a spec resolves against
// ──────────────────────────────────────────────────────────────────────────────

/**
 * One endpoint, reduced to what a spec can refer to.
 *
 * `outputFields`/`inputKeys` are `undefined` — never `[]` — when they could not be determined.
 * The distinction is load-bearing: an empty list means "this endpoint declares no Output", which
 * makes every binding an error, and a save-time gate that cannot tell the two apart rejects
 * working specs the moment a contract is stale.
 */
export interface ViewEndpoint {
  name: string;
  method: string;
  /** Bindable Output field names: top level ∪ one array level (the `{ items: T[] }` convention). */
  outputFields?: string[];
  /** Declared Input property names. */
  inputKeys?: string[];
  /** The full Output JSON Schema, when available — lets a `from` path resolve exactly. */
  outputSchema?: JsonSchema;
  /**
   * Rows or a record? See {@link OutputShape}. `undefined` ⇒ unknown, and nothing is checked.
   *
   * Carried as a FIELD rather than derived from `outputSchema` on demand, because the writers' sync
   * contract source has no schema at all and reads this from the handler's TypeScript instead — and
   * a rule that fired only where a schema exists would make the writer and `validateAppViews`
   * disagree about the same page.
   */
  outputShape?: OutputShape;
  /**
   * The handler's route pattern (`/plan/:id/trip`), when known.
   *
   * Only {@link renderSmokeViews} reads it, and it needs it for one thing: an `:id` in a path
   * belongs to the collection ABOVE it, so the value for `/plan/:id/trip` comes from `/plan` and
   * never from `/pantry`. Without the path there is no way to tell two `id`s apart by name alone.
   */
  routePath?: string;
}

/**
 * The SHAPE of an endpoint's Output, as far as it could be read — the fact a section's kind has to
 * agree with.
 *
 * The renderer splits on exactly this (`libs/ui/src/view/sections/index.tsx`): `list`/`timeline` go
 * to the collection half and read `extractRows`, every other kind reads `extractRecord`. So:
 *
 * | shape | `Output` | rows | one record |
 * |---|---|---|---|
 * | `array` | `Recipe[]` | the array | element **0**, whichever row that is |
 * | `envelope` | `{ items: Recipe[] }`, `{ plan, days: Day[] }` | the array property | the object, or its sole wrapped element |
 * | `record` | `{ total: number; spent: number }` | **nothing, ever** | the object |
 *
 * `undefined` is the fourth answer and the common one: a union Output, a `Record<string, …>`, a
 * member this reader cannot type. It means "say nothing", never "record".
 */
export type OutputShape = 'array' | 'envelope' | 'record';

/** Everything outside a single spec that the spec is allowed to name. */
export interface ViewContracts {
  endpoints: ViewEndpoint[];
  /** The app's view components. Absent ⇒ `{ use: … }` references are not resolved. */
  components?: ViewComponentSpec[];
  /** Every authoring route the app has. Absent ⇒ `navigate`/nav targets are not resolved. */
  routes?: string[];
  /**
   * The agents each of the project's spaces defines — `space` → slugs, from
   * {@link loadProjectAgents}. Absent ⇒ `chat.agent` is not resolved.
   */
  agents?: Record<string, string[]>;
  /**
   * Is {@link routes} the app's FINAL route list?
   *
   * `false` at SAVE time and nowhere else. A page is written one at a time, so `recipes` linking to
   * `recipes/[id]` and `recipes/[id]` linking back to `recipes` is a pair no write order satisfies:
   * whichever lands first names a route that does not exist yet. Hard-failing there is a writer that
   * cannot be satisfied — the T1 migration needed a throwaway 13-write bootstrap pass to get past it.
   * So an unknown route is a WARNING while the app is being written, and an error once it is whole
   * ({@link validateAppViews} re-runs the identical check against every route on disk).
   *
   * Absent ⇒ `true`, so a caller that says nothing gets the strict check.
   */
  routesComplete?: boolean;
}

/** `ProjectContracts`-shaped input — what `generateProjectContracts` returns. */
interface ContractsLike {
  endpoints: (EndpointContract | ViewEndpoint)[];
  components?: ViewComponentSpec[];
  routes?: string[];
}

/**
 * Resolve a `#/definitions/Recipe` pointer against the schema document it came from.
 *
 * `ts-json-schema-generator` emits a `$ref` for every NAMED type, which makes this mandatory
 * rather than thorough: `export type Output = Recipe[]` — the commonest Output shape in the
 * catalogue — generates `{ type: 'array', items: { $ref: '#/definitions/Recipe' }, definitions: … }`,
 * whose root property names are `type`/`items`/`definitions`. A reader that does not follow the
 * pointer sees ZERO bindable fields there and rejects every `$.field` on the endpoint.
 */
function derefSchema(node: unknown, root: unknown, seen: Set<string> = new Set()): unknown {
  let cur = node;
  while (cur && typeof cur === 'object') {
    const ref = (cur as Record<string, unknown>)['$ref'];
    if (typeof ref !== 'string' || !ref.startsWith('#')) return cur;
    if (seen.has(ref)) return undefined; // a self-referential type — stop rather than spin
    seen.add(ref);
    let target: unknown = root;
    for (const raw of ref.slice(1).split('/')) {
      if (!raw) continue;
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object') return undefined;
      target = (target as Record<string, unknown>)[key];
    }
    cur = target;
  }
  return cur;
}

/** Object properties of a JSON Schema, seeing through `$ref` and `anyOf`/`oneOf`/`allOf`. */
function schemaProps(s: unknown, root: unknown = s): Record<string, JsonSchema> {
  const node = derefSchema(s, root);
  if (!node || typeof node !== 'object') return {};
  const rec = node as Record<string, unknown>;
  if (rec['properties'] && typeof rec['properties'] === 'object') {
    return rec['properties'] as Record<string, JsonSchema>;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = rec[key];
    if (!Array.isArray(branches)) continue;
    const merged: Record<string, JsonSchema> = {};
    for (const b of branches) Object.assign(merged, schemaProps(b, root));
    if (Object.keys(merged).length) return merged;
  }
  return {};
}

/** The element schema of an array schema, with both the array and the element de-`$ref`ed. */
function itemsOf(s: unknown, root: unknown = s): JsonSchema | undefined {
  const node = derefSchema(s, root) as Record<string, unknown> | undefined;
  const items = node?.['items'];
  if (!items || typeof items !== 'object' || Array.isArray(items)) return undefined;
  const el = derefSchema(items, root);
  return el && typeof el === 'object' ? (el as JsonSchema) : undefined;
}

/**
 * The field names a section bound to this Output may legally use, or `undefined` when the Output
 * yields none.
 *
 * The union of three things, because a section binds in two scopes and the schema cannot tell us
 * which one a given `$.x` sits in without a type checker: the Output's own properties, the
 * element properties when the Output IS an array, and the element properties of each array-valued
 * property (`{ items: Recipe[] }` — the shape 5/5 catalogue apps' list endpoints return).
 *
 * **An empty universe is returned as `undefined`, never `[]`** — the invariant {@link ViewEndpoint}
 * states. `EndpointContract` uses an empty-object schema both for "declares no Output" and for
 * "we could not read one", so `[]` here cannot be distinguished from a read failure, and a gate
 * that guesses wrong rejects a page that works.
 */
export function outputFieldUniverse(schema: unknown): string[] | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = new Set<string>();
  const top = schemaProps(schema, schema);
  for (const k of Object.keys(top)) out.add(k);
  for (const k of Object.keys(schemaProps(itemsOf(schema, schema), schema))) out.add(k);
  for (const v of Object.values(top)) {
    for (const k of Object.keys(schemaProps(itemsOf(v, schema), schema))) out.add(k);
  }
  return out.size ? [...out].sort() : undefined;
}

/**
 * Read an Output JSON Schema's {@link OutputShape}, or `undefined` when it is not decidable.
 *
 * Deliberately timid at every branch. A union root, a property this cannot resolve to a typed node,
 * an object with no readable properties: all `undefined`, because the only finding built on this is
 * a REJECTION, and the cost of guessing "record" about something that is really an envelope is a
 * working list section refused at save.
 */
export function outputShapeOf(schema: unknown): OutputShape | undefined {
  const isArrayNode = (n: unknown): boolean => {
    const d = derefSchema(n, schema) as Record<string, unknown> | undefined;
    if (!d || typeof d !== 'object') return false;
    const t = d['type'];
    if (t === 'array' || (Array.isArray(t) && t.includes('array')) || d['items'] !== undefined) return true;
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = d[key];
      if (Array.isArray(branches) && branches.some(isArrayNode)) return true;
    }
    return false;
  };

  const root = derefSchema(schema, schema);
  if (!root || typeof root !== 'object') return undefined;
  const rec = root as Record<string, unknown>;
  // A union root is two shapes at once — the renderer picks per response, and so cannot this.
  // Asked FIRST: `Job[] | JobPage` has an array branch, and reading that as "an array" would reject
  // a record section over an Output that is a record half the time.
  if (rec['anyOf'] || rec['oneOf'] || rec['allOf']) return undefined;
  if (isArrayNode(root)) return 'array';
  const props = schemaProps(root, schema);
  const keys = Object.keys(props);
  // `{}` (unread), `{ type: 'object' }`, `Record<string, X>` — an object whose properties are not
  // enumerable could hold an array under any key.
  if (!keys.length || rec['additionalProperties'] === true) return undefined;
  for (const key of keys) {
    if (isArrayNode(props[key])) return 'envelope';
    const node = derefSchema(props[key], schema) as Record<string, unknown> | undefined;
    if (!node || typeof node !== 'object') return undefined;
    // A property with no type at all is `unknown`/`any` in the handler — it may hold an array.
    const typed = ['type', 'properties', 'enum', 'const', 'anyOf', 'oneOf'].some((k) => node[k] !== undefined);
    if (!typed) return undefined;
  }
  return 'record';
}

/** Walk a dotted path (`citations.author`) into a schema, seeing through arrays and `$ref`s. */
function schemaAtPath(schema: unknown, segments: string[]): JsonSchema | undefined {
  let cur: unknown = schema;
  for (const seg of segments) {
    const key = seg.replace(/\[\d+\]$/, '');
    const next = schemaProps(cur, schema)[key] ?? schemaProps(itemsOf(cur, schema), schema)[key];
    if (!next) return undefined;
    cur = next;
  }
  // Carry the ROOT's `definitions` onto the sub-schema: a `$ref` inside it still points at
  // `#/definitions/…` of the document it was cut out of, and a naked branch cannot resolve one.
  const defs = (schema as Record<string, unknown> | undefined)?.['definitions'];
  if (defs && cur && typeof cur === 'object' && !('definitions' in (cur as object))) {
    return { ...(cur as JsonSchema), definitions: defs } as JsonSchema;
  }
  return cur as JsonSchema | undefined;
}

/**
 * Has this endpoint already been through {@link toViewContracts}?
 *
 * The reduced form KEEPS `outputSchema` (a `from` path needs the real schema) and DROPS
 * `inputSchema`, so "carries a schema" cannot tell the two forms apart. A second reduction that
 * took the raw branch would recompute `inputKeys` from the `inputSchema` that is no longer there
 * and get `[]` — the one value {@link ViewEndpoint} forbids, and the one that makes every `input`
 * key on every section of every page report as undeclared. The reduced-only keys are the
 * discriminant, and they are always written (as `undefined` when unknown) so `in` sees them.
 */
function isReducedEndpoint(ep: object): boolean {
  return 'outputFields' in ep || 'inputKeys' in ep || !('inputSchema' in ep);
}

/**
 * Accept either `ProjectContracts` (raw JSON Schemas) or an already-reduced {@link ViewContracts}.
 *
 * **Idempotent, and tested to be.** `validateAppViews` reduces once and then hands the result to
 * `validateViewSpec`, which reduces again; a reduction that is not the identity on its own output
 * silently changes the vocabulary between the two, which is exactly the bug this guard exists for.
 */
export function toViewContracts(input: ContractsLike | ViewContracts): ViewContracts {
  const endpoints = input.endpoints.map((ep): ViewEndpoint => {
    if (isReducedEndpoint(ep)) return ep as ViewEndpoint;
    const full = ep as EndpointContract;
    const inputKeys = Object.keys(schemaProps(full.inputSchema, full.inputSchema));
    return {
      name: full.name,
      method: full.method,
      routePath: full.routePath,
      outputSchema: full.outputSchema,
      outputFields: outputFieldUniverse(full.outputSchema),
      outputShape: outputShapeOf(full.outputSchema),
      inputKeys,
    };
  });
  return {
    endpoints,
    components: input.components,
    routes: input.routes,
    agents: (input as ViewContracts).agents,
    routesComplete: (input as ViewContracts).routesComplete,
  };
}

/**
 * The agents a project's spaces define — `spaces/<space>/agents/<slug>/`.
 *
 * The check that actually has value on `chat.agent`. Widening the *pattern* to accept a kebab-case
 * slug only keeps a URL or a sentence out of the field; it cannot tell a model that `optimiser` is
 * not `optimizer`, which is the mistake that costs a chat dock. Names resolve against a real menu
 * here for the same reason `query` and `mutation` do.
 *
 * Returns `undefined` — never `{}` — when the project has no `spaces/` dir, so an app whose agents
 * live somewhere this cannot see skips the check rather than failing it.
 */
export function loadProjectAgents(projectRoot: string): Record<string, string[]> | undefined {
  const spacesDir = join(projectRoot, 'spaces');
  if (!existsSync(spacesDir)) return undefined;
  const out: Record<string, string[]> = {};
  let spaces: string[];
  try {
    spaces = readdirSync(spacesDir);
  } catch {
    return undefined;
  }
  for (const space of spaces.sort()) {
    const agentsDir = join(spacesDir, space, 'agents');
    try {
      if (!statSync(join(spacesDir, space)).isDirectory()) continue;
      out[space] = readdirSync(agentsDir)
        .filter((a) => !a.startsWith('.') && statSync(join(agentsDir, a)).isDirectory())
        .sort();
    } catch {
      out[space] = [];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// ── the sync, best-effort contract source the WRITERS use ─────────────────────

const METHOD_FILE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/** `export const name = 'listRecipes'` → `listRecipes`. */
function exportedName(src: string): string | undefined {
  return /export\s+const\s+name\s*=\s*['"`]([^'"`]+)['"`]/.exec(src)?.[1];
}

/** One member of an interface body: its name, and the raw text of its declared type. */
interface InterfaceMember {
  key: string;
  /** Everything after the `:`, up to the member's top-level terminator. */
  type: string;
}

/** TS types whose element contributes no field names, so a named reference to one is not a gap. */
const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'never',
  'any',
  'unknown',
  'object',
  'Date',
]);

/**
 * Is this member's declared type an ARRAY whose element we cannot see the fields of?
 *
 * The one case that matters, because {@link outputFieldUniverse} unions in the element properties
 * of every array-valued property. `days: DayTotal[]` therefore contributes `day`/`calories`/… to
 * the async universe and NOTHING to a textual read — which is how the writer told T1 that `"$.day"
 * is not a field… Did you mean $.days?` about a field of the very array the section was sourced
 * from. A non-array named type (`plan: MealPlan`) is NOT a gap: the async universe does not
 * descend into it either, so the two readers agree.
 */
function opaqueArrayElement(type: string, known: Map<string, string>): boolean {
  const bare = type
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\|\s*(null|undefined)\b/g, '')
    .trim();
  if (bare.includes('{')) return false; // an inline element type — readable, handled below
  const named = /(?:^|[\s|(])([A-Za-z_$][\w$]*)\s*\[\s*\]/.exec(bare)?.[1] ?? /\bArray<\s*([A-Za-z_$][\w$]*)\s*>/.exec(bare)?.[1];
  if (!named) return false;
  return !PRIMITIVE_TYPES.has(named) && !known.has(named);
}

/** Every `interface X { … }` / `type X = { … }` block in a source file, by name. */
function namedTypeBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:^|\n)\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\b[^{;\n]*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const body = braceBody(src, m.index + m[0].length - 1);
    if (body !== null && !out.has(m[1]!)) out.set(m[1]!, body);
  }
  return out;
}

/**
 * Field names of an `export interface X { … }` / `export type X = { … }` block, one nesting level
 * deep — the textual twin of {@link outputFieldUniverse}.
 *
 * A regex where the async path has a real JSON Schema, because the writers are SYNCHRONOUS host
 * globals (mirroring `writeProjectPage`) and `generateProjectContracts` is a `ts-json-schema-
 * generator` run per handler file.
 *
 * **`undefined` whenever the list would be INCOMPLETE**, and never a partial one. A partial menu is
 * worse than no menu: it rejects, and it rejects with confident advice. The original read
 * `days: DayTotal[]` as the single field `days` and told the model `"$.day" is not a field… Did you
 * mean $.days?` — about a field the app-wide gate accepts, on the endpoint the section is sourced
 * from. Two escapes from that: a named element type declared IN THIS FILE is expanded (which is
 * why the endpoint author need not inline it), and anything still unreadable returns `undefined`,
 * which means "skip the field check" and never "reject".
 */
function declaredFields(src: string, typeName: 'Input' | 'Output'): string[] | undefined {
  const known = namedTypeBodies(src);
  // `[^{;\n]*` and not `[^{]*`: `export type Output = RecipeList;` has no brace of its own, and a
  // greedier scan would walk past the semicolon into the handler body and report ITS locals as
  // Output fields — a menu that is confidently wrong.
  const m = new RegExp(`export\\s+(?:interface|type)\\s+${typeName}\\b[^{;\\n]*\\{`).exec(src);
  let body: string | null = null;
  if (m) {
    // `interface Input extends Base {…}` / `type Input = Base & {…}` — the braces hold only the
    // members declared HERE. Reading them as the whole set is the failure mode this function is
    // built to avoid twice over: as a field menu it rejects a binding Base declares, and as an
    // Input list it reports "no fields at all" for a form that derives several.
    if (/\bextends\b|&/.test(m[0])) return undefined;
    body = braceBody(src, m.index + m[0].length - 1);
  } else {
    // `export type Output = Recipe[];` / `= Recipe;` — resolvable when the type is in this file.
    const alias = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([^;\\n]+)`).exec(src)?.[1]?.trim();
    const named = alias ? (/^([A-Za-z_$][\w$]*)\s*(?:\[\s*\])?$/.exec(alias)?.[1] ?? undefined) : undefined;
    body = named ? (known.get(named) ?? null) : null;
  }
  if (body === null) return undefined;

  const members = interfaceMembers(body);
  const out = new Set(members.map((mem) => mem.key));
  for (const mem of members) {
    if (opaqueArrayElement(mem.type, known)) return undefined;
    // One level in: `items: { id: string; title: string }[]` contributes id/title, and so does
    // `lines: TripLine[]` when `TripLine` is declared beside the handler.
    const brace = mem.type.indexOf('{');
    const nested =
      brace >= 0
        ? braceBody(mem.type, brace)
        : (known.get(/(?:^|[\s|(])([A-Za-z_$][\w$]*)\s*\[\s*\]/.exec(mem.type)?.[1] ?? '') ?? null);
    if (nested) for (const k of interfaceMembers(nested).map((n) => n.key)) out.add(k);
  }
  // `[]` here means "read, and it declares nothing" — a real answer for an `Input {}`. Only the
  // OUTPUT side collapses that to `undefined` (see {@link loadViewContracts}), because an Output
  // that reads as empty is indistinguishable from one that failed to read.
  return [...out].sort();
}

/**
 * Top-level members of a TS **interface** body, name and declared type.
 *
 * `lint.ts#topLevelKeys` reads an object LITERAL, whose members are comma-separated; an interface
 * separates with `;` or a newline, so that function stops after the first member here. Same shape,
 * different separator set — and a field list that silently contains one entry would turn every
 * subsequent binding into a menu-shaped lie.
 */
function interfaceMembers(body: string): InterfaceMember[] {
  const members: InterfaceMember[] = [];
  let depth = 0;
  let atKey = true;
  let open: { key: string; from: number } | undefined;
  const close = (end: number): void => {
    if (!open) return;
    members.push({ key: open.key, type: body.slice(open.from, end) });
    open = undefined;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      continue;
    }
    if (depth === 0 && (c === ';' || c === ',' || c === '\n')) {
      close(i);
      atKey = true;
      continue;
    }
    if (depth !== 0 || !atKey) continue;
    const m = /^\s*(?:readonly\s+)?(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z_$][\w$]*))\s*\??\s*:/.exec(
      body.slice(i),
    );
    if (m) {
      close(i);
      open = { key: (m[1] ?? m[2] ?? m[3])!, from: i + m[0].length };
      i += m[0].length - 1;
      atKey = false;
    } else if (!/\s/.test(c)) {
      atKey = false;
    }
  }
  close(body.length);
  return members;
}

/** Every `type X = <text>;` alias in a source file — the half {@link namedTypeBodies} cannot hold. */
function namedTypeAliases(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([^;{\n][^;\n]*);?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** Scalar member types — the only ones that provably are not an array. */
const SCALAR_TYPE = /^(string|number|boolean|bigint|Date|null|undefined)(\s*\|\s*(string|number|boolean|bigint|Date|null|undefined))*$/;

/** Strip comments and an optional-null suffix, so a type reads as its bare text. */
function bareType(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
}

/**
 * The textual twin of {@link outputShapeOf} — the shape a handler's `Output` declares, read from its
 * TypeScript, for the SYNCHRONOUS contract source the writers use.
 *
 * `export type Output = Job[]` is the whole point: it is the commonest list-endpoint declaration in
 * the catalogue, it takes one regex to read, and it is what makes a `stats` section bound to a list
 * endpoint a save-time rejection rather than a dashboard of bare headings.
 *
 * Everything else is timid in the same way the JSON-Schema reader is: a union, a member whose type
 * is a name this file does not declare, an empty body — all `undefined`. A record is claimed ONLY
 * when every member is provably scalar, because "no array anywhere" is the half that rejects a
 * `list`.
 */
function declaredOutputShape(src: string): OutputShape | undefined {
  const objects = namedTypeBodies(src);
  const aliases = namedTypeAliases(src);

  const ofBody = (body: string | null, seen: Set<string>): OutputShape | undefined => {
    if (body === null) return undefined;
    const members = interfaceMembers(body);
    if (!members.length) return undefined;
    for (const member of members) {
      const type = bareType(member.type);
      if (ofText(type, new Set(seen)) === 'array') return 'envelope';
      if (!SCALAR_TYPE.test(type) && !type.startsWith('{')) return undefined;
    }
    return 'record';
  };

  const ofText = (raw: string, seen: Set<string>): OutputShape | undefined => {
    const text = bareType(raw);
    if (!text) return undefined;
    if (/\[\s*\]$/.test(text) || /^(Readonly)?Array\s*</.test(text)) return 'array';
    if (/[|&<>]/.test(text)) return undefined; // a union, an intersection, a generic — undecidable
    if (text.startsWith('{')) return ofBody(braceBody(text, 0), seen);
    const named = /^[A-Za-z_$][\w$]*$/.exec(text)?.[0];
    if (!named || seen.has(named) || PRIMITIVE_TYPES.has(named)) return undefined;
    seen.add(named);
    const body = objects.get(named);
    if (body !== undefined) return ofBody(body, seen);
    const alias = aliases.get(named);
    return alias === undefined ? undefined : ofText(alias, seen);
  };

  const m = /export\s+(?:interface|type)\s+Output\b([^{;\n]*)\{/.exec(src);
  if (m) {
    if (/\bextends\b|&/.test(m[1]!)) return undefined; // members live somewhere this cannot see
    return ofBody(braceBody(src, m.index + m[0].length - 1), new Set());
  }
  const alias = /export\s+type\s+Output\s*=\s*([^;\n]+)/.exec(src)?.[1];
  return alias === undefined ? undefined : ofText(alias, new Set());
}

/** Recursively collect `api/**\/<METHOD>.ts`. */
function walkApi(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkApi(abs, out);
    else if (METHOD_FILE.test(entry)) out.push(abs);
  }
}

/**
 * Read a project's spec vocabulary **synchronously** — endpoints from `api/**`, components and
 * routes from `pages/**`. This is what {@link validateViewSpec} runs against inside the writer.
 *
 * Fidelity is intentionally lower than the async path (`generateProjectContracts`): names and
 * methods are exact, fields are a textual best effort. Every check degrades to "skipped" rather
 * than "failed" when its input is missing.
 */
export function loadViewContracts(projectRoot: string): ViewContracts {
  const files: string[] = [];
  const apiDir = join(projectRoot, 'api');
  if (existsSync(apiDir)) walkApi(apiDir, files);

  const endpoints: ViewEndpoint[] = [];
  for (const file of files.sort()) {
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const name = exportedName(src);
    if (!name) continue;
    const outputFields = declaredFields(src, 'Output');
    endpoints.push({
      name,
      method: relative(apiDir, file).split(sep).pop()!.replace(/\.ts$/, ''),
      // An Output that reads as zero fields is either "declares nothing" or "we failed to read it",
      // and nothing here can tell those apart — so it becomes `undefined` (skip), never `[]` (reject).
      outputFields: outputFields?.length ? outputFields : undefined,
      outputShape: declaredOutputShape(src),
      inputKeys: declaredFields(src, 'Input'),
      routePath: `/${relative(apiDir, file).split(sep).slice(0, -1).map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/')}`,
    });
  }

  const loaded = loadProjectViews(projectRoot);
  return {
    endpoints,
    components: loaded.components.map((c) => c.def),
    routes: loaded.views.map((v) => v.route),
    agents: loadProjectAgents(projectRoot),
    // Save time: the app is mid-write, so a route that is not on disk YET is a warning.
    routesComplete: false,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. validateViewSpec — save time
// ──────────────────────────────────────────────────────────────────────────────

/** Keys whose string values are prose, not {@link Value}s — never binding-checked. */
const FREE_TEXT_KEYS = new Set(['source', 'description', 'confirm', 'placeholder', 'brand']);

/** Keys handled explicitly by the walker, so the generic descent must not re-visit them. */
const HANDLED_KEYS = new Set(['use', 'mutate', 'download', 'navigate', 'invalidates', 'reveals']);

/** The mutable state one artifact's walk carries. */
interface WalkCtx {
  errors: ViewError[];
  byName: Map<string, ViewEndpoint>;
  queries: string[];
  mutations: string[];
  allNames: string[];
  /** GET endpoints whose Output is a record or an envelope — what a `detail`/`stats` may bind. */
  recordQueries: string[];
  /** GET endpoints whose Output holds an array — what a `list`/`timeline` may bind. */
  rowQueries: string[];
  components: Map<string, ViewComponentSpec> | undefined;
  routes: string[] | undefined;
  /** `space` → agent slugs. `undefined` ⇒ do not resolve `chat.agent`. */
  agents: Record<string, string[]> | undefined;
  /** See {@link ViewContracts.routesComplete}. `false` ⇒ an unknown route is a warning. */
  routesComplete: boolean;
  sectionIds: Set<string>;
  routeParams: Set<string>;
  /** Declared prop names — set only while walking a component definition. */
  propNames: Set<string> | undefined;
  /** Field universe of the current scope's endpoint. `undefined` ⇒ do not check `$.x`. */
  fields: Set<string> | undefined;
  /** Which endpoint `fields` came from, for the message. */
  fieldsFrom: string | undefined;
  /** Output fields of the mutation whose `onSuccess` we are inside. */
  resultFields: Set<string> | undefined;
  /** Input keys of the mutation whose `prefill.input` we are inside. */
  formFields: Set<string> | undefined;
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Resolve an endpoint name, with the right menu for the slot it was written in. */
function checkEndpoint(
  name: string,
  path: string,
  slot: 'query' | 'mutation' | 'any',
  ctx: WalkCtx,
): ViewEndpoint | undefined {
  const label = slot === 'query' ? 'Queries' : slot === 'mutation' ? 'Mutations' : 'Endpoints';
  const menu = slot === 'query' ? ctx.queries : slot === 'mutation' ? ctx.mutations : ctx.allNames;
  const ep = ctx.byName.get(name);
  if (!ep) {
    ctx.errors.push(unknownEndpoint(path, name, label, menu));
    return undefined;
  }
  const isGet = ep.method === 'GET';
  if (slot === 'query' && !isGet) {
    ctx.errors.push(wrongMethod(path, name, ep.method, 'query', label, menu));
  } else if (slot === 'mutation' && isGet) {
    ctx.errors.push(wrongMethod(path, name, ep.method, 'mutation', label, menu));
  }
  return ep;
}

/** Every key of an `input` object must be a declared Input property of its endpoint. */
function checkInputKeys(input: unknown, ep: ViewEndpoint | undefined, path: string, ctx: WalkCtx): void {
  if (!ep?.inputKeys || !input || typeof input !== 'object') return;
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (!ep.inputKeys.includes(key)) {
      ctx.errors.push(unknownInput(childPath(path, key), key, ep.name, ep.inputKeys));
    }
  }
}

function checkRoute(route: string, path: string, ctx: WalkCtx): void {
  if (!ctx.routes) return;
  if (!ctx.routes.includes(route)) ctx.errors.push(unknownRoute(path, route, ctx.routes, ctx.routesComplete));
}

function checkSectionId(id: string, path: string, ctx: WalkCtx): void {
  if (!ctx.sectionIds.has(id)) ctx.errors.push(unknownSection(path, id, [...ctx.sectionIds]));
}

/**
 * **A section's kind and its endpoint's Output must agree about arity.**
 *
 * `list`/`timeline` draw rows; `detail`/`stats` draw one record. The contract states which the
 * endpoint returns, and the renderer's own split reads it (see {@link OutputShape}), so a section
 * that can only ever draw nothing is knowable before it is written to disk.
 *
 * Skipped for a `from`-sourced section: `from` re-roots the rows at a path INSIDE the Output, so the
 * root's shape governs nothing (`{ trip, days: Day[] }` + `from: '$.days'` is a correct list over a
 * record-rooted Output). Skipped, as always, when the shape could not be read.
 */
function checkSectionArity(
  section: Record<string, unknown>,
  ep: ViewEndpoint | undefined,
  path: string,
  ctx: WalkCtx,
): void {
  if (!ep?.outputShape || typeof section['from'] === 'string' || typeof section['query'] !== 'string') return;
  const kind = String(section['kind']);
  const where = childPath(path, 'query');
  if ((kind === 'list' || kind === 'timeline') && ep.outputShape === 'record') {
    ctx.errors.push(wrongArity(where, kind, ep.name, 'rows', ctx.rowQueries));
  } else if ((kind === 'detail' || kind === 'stats') && ep.outputShape === 'array') {
    ctx.errors.push(wrongArity(where, kind, ep.name, 'record', ctx.recordQueries));
  }
}

/**
 * **A `create` section must derive at least one form field.**
 *
 * The fields come from the mutation's Input schema minus the keys the page supplies through
 * `create.input` (`libs/ui/src/view/form.tsx#deriveFields`, `sections/create.tsx`'s `hidden`), so
 * "how many inputs will this form have?" is answered by the contract, not by the run. Zero means the
 * renderer draws "Nothing to fill in." over a Save button.
 *
 * Route parameters count as nothing to fill in for the same reason `create.input` keys do: the page
 * already holds the value, and asking a user to retype a parent id is not a form. (The renderer does
 * NOT auto-inject them into a create — `useSectionSource`'s param defaulting is the read side — so
 * this is about what the form is FOR, not about what the submit carries.)
 *
 * Silent whenever the answer is not knowable: an unresolved endpoint, a GET (already reported as a
 * wrong method) or an Input the contract reader could not read (`inputKeys === undefined`, never
 * `[]` — the {@link ViewEndpoint} invariant this depends on).
 */
function checkFormDerives(
  section: Record<string, unknown>,
  ep: ViewEndpoint | undefined,
  path: string,
  ctx: WalkCtx,
): void {
  if (!ep || ep.method === 'GET' || !ep.inputKeys) return;
  const input = section['input'];
  const supplied = input && typeof input === 'object' ? Object.keys(input as Record<string, unknown>) : [];
  const derived = ep.inputKeys.filter((k) => !supplied.includes(k));
  // `[].every(…)` is true, which is deliberate: no derived field at all is the primary case.
  if (!derived.every((k) => ctx.routeParams.has(k))) return;
  ctx.errors.push(
    emptyForm(childPath(path, 'mutation'), ep.name, ep.inputKeys, supplied, [...ctx.routeParams].sort()),
  );
}

/**
 * Resolve a `{ agent, space }` pair against the project's real agents.
 *
 * Checked ONLY when `space` is declared. A bare `agent` is the project's own top-level agent — the
 * same one `/chat` talks to, dispatched as `agentSlug` rather than `spaceRef`
 * (`libs/ui/src/view/sections/chat.tsx#sessionBody`) — and nothing on disk here enumerates those,
 * so it degrades to "skipped" rather than rejecting a dock that works.
 */
function checkAgent(agent: string, space: string | undefined, path: string, ctx: WalkCtx): void {
  if (!ctx.agents || !space) return;
  const known = ctx.agents[space];
  if (!known) {
    ctx.errors.push(unknownSpace(childPath(path, 'space'), space, Object.keys(ctx.agents)));
    return;
  }
  if (!known.includes(agent)) ctx.errors.push(unknownAgent(childPath(path, 'agent'), agent, space, known));
}

/** Every string in a spec, classified. The single place the no-expressions rule is enforced. */
function checkString(value: string, path: string, key: string, ctx: WalkCtx): void {
  if (FREE_TEXT_KEYS.has(key)) return;
  if (!value.startsWith('$') && !value.includes('{{') && !value.includes('${')) return;
  if (looksLikeExpression(value) || !isBinding(value)) {
    ctx.errors.push(
      classifyBadBinding(value) === 'expression' ? expressionAttempt(path, value) : badBindingRoot(path, value),
    );
    return;
  }
  if (value === '$' || value === '$client.timezone') return;

  const [root, ...rest] = value.slice(1).split('.');
  const first = (rest[0] ?? '').replace(/\[\d+\]$/, '');

  if (root === 'props') {
    if (!ctx.propNames) {
      ctx.errors.push(
        viewError(
          'bad-binding',
          path,
          `${path}: "${value}" — $props is only bindable inside a component definition ` +
            `(writeProjectViewComponent). On a page, bind the section's data with $.field.`,
        ),
      );
    } else if (first && !ctx.propNames.has(first)) {
      ctx.errors.push(badProp(path, 'unknown', first, 'this component', [...ctx.propNames]));
    }
    return;
  }
  if (root === 'route') {
    if (ctx.routeParams.size && first && !ctx.routeParams.has(first)) {
      ctx.errors.push(
        viewError(
          'bad-binding',
          path,
          `${path}: "${value}" — this page's route has no parameter "${first}". ` +
            `Route parameters: ${[...ctx.routeParams].sort().join(', ') || '(none — this route has no [param] segment)'}`,
        ),
      );
    }
    return;
  }
  if (root === 'data') {
    if (first) checkSectionId(first, path, ctx);
    return;
  }
  if (root === 'result') {
    if (!ctx.resultFields) {
      ctx.errors.push(
        viewError(
          'bad-binding',
          path,
          `${path}: "${value}" — $result is only bindable under an onSuccess, where it is the ` +
            `Output of the mutation that just ran.`,
        ),
      );
    } else if (first && !ctx.resultFields.has(first)) {
      ctx.errors.push(unknownField(path, value, 'the mutation', [...ctx.resultFields]));
    }
    return;
  }
  if (root === 'form') {
    if (!ctx.formFields) {
      ctx.errors.push(
        viewError(
          'bad-binding',
          path,
          `${path}: "${value}" — $form is only bindable under create.prefill.input, where it is ` +
            `what the user has typed so far.`,
        ),
      );
    } else if (first && !ctx.formFields.has(first)) {
      ctx.errors.push(unknownInput(path, first, 'the form', [...ctx.formFields]));
    }
    return;
  }
  // `$.field` — the current scope. `'$.title'.slice(1).split('.')` is `['', 'title']`, so the
  // root is empty and the field is the first segment.
  if (root !== '') return; // an unknown root reaching here would already have failed isBinding
  if (first && ctx.fields && ctx.fieldsFrom && !ctx.fields.has(first)) {
    ctx.errors.push(unknownField(path, value, ctx.fieldsFrom, [...ctx.fields]));
  }
}

/** Resolve + check a `{ use, props }` component reference. */
function checkComponentRef(obj: Record<string, unknown>, path: string, ctx: WalkCtx): void {
  const name = String(obj['use']);
  if (!ctx.components) return;
  const def = ctx.components.get(name);
  if (!def) {
    ctx.errors.push(unknownComponent(childPath(path, 'use'), name, [...ctx.components.keys()]));
    return;
  }
  const declared = Object.keys(def.props ?? {});
  const passed = obj['props'] && typeof obj['props'] === 'object' ? Object.keys(obj['props'] as object) : [];
  for (const p of passed) {
    if (!declared.includes(p)) ctx.errors.push(badProp(childPath(path, `props.${p}`), 'unknown', p, name, declared));
  }
  for (const d of declared) {
    if (!passed.includes(d)) ctx.errors.push(badProp(childPath(path, 'props'), 'missing', d, name, declared));
  }
}

/** The generic descent. Elements, flat items, actions and slots all pass through here. */
function walkNode(node: unknown, path: string, key: string, ctx: WalkCtx): void {
  if (typeof node === 'string') {
    checkString(node, path, key, ctx);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkNode(v, `${path}[${i}]`, key, ctx));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (typeof obj['use'] === 'string') checkComponentRef(obj, path, ctx);

  let actionEndpoint: ViewEndpoint | undefined;
  if (typeof obj['mutate'] === 'string') {
    actionEndpoint = checkEndpoint(obj['mutate'], childPath(path, 'mutate'), 'mutation', ctx);
  }
  if (typeof obj['download'] === 'string') {
    actionEndpoint = checkEndpoint(obj['download'], childPath(path, 'download'), 'any', ctx);
  }
  if (typeof obj['navigate'] === 'string') checkRoute(obj['navigate'], childPath(path, 'navigate'), ctx);
  if (Array.isArray(obj['invalidates'])) {
    obj['invalidates'].forEach((n, i) => {
      if (typeof n === 'string') checkEndpoint(n, `${childPath(path, 'invalidates')}[${i}]`, 'any', ctx);
    });
  }
  if (Array.isArray(obj['reveals'])) {
    obj['reveals'].forEach((id, i) => {
      if (typeof id === 'string') checkSectionId(id, `${childPath(path, 'reveals')}[${i}]`, ctx);
    });
  }
  if (actionEndpoint) checkInputKeys(obj['input'], actionEndpoint, childPath(path, 'input'), ctx);

  // `$result` becomes bindable exactly inside this action's onSuccess, and nowhere else.
  const outerResult = ctx.resultFields;
  for (const [k, v] of Object.entries(obj)) {
    if (HANDLED_KEYS.has(k)) continue;
    if (k === 'onSuccess') {
      ctx.resultFields = actionEndpoint?.outputFields ? new Set(actionEndpoint.outputFields) : ctx.resultFields;
      walkNode(v, childPath(path, k), k, ctx);
      ctx.resultFields = outerResult;
      continue;
    }
    walkNode(v, childPath(path, k), k, ctx);
  }
}

/** The endpoint + field scope one section establishes for everything inside it. */
function sectionScope(
  section: Record<string, unknown>,
  path: string,
  ctx: WalkCtx,
  scopes: Map<string, { ep?: ViewEndpoint; schema?: unknown }>,
): { ep?: ViewEndpoint; fields?: Set<string>; from: string | undefined } {
  const kind = String(section['kind']);
  let ep: ViewEndpoint | undefined;
  if (typeof section['query'] === 'string') {
    ep = checkEndpoint(section['query'], childPath(path, 'query'), 'query', ctx);
  }
  if (typeof section['mutation'] === 'string') {
    ep = checkEndpoint(section['mutation'], childPath(path, 'mutation'), 'mutation', ctx);
  }

  // `from` re-roots the section's rows at an embedded array — either in its own Output, or in
  // another section's (in which case no request is made at all).
  let schema: unknown = ep?.outputSchema;
  const from = typeof section['from'] === 'string' ? section['from'] : undefined;
  if (from) {
    if (from.startsWith('$data.')) {
      const [, sectionId, ...rest] = from.split('.');
      const source = scopes.get(sectionId);
      if (!source) checkSectionId(sectionId, childPath(path, 'from'), ctx);
      schema = source ? schemaAtPath(source.schema, rest) : undefined;
      ep = source?.ep ?? ep;
    } else {
      schema = schemaAtPath(schema, from.replace(/^\$\./, '').split('.'));
    }
    // The section's rows are an embedded array, and we could not resolve WHICH — the save-time
    // contract reader carries no schema at all, so `ep.outputSchema` is undefined for every
    // endpoint there. Falling back to the ROOT universe is the wrong answer twice over: it accepts
    // root fields the rows do not have, and rejects row fields the model correctly bound. Skip.
    if (!schema) return { ep, fields: undefined, from };
  }

  // `create` binds no rows: its fields come from the mutation's INPUT schema, not its Output, and
  // the section body carries only page-supplied `input` values.
  const universe = schema ? outputFieldUniverse(schema) : ep?.outputFields;
  const fields = kind === 'create' || !universe?.length ? undefined : new Set(universe);

  return { ep, fields, from };
}

/**
 * **Save-time validation of ONE page spec.** What `writeProjectView` runs before anything reaches
 * disk, and what the tests assert the text of.
 *
 * Shape first (`schema.ts`'s ajv). If the shape is wrong the semantic checks are skipped entirely:
 * they assume a well-formed spec, and a model handed twenty cascading errors from one missing
 * brace fixes none of them.
 */
export function validateViewSpec(spec: unknown, contracts: ContractsLike | ViewContracts): ViewValidationResult {
  const shape = validateViewSpecShape(spec);
  if (!shape.ok) return resultOf(shapeErrorsToViewErrors(shape.errors), 1);

  const view = spec as ViewSpec;
  const ctx = makeCtx(contracts);
  ctx.routeParams = new Set([...view.route.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((m) => m[1]));
  for (const s of view.sections) if (s.id) ctx.sectionIds.add(s.id);

  // Two passes: a section's `from` may address a section declared before it, so every scope has to
  // exist before any of them is walked.
  const scopes = new Map<string, { ep?: ViewEndpoint; schema?: unknown }>();
  view.sections.forEach((section, i) => {
    const rec = section as unknown as Record<string, unknown>;
    const name = typeof rec['query'] === 'string' ? rec['query'] : undefined;
    const ep = name ? ctx.byName.get(name) : undefined;
    if (section.id) scopes.set(section.id, { ep, schema: ep?.outputSchema });
    void i;
  });

  view.sections.forEach((section, i) => {
    const path = `sections[${i}]`;
    const rec = section as unknown as Record<string, unknown>;
    const scope = sectionScope(rec, path, ctx, scopes);
    ctx.fields = scope.fields;
    ctx.fieldsFrom = scope.ep?.name;
    ctx.formFields = undefined;

    checkSectionArity(rec, scope.ep, path, ctx);
    if (rec['input']) checkInputKeys(rec['input'], scope.ep, childPath(path, 'input'), ctx);

    if (String(rec['kind']) === 'chat' && typeof rec['agent'] === 'string') {
      checkAgent(rec['agent'], typeof rec['space'] === 'string' ? rec['space'] : undefined, path, ctx);
    }

    if (String(rec['kind']) === 'create') {
      checkFormDerives(rec, scope.ep, path, ctx);
      const prefill = rec['prefill'] as Record<string, unknown> | undefined;
      if (prefill && typeof prefill['endpoint'] === 'string') {
        const pep = checkEndpoint(prefill['endpoint'], `${path}.prefill.endpoint`, 'any', ctx);
        // `$form.*` is bindable only here — the one place the form's own values exist.
        ctx.formFields = scope.ep?.inputKeys ? new Set(scope.ep.inputKeys) : undefined;
        checkInputKeys(prefill['input'], pep, `${path}.prefill.input`, ctx);
      }
      if (rec['onSuccess']) {
        ctx.resultFields = scope.ep?.outputFields ? new Set(scope.ep.outputFields) : undefined;
      }
    }

    for (const [k, v] of Object.entries(rec)) {
      if (k === 'kind' || k === 'id' || k === 'query' || k === 'mutation' || k === 'from') continue;
      walkNode(v, childPath(path, k), k, ctx);
    }
    ctx.resultFields = undefined;
    ctx.formFields = undefined;
  });

  return resultOf(ctx.errors, 1);
}

/**
 * **Save-time validation of ONE component definition.** Same rules, one scope difference:
 * `$props.x` is the only resolvable root here (a component has no endpoint of its own), and
 * `$.field` is deliberately unchecked — the caller's row type is not knowable at this write.
 */
export function validateViewComponent(
  def: unknown,
  contracts: ContractsLike | ViewContracts,
): ViewValidationResult {
  const shape = validateViewComponentShape(def);
  if (!shape.ok) return resultOf(shapeErrorsToViewErrors(shape.errors), 1);

  const component = def as ViewComponentSpec;
  const view = toViewContracts(contracts);
  // The def being validated is part of the vocabulary it validates against — otherwise a component
  // that references itself reports as an unknown component and the real finding (the cycle) is
  // never reached.
  const ctx = makeCtx({
    ...view,
    components: [...(view.components ?? []).filter((c) => c.name !== component.name), component],
  });
  ctx.propNames = new Set(Object.keys(component.props ?? {}));
  ctx.fields = undefined;
  ctx.fieldsFrom = undefined;
  walkNode(component.node, 'node', 'node', ctx);

  // A component that uses itself, directly or through others, never terminates in the renderer.
  const cycle = findComponentCycle(component, ctx.components);
  if (cycle) {
    ctx.errors.push(
      viewError(
        'component-cycle',
        'node',
        `node: ${cycle.join(' → ')} — view components may not reference each other in a cycle. ` +
          `A component is data the renderer expands; a cycle expands forever.`,
      ),
    );
  }
  return resultOf(ctx.errors, 1);
}

/** **Save-time validation of the app shell.** Nav targets must be real, static routes. */
export function validateShellSpec(
  shell: unknown,
  contracts: ContractsLike | ViewContracts,
): ViewValidationResult {
  const shape = validateShellShape(shell);
  if (!shape.ok) return resultOf(shapeErrorsToViewErrors(shape.errors), 1);

  const ctx = makeCtx(contracts);
  const s = shell as ShellSpec;
  for (const [i, entry] of (s.nav ?? []).entries()) {
    checkRoute(entry.route, `nav[${i}].route`, ctx);
    if (entry.badge) checkEndpoint(entry.badge.query, `nav[${i}].badge.query`, 'query', ctx);
  }
  for (const [i, group] of (s.groups ?? []).entries()) {
    checkRoute(group.home, `groups[${i}].home`, ctx);
    for (const [j, r] of (group.routes ?? []).entries()) checkRoute(r, `groups[${i}].routes[${j}]`, ctx);
    if (group.badge) checkEndpoint(group.badge.query, `groups[${i}].badge.query`, 'query', ctx);
  }
  if (s.assistant?.agent) checkAgent(s.assistant.agent, s.assistant.space, 'assistant', ctx);
  for (const [i, sub] of (s.subnav ?? []).entries()) {
    for (const [j, item] of (sub.items ?? []).entries()) checkRoute(item.route, `subnav[${i}].items[${j}].route`, ctx);
    for (const [j, g] of (sub.groups ?? []).entries()) {
      for (const [k, item] of g.items.entries()) checkRoute(item.route, `subnav[${i}].groups[${j}].items[${k}].route`, ctx);
    }
  }
  return resultOf(ctx.errors, 1);
}

/** Build the walk context from whichever contracts shape the caller had. */
function makeCtx(input: ContractsLike | ViewContracts): WalkCtx {
  const contracts = toViewContracts(input);
  const byName = new Map(contracts.endpoints.map((e) => [e.name, e]));
  return {
    errors: [],
    byName,
    queries: contracts.endpoints.filter((e) => e.method === 'GET').map((e) => e.name).sort(),
    // Only the endpoints whose shape is KNOWN to fit. A menu is a promise, so an endpoint this
    // could not read does not go on it — being a strict subset of the valid answers is the point.
    recordQueries: contracts.endpoints
      .filter((e) => e.method === 'GET' && (e.outputShape === 'record' || e.outputShape === 'envelope'))
      .map((e) => e.name)
      .sort(),
    rowQueries: contracts.endpoints
      .filter((e) => e.method === 'GET' && (e.outputShape === 'array' || e.outputShape === 'envelope'))
      .map((e) => e.name)
      .sort(),
    mutations: contracts.endpoints.filter((e) => e.method !== 'GET').map((e) => e.name).sort(),
    allNames: contracts.endpoints.map((e) => e.name).sort(),
    components: contracts.components ? new Map(contracts.components.map((c) => [c.name, c])) : undefined,
    routes: contracts.routes,
    agents: contracts.agents,
    routesComplete: contracts.routesComplete !== false,
    sectionIds: new Set(),
    routeParams: new Set(),
    propNames: undefined,
    fields: undefined,
    fieldsFrom: undefined,
    resultFields: undefined,
    formFields: undefined,
  };
}

/** Every `{ use: … }` name inside an arbitrary spec fragment. */
function componentRefs(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const v of node) componentRefs(v, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj['use'] === 'string') out.add(obj['use']);
  for (const v of Object.values(obj)) componentRefs(v, out);
  return out;
}

/** DFS for a cycle reachable from `start`, returning the path that closes it. */
function findComponentCycle(
  start: ViewComponentSpec,
  all: Map<string, ViewComponentSpec> | undefined,
): string[] | undefined {
  const graph = new Map<string, ViewComponentSpec>(all ?? []);
  graph.set(start.name, start);
  const stack: string[] = [];
  const seen = new Set<string>();

  function visit(name: string): string[] | undefined {
    const idx = stack.indexOf(name);
    if (idx >= 0) return [...stack.slice(idx), name];
    if (seen.has(name)) return undefined;
    seen.add(name);
    const def = graph.get(name);
    if (!def) return undefined;
    stack.push(name);
    for (const ref of componentRefs(def.node)) {
      const found = visit(ref);
      if (found) return found;
    }
    stack.pop();
    return undefined;
  }
  return visit(start.name);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. validateAppViews — whole app
// ──────────────────────────────────────────────────────────────────────────────

/** The section kinds that actually read or write data. A page of only the others shows chrome. */
const DATA_KINDS = new Set(['list', 'detail', 'create', 'stats', 'timeline']);

/** Every route a spec navigates to, from anywhere inside it. */
function navigateTargets(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const v of node) navigateTargets(v, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj['navigate'] === 'string') out.add(obj['navigate']);
  for (const v of Object.values(obj)) navigateTargets(v, out);
  return out;
}

/** Does `route` sit under `prefix` (`trips/[tripId]` covers `trips/[tripId]/expenses`)? */
function underPrefix(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}

/**
 * **Whole-app validation.** Everything a single save cannot see.
 *
 * The orphan-route check is the one that earns its keep: every page validates, every route builds,
 * every endpoint answers — and three of the pages have no way in. The appbuilder shipped exactly
 * that (scenario 07's `/vault-dashboard`), and no static check on any one page could have found it.
 */
export async function validateAppViews(
  projectRoot: string,
  opts: { contracts?: ContractsLike } = {},
): Promise<ViewValidationResult> {
  const loaded = loadProjectViews(projectRoot);
  const errors: ViewError[] = loaded.malformed.map((m) => malformedArtifact(m.path, m.message));

  if (loaded.views.length === 0) {
    // An empty result is what a pipeline reads as "clean" — say the opposite, loudly.
    errors.push(
      viewError(
        'no-data',
        '',
        `this project has no view specs (pages/*${'.view.json'}). If the app was built with ` +
          `writeProjectView, nothing landed; if it is a TSX app, it is not this gate's business.`,
      ),
    );
    return resultOf(errors, 0);
  }

  // Bound before the await: TS drops a property's narrowing across one, and `opts.contracts` would
  // read back as possibly-undefined in the expression that consumes it.
  const supplied = opts.contracts;
  const contracts: ContractsLike =
    supplied ?? (await import('../build/contracts.js').then((m) => m.generateProjectContracts(projectRoot)));
  const routes = loaded.views.map((v) => v.route);
  const components = loaded.components.map((c) => c.def);
  // `routesComplete` is the whole point of running here: every page is on disk now, so a
  // `navigate` at a route that does not exist is a hard error — the check the writer deliberately
  // demotes to a warning because no write ORDER can satisfy a mutual link at save time.
  const base: ViewContracts = {
    ...toViewContracts(contracts),
    components,
    routes,
    agents: loadProjectAgents(projectRoot),
    routesComplete: true,
  };

  // Per-artifact checks, re-run against the FULL app vocabulary (a save-time run only knew what
  // existed at that moment — a component written afterwards makes a then-invalid reference valid,
  // and a deleted endpoint makes a then-valid one wrong).
  for (const { route, spec, path } of loaded.views) {
    for (const e of validateViewSpec(spec, base).errors) errors.push({ ...e, file: path });
    void route;
  }
  for (const { def, path } of loaded.components) {
    for (const e of validateViewComponent(def, base).errors) errors.push({ ...e, file: path });
  }
  if (loaded.shell) {
    for (const e of validateShellSpec(loaded.shell, base).errors) errors.push({ ...e, file: 'pages/_shell.view.json' });
  }

  // ── reachability ───────────────────────────────────────────────────────────
  const reachable = new Set<string>();
  const shell = loaded.shell;
  for (const entry of shell?.nav ?? []) reachable.add(entry.route);
  for (const group of shell?.groups ?? []) {
    reachable.add(group.home);
    for (const r of group.routes ?? []) reachable.add(r);
  }
  const subnavPrefixes: string[] = [];
  for (const sub of shell?.subnav ?? []) {
    subnavPrefixes.push(sub.match);
    for (const item of sub.items ?? []) reachable.add(item.route);
    for (const g of sub.groups ?? []) for (const item of g.items) reachable.add(item.route);
  }
  for (const { spec } of loaded.views) for (const t of navigateTargets(spec)) reachable.add(t);

  // No shell on disk ⇒ the renderer derives one from the top-level static routes. Mirror that here
  // rather than reporting every page as an orphan of a shell the model was never asked to write.
  if (!shell) {
    for (const r of routes) if (!r.includes('/') && !r.includes('[')) reachable.add(r);
    if (routes.includes('index')) reachable.add('index');
  }

  for (const { route, path } of loaded.views) {
    if (route === 'index') continue; // the app's own entry point is reachable by definition
    if (reachable.has(route)) continue;
    if (subnavPrefixes.some((p) => underPrefix(route, p))) continue;
    errors.push(orphanRoute(route, path, [...reachable].sort()));
  }

  // ── dead components (warning) ──────────────────────────────────────────────
  const used = new Set<string>();
  for (const { spec } of loaded.views) for (const n of componentRefs(spec)) used.add(n);
  for (const { def } of loaded.components) for (const n of componentRefs(def.node)) used.add(n);
  for (const { def, path } of loaded.components) {
    if (!used.has(def.name)) errors.push(deadComponent(def.name, path));
  }

  // ── every page must read something ────────────────────────────────────────
  for (const { route, spec, path } of loaded.views) {
    const kinds = spec.sections.map((s) => s.kind);
    const bound = spec.sections.some(
      (s) => DATA_KINDS.has(s.kind) && Boolean((s as unknown as Record<string, unknown>)['query'] ?? (s as unknown as Record<string, unknown>)['mutation'] ?? (s as unknown as Record<string, unknown>)['from']),
    );
    if (!bound) errors.push(pageHasNoData(route, path, kinds));
  }

  return resultOf(errors, loaded.views.length + loaded.components.length);
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. renderSmokeViews — the view twin of smoke_endpoints
// ──────────────────────────────────────────────────────────────────────────────

/** One section this run could not put data in front of, and why. Never counted as a pass. */
export interface UnmeasuredSection {
  /** Index into `spec.sections`. */
  section: number;
  endpoint?: string;
  reason: string;
}

/**
 * One section that DID get its data and still drew nothing but its heading.
 *
 * The opposite of {@link UnmeasuredSection}: the endpoint answered, the section mounted, and S1
 * dropped every element it contains. A page-level verdict cannot see this — one populated list
 * beside it makes the page "not empty".
 */
export interface EmptySection {
  /** Index into `spec.sections`. */
  section: number;
  kind: string;
  reason: string;
}

/**
 * What one page's smoke run found.
 *
 * `coverage` and `empty` are **nullable on purpose**: `null` is "not measured", which is a third
 * answer, not a rounding of the other two. The version that defaulted an unmeasured page to
 * `coverage: 1, empty: false` reported **100% coverage and not-empty for a page whose every
 * endpoint 4xx'd** — the headline metric reading perfect exactly where the app was most broken.
 */
export interface ViewSmokeReport {
  route: string;
  /** Endpoints this page called, and what they answered. `rows` is 0 for any non-2xx. */
  calls: { endpoint: string; status: number; rows: number; ok: boolean }[];
  /** Bound `$.field` paths that resolved non-null at least once / were checked. */
  bindingsCovered: number;
  bindingsChecked: number;
  /** `bindingsCovered / bindingsChecked`, or `null` when NOTHING was measured. */
  coverage: number | null;
  /** True when the page mounted over real data and produced nothing. `null` when not measured. */
  empty: boolean | null;
  /** Sections whose data never arrived — a non-2xx, or a dependency that could not be resolved. */
  unmeasured: UnmeasuredSection[];
  /** Sections that got their data and still drew nothing. Empty when the whole PAGE is empty. */
  emptySections: EmptySection[];
}

/** {@link renderSmokeViews}'s result — a validation result plus the per-page evidence. */
export interface RenderSmokeResult extends ViewValidationResult {
  /** `true` when the gate could not run at all. NEVER report an empty finding list instead. */
  unavailable: boolean;
  reason?: string;
  pages: ViewSmokeReport[];
  /** Whether the real `ViewRenderer` was mounted, or only the data half was checked. */
  rendererMounted: boolean;
}

/** The seam the caller supplies — `ctx.callProjectApi` in a tasklist code node. */
export type ApiCaller = (name: string, input?: unknown) => Promise<{ status: number; body: unknown }>;

/**
 * The section kinds that draw ROWS. Everything else binds ONE record.
 *
 * The renderer's own split (`sections/index.tsx` dispatches `list`/`timeline` to
 * `CollectionSection`, which reads `source.rows`; every other kind reads `source.record`), mirrored
 * here because a smoke run that guesses differently checks the page's bindings against the wrong
 * objects — see {@link sectionRows}.
 */
const ROW_KINDS = new Set(['list', 'timeline']);

/**
 * The array inside an Output — `sections/common.tsx#extractRows`, kept in step.
 *
 * The conventional envelope keys come FIRST and the "any array property" fallback last, which is
 * why this is a copy and not a rewrite: the renderer decides what a list draws, and a gate that
 * decides differently reports on rows the user never sees.
 */
const ROW_KEYS = ['items', 'rows', 'results', 'data', 'records', 'list'] as const;

/** Keys an envelope may carry beside its array — `sections/common.tsx#ENVELOPE_META`, kept in step. */
const ENVELOPE_META = new Set([
  'total',
  'count',
  'page',
  'pageSize',
  'per_page',
  'limit',
  'offset',
  'cursor',
  'nextCursor',
  'next_cursor',
  'hasMore',
  'has_more',
]);

function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  for (const key of ROW_KEYS) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  for (const value of Object.values(obj)) if (Array.isArray(value)) return value;
  return [];
}

/**
 * The ONE record a non-collection section binds — `sections/common.tsx#extractRecord`, kept in step.
 *
 * `{ items: [record] }` is the envelope every generated handler returns, including the ones that
 * compute a single dashboard row, so a record section's `$.field` resolves INSIDE it. A gate that
 * read the envelope instead reported every one of those bindings as null and named the ENDPOINT —
 * routing `17-fix` at a handler that was already correct.
 */
function extractRecord(body: unknown): unknown {
  if (Array.isArray(body)) return body[0];
  if (!body || typeof body !== 'object') return body;
  const obj = body as Record<string, unknown>;
  const key = ROW_KEYS.find((k) => Array.isArray(obj[k]));
  if (!key) return body;
  // Narrow on purpose: `{ plan, tonight, mealsByDay: [...] }` is a RECORD that embeds an array.
  if (!Object.keys(obj).every((k) => k === key || ENVELOPE_META.has(k))) return body;
  return (obj[key] as unknown[])[0];
}

/** Keep only the objects — a row of `null`s or strings carries no bindable field. */
function objectRows(rows: readonly unknown[]): Record<string, unknown>[] {
  return rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
}

/**
 * **The objects a section's `$.field` bindings actually resolve against.**
 *
 * The version this replaces asked one question of the response — "what is the first array-valued
 * property?" — and used the answer for every section. On `currentPlan` (`{ plan, tonight,
 * mealsByDay: [...] }`) that made a `stats` section's `$.tonight.recipeTitle` resolve against a
 * MEAL row, so fourteen correct bindings were reported as "always null, fix the endpoint" — each
 * one naming the wrong culprit, and `17-fix` routes exactly those at the handler. The section's own
 * source is not a guess: `from` says it outright, and the kind says whether it is rows or a record.
 */
function sectionRows(
  section: Record<string, unknown>,
  body: unknown,
  published: Map<string, unknown>,
): Record<string, unknown>[] {
  const from = typeof section['from'] === 'string' ? section['from'] : undefined;
  if (from) {
    const source = from.startsWith('$data.')
      ? (() => {
          const [, id, ...rest] = from.split('.');
          const base = published.get(id!);
          return rest.length ? readPath(base, `$.${rest.join('.')}`) : base;
        })()
      : readPath(body, from);
    return Array.isArray(source) ? objectRows(source) : objectRows(source === undefined ? [] : [source]);
  }
  if (ROW_KINDS.has(String(section['kind']))) return objectRows(extractRows(body));
  // The renderer's `record` — see {@link extractRecord}.
  const record = extractRecord(body);
  return objectRows(record === undefined ? [] : [record]);
}

/**
 * Section keys whose `$.` value addresses the **Output root or the page**, not a row.
 *
 * `from: '$.lines'` names the array the rows come FROM; checking it against those rows asks
 * whether every line has a `lines` field, which no correct spec ever does — ten of the kitchen
 * fixture's findings were exactly that, each one pointing `17-fix` at a working endpoint. `input`
 * and `param` resolve in the page's scope (`$route`/`$data`) before any row exists.
 */
const NON_ROW_SECTION_KEYS = new Set(['from', 'input', 'param']);

/** Every row-scoped `$.field` binding in a section, with the instance path it sits at. */
function boundPaths(
  node: unknown,
  path: string,
  out: { path: string; binding: string }[] = [],
  skip?: ReadonlySet<string>,
): { path: string; binding: string }[] {
  if (typeof node === 'string') {
    if (node.startsWith('$.') && isBinding(node)) out.push({ path, binding: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => boundPaths(v, `${path}[${i}]`, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (skip?.has(k)) continue;
    boundPaths(v, childPath(path, k), out);
  }
  return out;
}

/** Read a `$.a.b` path off one row. */
function readPath(row: unknown, binding: string): unknown {
  let cur: unknown = row;
  for (const seg of binding.slice(2).split('.')) {
    const key = seg.replace(/\[(\d+)\]$/, '');
    const idx = /\[(\d+)\]$/.exec(seg)?.[1];
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
    if (idx !== undefined && Array.isArray(cur)) cur = cur[Number(idx)];
  }
  return cur;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * **Mount every view against the app's LIVE endpoint responses.**
 *
 * This is the gate that catches what no static check can. A spec whose every name resolves and
 * whose every binding type-checks still ships a blank page when the endpoint returns `[]`, or a
 * row of nulls, or a computed field nobody computed. `validateAppViews` says the page is correct;
 * this says whether it shows anything.
 *
 * Three findings, in increasing order of how much they matter:
 *  - **render errors** — the renderer threw (needs the real `ViewRenderer`; see below);
 *  - **binding coverage** — what fraction of the page's bound fields were non-null on real rows;
 *  - **an always-null binding** — reported against the ENDPOINT, not the view. This is the
 *    important one and the reason the finding carries `endpoint`: the view named a field the
 *    contract declares, so the defect is upstream, and a fix routed at the page would delete the
 *    binding and call the page fixed.
 *
 * The renderer mount is best-effort by design: coverage and emptiness are properties of the DATA
 * and the SPEC, so they are computed whether or not `@lmthing/ui/view` is importable in this
 * process. When it is, the spec is additionally mounted through the real renderer and a throw
 * becomes a `render-error`. `rendererMounted` says which of the two ran — never inferred from an
 * empty finding list.
 *
 * ## What this gate CANNOT see, and why that is not fixable here
 *
 * The mount is `renderToStaticMarkup` — a **string** render. There is no DOM, no CSS and no layout
 * engine, so this gate sees only what a spec *declares* and what an endpoint *answers*. Anything
 * that goes wrong between correct markup and visible pixels is invisible to it **by construction**:
 *
 *  - a container that computes to zero height, so the page is blank while every element exists;
 *  - content clipped or positioned outside the viewport;
 *  - a control that renders but cannot be clicked;
 *  - a token that resolves to the background colour.
 *
 * This is not hypothetical. The first model-built app rendered **completely blank on every page** —
 * the shell's root collapsed to 98px, the scroller to `clientHeight: 0` around 719px of content,
 * and the first row's buttons to `y: -107` — and it passed `buildApp`, `validateAppViews` and THIS
 * FUNCTION cleanly, with `emptyRender` never firing, because the markup and the data were both
 * perfect (fixed in `libs/ui/src/view/shell.tsx`, see its root Col comment).
 *
 * So `emptyRender` here means "**the spec produced no content for the data**" — a section bound to
 * an empty collection, a page whose every binding was null. It does NOT and cannot mean "the user
 * would see something". Reading it as the latter is how a blank app ships green. The gate for the
 * visual claim is a real browser — Workstream D's render rig — and until that exists, a green
 * `renderSmokeViews` is evidence about structure and data only.
 */
export async function renderSmokeViews(
  projectRoot: string,
  opts: { call?: ApiCaller; contracts?: ContractsLike } = {},
): Promise<RenderSmokeResult> {
  const empty = (reason: string): RenderSmokeResult => ({
    ...resultOf([], 0),
    unavailable: true,
    reason,
    pages: [],
    rendererMounted: false,
  });

  const loaded = loadProjectViews(projectRoot);
  if (loaded.views.length === 0) return empty(`no view specs under ${viewSpecPath('<route>')}`);
  if (!opts.call) {
    return empty(
      'no api caller was supplied — pass ctx.callProjectApi (absent only for a project with no api/ runtime). ' +
        'Without it nothing is CALLED, and an uncalled gate finds nothing.',
    );
  }
  const call = opts.call;

  // Reuse the caller's contracts when it has them: `16-verify` has already paid for a generation
  // via `buildProjectApp`, and a second `ts-json-schema-generator` pass over every handler is the
  // most expensive thing this function would otherwise do.
  const supplied = opts.contracts;
  const contracts = toViewContracts(
    supplied ?? (await import('../build/contracts.js').then((m) => m.generateProjectContracts(projectRoot))),
  );
  const byName = new Map(contracts.endpoints.map((e) => [e.name, e]));
  const errors: ViewError[] = [];
  const pages: ViewSmokeReport[] = [];

  /**
   * Ids harvested from real responses, **scoped to the collection that produced them**.
   *
   * The pool this replaces was one flat `field → value` map with first-write-wins, so `expiring`
   * ran first, `paramPool['id']` held an INGREDIENT id, and `recipes/[id]` was then smoked with it
   * and 404'd — a whole page reported broken because of the order the pages happened to sort in.
   * REST already says which collection an `:id` belongs to: the value for `/plan/:id/trip` comes
   * from `/plan`, and can come from nowhere else.
   */
  const idPool = new Map<string, Map<string, unknown>>();
  const responses = new Map<string, { status: number; body: unknown }>();

  /** `/plan/:id/trip` + `id` → `/plan`: the collection an `:id` in a path is an id OF. */
  function parentPathFor(ep: ViewEndpoint | undefined, key: string): string {
    if (!ep?.routePath) return ''; // no path known ⇒ one shared pool, the old behaviour
    const segs = ep.routePath.split('/');
    const at = segs.indexOf(`:${key}`);
    return at > 0 ? segs.slice(0, at).join('/') : ep.routePath;
  }

  /** Register the ids a response carries under the path that served it. */
  function harvest(ep: ViewEndpoint | undefined, body: unknown): void {
    const key = ep?.routePath ?? '';
    const pool = idPool.get(key) ?? new Map<string, unknown>();
    idPool.set(key, pool);
    const take = (row: unknown): void => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (!/(^id$|Id$)/.test(k)) continue;
        if (typeof v !== 'string' && typeof v !== 'number') continue;
        if (!pool.has(k)) pool.set(k, v);
      }
    };
    // Order is the priority: the record itself, then the entities it embeds, then its rows.
    // `currentPlan` answers `{ plan: {id}, tonight: {id}, mealsByDay: [{id}] }` — the plan's id is
    // the one `/plan/:id/...` wants, and the meal ids must not shadow it.
    take(Array.isArray(body) ? undefined : body);
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      for (const v of Object.values(body as Record<string, unknown>)) take(v);
    }
    for (const row of extractRows(body)) take(row);
  }

  async function callOnce(
    ep: ViewEndpoint | undefined,
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const key = `${name}:${JSON.stringify(input)}`;
    const hit = responses.get(key);
    if (hit) return hit;
    let res: { status: number; body: unknown };
    try {
      res = await call(name, input);
    } catch (e) {
      res = { status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
    }
    responses.set(key, res);
    // An error body is NOT data. Harvesting `{ error: … }` is how `rowsOf` used to turn a 400 into
    // "one row", which made `anyRows` true and the page report as populated.
    if (res.status >= 200 && res.status < 300) harvest(ep, res.body);
    return res;
  }

  /** A route-parameter value for input `key` of `ep`, from the collection that owns that id. */
  function poolValue(ep: ViewEndpoint | undefined, key: string): unknown {
    const pool = idPool.get(parentPathFor(ep, key));
    return pool?.get(key) ?? pool?.get('id');
  }

  /**
   * Resolve one section `input` value the way the renderer's `resolveInputs` does.
   *
   * Without this the runner filled route params only and sent NOTHING for a dependent query, so
   * four kitchen endpoints answered 400 and were reported as broken endpoints — they work in a
   * browser, where `$data.plan.plan.id` is the plan the section above already fetched. An
   * unresolvable value returns `{ ready: false }`, which is the renderer's behaviour too: the
   * query stays idle rather than firing without its dependency.
   */
  function resolveInput(
    value: unknown,
    ep: ViewEndpoint | undefined,
    key: string,
    published: Map<string, unknown>,
  ): { ready: boolean; value?: unknown } {
    if (typeof value !== 'string' || !value.startsWith('$')) return { ready: true, value };
    if (value === '$client.timezone') return { ready: true, value: 'UTC' };
    if (value.startsWith('$data.')) {
      const [, id, ...rest] = value.split('.');
      if (!published.has(id!)) return { ready: false };
      const got = rest.length ? readPath(published.get(id!), `$.${rest.join('.')}`) : published.get(id!);
      return got === undefined || got === null ? { ready: false } : { ready: true, value: got };
    }
    if (value.startsWith('$route.')) {
      // There is no URL here, so a route parameter is whatever the collection this endpoint hangs
      // off actually returned — resolved through the INPUT KEY it feeds, not the param's name.
      const got = poolValue(ep, key);
      return got === undefined ? { ready: false } : { ready: true, value: got };
    }
    return { ready: false };
  }

  /**
   * Count one section's `$.field` bindings against the rows it will actually draw.
   *
   * Returns this SECTION's own tally, which is what {@link drewNothing} judges: the page totals
   * cannot answer "did section 0 draw?" once section 1 has contributed to them.
   */
  function checkBindings(
    report: ViewSmokeReport,
    file: string,
    rec: Record<string, unknown>,
    i: number,
    rows: Record<string, unknown>[],
    ep: ViewEndpoint | undefined,
    name: string | undefined,
  ): { checked: number; covered: number } {
    const own = { checked: 0, covered: 0 };
    if (rows.length === 0) return own;
    for (const { path: bindPath, binding } of boundPaths(rec, `sections[${i}]`, [], NON_ROW_SECTION_KEYS)) {
      report.bindingsChecked++;
      own.checked++;
      if (rows.some((row) => !isEmptyValue(readPath(row, binding)))) {
        report.bindingsCovered++;
        own.covered++;
        continue;
      }
      // Declared but never produced: the endpoint's problem, not the page's.
      const field = binding.slice(2).split('.')[0]!.replace(/\[\d+\]$/, '');
      if (name && ep?.outputFields?.includes(field)) {
        errors.push(alwaysNullBinding(bindPath, binding, name, rows.length, file));
      }
    }
    return own;
  }

  /**
   * Did this section draw anything a user would see?
   *
   * Two ways to draw nothing, and neither is a lie the page total can tell:
   *  - **every binding null.** S1 omits a bound value that resolves to nothing — its label and its
   *    wrapper with it (a stats card takes its LITERAL label along) — so a section whose bindings
   *    are all null is a heading over an empty box, whatever kind it is.
   *  - **a `stats` strip with no record.** Every other kind has a renderer-supplied empty state
   *    (`sections/common.tsx#SectionFrame`), which is content: "No jobs yet" is an honest answer
   *    and must never be reported as a blank. `stats` has none — no record means no tiles and
   *    nothing else, which is precisely what `30-bike-workshop`'s front page showed.
   *
   * Returns the reason, or `undefined` when the section drew.
   */
  function drewNothing(
    kind: string,
    rows: Record<string, unknown>[],
    own: { checked: number; covered: number },
  ): string | undefined {
    if (own.checked > 0) {
      return own.covered === 0 ? `${own.checked} bound field(s), none of which had a value` : undefined;
    }
    if (kind === 'stats' && rows.length === 0) return 'its endpoint returned no record, and a stats strip has no empty state';
    return undefined;
  }

  // Two sweeps: parameterless routes first, so a collection has been fetched before a detail page
  // needs an id out of it.
  const ordered = [...loaded.views].sort((a, b) => Number(a.route.includes('[')) - Number(b.route.includes('[')));

  for (const { route, spec, path } of ordered) {
    const report: ViewSmokeReport = {
      route,
      calls: [],
      bindingsCovered: 0,
      bindingsChecked: 0,
      coverage: null,
      empty: null,
      unmeasured: [],
      emptySections: [],
    };
    const params = [...route.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((m) => m[1]!);
    /** `$data.<id>` — each section publishes its WHOLE Output, exactly as `usePublish` does. */
    const published = new Map<string, unknown>();
    let measuredSections = 0;

    for (const [i, section] of spec.sections.entries()) {
      const rec = section as unknown as Record<string, unknown>;
      const name = typeof rec['query'] === 'string' ? rec['query'] : undefined;
      const from = typeof rec['from'] === 'string' ? rec['from'] : undefined;

      // A section sourced from ANOTHER section's Output makes no request at all.
      if (!name && from?.startsWith('$data.')) {
        const rows = sectionRows(rec, undefined, published);
        if (rows.length) measuredSections++;
        const own = checkBindings(report, path, rec, i, rows, undefined, undefined);
        const why = drewNothing(String(rec['kind']), rows, own);
        if (why) report.emptySections.push({ section: i, kind: String(rec['kind']), reason: why });
        continue;
      }
      if (!name) continue;
      const ep = byName.get(name);

      const input: Record<string, unknown> = {};
      let ready = true;
      let blocked = '';
      for (const [k, v] of Object.entries((rec['input'] ?? {}) as Record<string, unknown>)) {
        const got = resolveInput(v, ep, k, published);
        if (!got.ready) {
          ready = false;
          blocked = `input.${k} = ${JSON.stringify(v)} could not be resolved from this page's data`;
          break;
        }
        input[k] = got.value;
      }
      // The renderer's route-param default: the route's SOLE `[param]`, and only when the endpoint
      // declares that key (`sections/common.tsx` — an undeclared key is a hard 400 pod-side).
      if (ready && params.length === 1 && input[params[0]!] === undefined) {
        const p = params[0]!;
        if (!ep?.inputKeys || ep.inputKeys.includes(p)) {
          const v = poolValue(ep, p);
          if (v !== undefined) input[p] = v;
          else if (ep?.inputKeys?.includes(p)) {
            ready = false;
            blocked = `no ${p} was available — nothing this run fetched from ${parentPathFor(ep, p) || 'the api'} carried one`;
          }
        }
      }

      if (!ready) {
        report.unmeasured.push({ section: i, endpoint: name, reason: blocked });
        continue;
      }

      const res = await callOnce(ep, name, input);
      const ok = res.status >= 200 && res.status < 300;
      const rows = ok ? sectionRows(rec, res.body, published) : [];
      report.calls.push({ endpoint: name, status: res.status, rows: rows.length, ok });

      if (!ok) {
        report.unmeasured.push({ section: i, endpoint: name, reason: `answered ${res.status}` });
        errors.push(
          viewError(
            'render-error',
            `sections[${i}].query`,
            `pages/${route} sections[${i}]: ${name} answered ${res.status}, so this section renders its error ` +
              `state on every load. Fix the endpoint (smoke_endpoints reports the same call).`,
            { file: path, endpoint: name },
          ),
        );
        continue;
      }
      if (rec['id']) published.set(String(rec['id']), res.body);
      measuredSections++;
      const own = checkBindings(report, path, rec, i, rows, ep, name);
      const why = drewNothing(String(rec['kind']), rows, own);
      if (why) report.emptySections.push({ section: i, kind: String(rec['kind']), reason: why });
    }

    // NOT MEASURED is a third answer. A page whose sections never produced data has no coverage to
    // report, and defaulting it to 1 made the metric read perfect exactly where the app was worst.
    report.coverage = report.bindingsChecked === 0 ? null : report.bindingsCovered / report.bindingsChecked;
    const anyRows = report.calls.some((c) => c.ok && c.rows > 0);
    if (measuredSections === 0 && report.unmeasured.length > 0) {
      report.empty = null;
    } else if (report.calls.length === 0 && report.bindingsChecked === 0) {
      report.empty = null; // a page of create/chat/markdown sections — nothing to measure
    } else {
      report.empty = report.bindingsChecked === 0 ? !anyRows : report.bindingsCovered === 0;
      if (report.empty) {
        const detail = anyRows
          ? `${report.bindingsChecked} bound field(s), none of which had a value on any row`
          : `every section's endpoint returned zero rows`;
        errors.push(emptyRender(route, path, detail));
      }
    }

    // A dead section beside a live one. Only when the PAGE is not already reported empty: one
    // finding per page is the whole story there, and N more would just be its parts.
    if (report.empty === true) report.emptySections = [];
    for (const s of report.emptySections) errors.push(emptySection(route, path, s.section, s.kind, s.reason));
    pages.push(report);
  }

  // The real renderer, when this process can import it. Data findings above stand either way.
  //
  // The specifier is a variable on purpose: `@lmthing/ui/view` is Wave 1's UI-RENDERER deliverable
  // and does not resolve until it lands, which a literal `import()` would make a TYPECHECK failure
  // of this package rather than a runtime capability check. When it exists this binds to the real
  // module — the same one the mobile app imports.
  const RENDERER_MODULE = '@lmthing/ui/view';
  let rendererMounted = false;
  let rendererReason: string | undefined;
  try {
    const view = (await import(RENDERER_MODULE)) as {
      ViewRenderer?: unknown;
      ViewThemeProvider?: unknown;
      createViewClient?: (config: Record<string, unknown>) => unknown;
    };
    if (view.ViewRenderer) {
      // Mount with the React the RENDERER was built against, not the one this package depends on.
      // `@lmthing/cli` pins react@18 and `@lmthing/ui` peers react@>=19, so a bare
      // `import('react-dom/server')` here loads 18's renderer and drives a 19 component tree: its
      // hook dispatcher is null and EVERY page throws `Cannot read properties of null (reading
      // 'useMemo')`. That is what kept the render-error tier from ever running during T1 — and it
      // is a resolution question, not a spec defect, so it is answered by resolution. Resolving
      // both halves from the renderer's own location keeps the two in one instance whatever the
      // two package.jsons say; if the versions are ever unified this becomes a no-op.
      const { createRequire } = await import('node:module');
      const here = createRequire(import.meta.url);
      // `require.resolve` gives the renderer's own file, whose directory is inside `@lmthing/ui`;
      // a require rooted there sees that package's react. (`import.meta.resolve` is not used: the
      // test/scenario runners transpile this file with esbuild, which shims it away.)
      const fromRenderer = createRequire(here.resolve(RENDERER_MODULE));
      const { renderToStaticMarkup } = (await import(
        pathToFileURL(fromRenderer.resolve('react-dom/server')).href
      )) as { renderToStaticMarkup: (el: unknown) => string };
      const { createElement } = (await import(pathToFileURL(fromRenderer.resolve('react')).href)) as {
        createElement: (t: unknown, p: unknown) => unknown;
      };
      const components = Object.fromEntries(loaded.components.map((c) => [c.name, c.def]));
      // A real client, from the renderer's own factory — `client.timezone` is read during the
      // first render, so `undefined` throws before a single page mounts. No request is made:
      // `renderToStaticMarkup` runs one synchronous pass and effects never fire, which is exactly
      // the scope of this tier (does the spec MOUNT), the data half having already run above.
      const smokeClient = view.createViewClient?.({
        baseUrl: 'http://render-smoke.invalid',
        endpoints: Object.fromEntries(
          contracts.endpoints.map((e) => [e.name, { method: e.method, routePath: e.routePath ?? `/${e.name}` }]),
        ),
        timezone: 'UTC',
      });
      const thrown: ViewError[] = [];
      let rendered = 0;
      for (const { route, spec, path } of loaded.views) {
        try {
          // Wrapped in the theme provider, exactly as the generated wrapper mounts it
          // (`authoring/globals.ts#renderViewWrapper`): every `Prim.*` primitive reads that
          // context and throws `Missing theme.` without it, so an unwrapped mount would report
          // all N pages broken for a reason no spec edit can fix.
          const tree = createElement(view.ViewRenderer, {
            spec,
            components,
            shell: loaded.shell ?? null,
            client: smokeClient,
          });
          renderToStaticMarkup(
            view.ViewThemeProvider ? createElement(view.ViewThemeProvider, { children: tree }) : tree,
          );
          rendered++;
        } catch (e) {
          thrown.push(renderThrew(route, path, e instanceof Error ? e.message : String(e)));
        }
      }
      // A throw on EVERY page is this process failing to host React, not every page being broken —
      // a duplicated React copy, or a renderer that needs a DOM. Reporting it as N spec defects
      // would fail the gate for a reason no spec edit can fix, and send `17-fix` after twenty
      // innocent pages. Only findings from a process that rendered SOMETHING are trusted.
      rendererMounted = rendered > 0;
      if (rendererMounted) errors.push(...thrown);
      else if (thrown.length) rendererReason = `the renderer threw on all ${thrown.length} page(s): ${thrown[0].message}`;
    }
  } catch (e) {
    // TODO(UI-RENDERER): server-side mounting of `@lmthing/ui/view` is not wired yet (a shared
    // React instance + a client the renderer accepts without a live pod). The DATA half above —
    // binding coverage, always-null bindings, empty-render — runs regardless and is where the
    // measured failure class lives; `rendererMounted:false` says the render-error tier did not run,
    // and is never inferred from an empty finding list.
    rendererReason = e instanceof Error ? e.message : String(e);
  }

  return {
    ...resultOf(errors, loaded.views.length),
    unavailable: false,
    reason: rendererMounted ? undefined : `render-error tier skipped — ${rendererReason ?? 'renderer not importable here'}`,
    pages,
    rendererMounted,
  };
}

/** Convenience for a code node: the three gates merged into one finding list. */
export async function verifyProjectViews(
  projectRoot: string,
  opts: { call?: ApiCaller } = {},
): Promise<ViewValidationResult & { smoke: RenderSmokeResult }> {
  const appWide = await validateAppViews(projectRoot);
  const smoke = await renderSmokeViews(projectRoot, opts);
  const merged = [...appWide.errors, ...smoke.errors];
  return { ...resultOf(merged, appWide.checked), smoke };
}

/** Render a finding list as the text a retry prompt shows. One line per finding, path first. */
export function formatViewErrors(errors: ViewError[]): string {
  return errors
    .map((e) => `${e.severity === 'warning' ? 'warning: ' : ''}${e.file ? `${e.file}: ` : ''}${e.message}`)
    .join('\n');
}

/** Re-exported so a caller can render an ajv `instancePath` the same way the messages do. */
export { prettyPath };
