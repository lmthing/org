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

import type { EndpointContract } from '../build/schema.js';
import { braceBody } from '../authoring/lint.js';
import { loadProjectViews, viewSpecPath } from './files.js';
import {
  alwaysNullBinding,
  badBindingRoot,
  badProp,
  classifyBadBinding,
  deadComponent,
  emptyRender,
  expressionAttempt,
  malformedArtifact,
  orphanRoute,
  pageHasNoData,
  prettyPath,
  renderThrew,
  resultOf,
  shapeErrorsToViewErrors,
  unknownComponent,
  unknownEndpoint,
  unknownField,
  unknownInput,
  unknownRoute,
  unknownSection,
  viewError,
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
}

/** Everything outside a single spec that the spec is allowed to name. */
export interface ViewContracts {
  endpoints: ViewEndpoint[];
  /** The app's view components. Absent ⇒ `{ use: … }` references are not resolved. */
  components?: ViewComponentSpec[];
  /** Every authoring route the app has. Absent ⇒ `navigate`/nav targets are not resolved. */
  routes?: string[];
}

/** `ProjectContracts`-shaped input — what `generateProjectContracts` returns. */
interface ContractsLike {
  endpoints: (EndpointContract | ViewEndpoint)[];
  components?: ViewComponentSpec[];
  routes?: string[];
}

/** Object properties of a JSON Schema, seeing through `anyOf`/`oneOf`/`allOf`. */
function schemaProps(s: unknown): Record<string, JsonSchema> {
  if (!s || typeof s !== 'object') return {};
  const rec = s as Record<string, unknown>;
  if (rec['properties'] && typeof rec['properties'] === 'object') {
    return rec['properties'] as Record<string, JsonSchema>;
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = rec[key];
    if (!Array.isArray(branches)) continue;
    const merged: Record<string, JsonSchema> = {};
    for (const b of branches) Object.assign(merged, schemaProps(b));
    if (Object.keys(merged).length) return merged;
  }
  return {};
}

/** The element schema of an array schema. */
function itemsOf(s: unknown): JsonSchema | undefined {
  const items = (s as Record<string, unknown> | undefined)?.['items'];
  return items && typeof items === 'object' && !Array.isArray(items) ? (items as JsonSchema) : undefined;
}

/**
 * The field names a section bound to this Output may legally use.
 *
 * The union of three things, because a section binds in two scopes and the schema cannot tell us
 * which one a given `$.x` sits in without a type checker: the Output's own properties, the
 * element properties when the Output IS an array, and the element properties of each array-valued
 * property (`{ items: Recipe[] }` — the shape 5/5 catalogue apps' list endpoints return).
 */
export function outputFieldUniverse(schema: unknown): string[] {
  const out = new Set<string>();
  const top = schemaProps(schema);
  for (const k of Object.keys(top)) out.add(k);
  for (const k of Object.keys(schemaProps(itemsOf(schema)))) out.add(k);
  for (const v of Object.values(top)) {
    for (const k of Object.keys(schemaProps(itemsOf(v)))) out.add(k);
  }
  return [...out].sort();
}

/** Walk a dotted path (`citations.author`) into a schema, seeing through arrays. */
function schemaAtPath(schema: unknown, segments: string[]): JsonSchema | undefined {
  let cur: unknown = schema;
  for (const seg of segments) {
    const key = seg.replace(/\[\d+\]$/, '');
    const next = schemaProps(cur)[key] ?? schemaProps(itemsOf(cur))[key];
    if (!next) return undefined;
    cur = next;
  }
  return cur as JsonSchema | undefined;
}

/** Accept either `ProjectContracts` (raw JSON Schemas) or an already-reduced {@link ViewContracts}. */
export function toViewContracts(input: ContractsLike | ViewContracts): ViewContracts {
  const endpoints = input.endpoints.map((ep): ViewEndpoint => {
    if ('inputSchema' in ep || 'outputSchema' in ep) {
      const full = ep as EndpointContract;
      return {
        name: full.name,
        method: full.method,
        outputSchema: full.outputSchema,
        outputFields: outputFieldUniverse(full.outputSchema),
        inputKeys: Object.keys(schemaProps(full.inputSchema)),
      };
    }
    return ep as ViewEndpoint;
  });
  return { endpoints, components: input.components, routes: input.routes };
}

// ── the sync, best-effort contract source the WRITERS use ─────────────────────

const METHOD_FILE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/** `export const name = 'listRecipes'` → `listRecipes`. */
function exportedName(src: string): string | undefined {
  return /export\s+const\s+name\s*=\s*['"`]([^'"`]+)['"`]/.exec(src)?.[1];
}

/**
 * Field names of an `export interface X { … }` / `export type X = { … }` block, one nesting level
 * deep — the textual twin of {@link outputFieldUniverse}.
 *
 * A regex where the async path has a real JSON Schema, because the writers are SYNCHRONOUS host
 * globals (mirroring `writeProjectPage`) and `generateProjectContracts` is a `ts-json-schema-
 * generator` run per handler file. It is deliberately lossy: an aliased type (`export type Output =
 * RecipeList`) yields `undefined`, and `undefined` means "skip the field check", never "reject".
 */
function declaredFields(src: string, typeName: 'Input' | 'Output'): string[] | undefined {
  // `[^{;\n]*` and not `[^{]*`: `export type Output = RecipeList;` has no brace of its own, and a
  // greedier scan would walk past the semicolon into the handler body and report ITS locals as
  // Output fields — a menu that is confidently wrong.
  const m = new RegExp(`export\\s+(?:interface|type)\\s+${typeName}\\b[^{;\\n]*\\{`).exec(src);
  if (!m) return undefined;
  const body = braceBody(src, m.index + m[0].length - 1);
  if (body === null) return undefined;
  const keys = interfaceKeys(body);
  const out = new Set(keys);
  // One level in: `items: { id: string; title: string }[]` contributes id/title.
  for (const key of keys) {
    const km = new RegExp(`\\b${key}\\s*\\??\\s*:\\s*[^;\\n]*?\\{`).exec(body);
    if (!km) continue;
    const nested = braceBody(body, km.index + km[0].length - 1);
    if (nested) for (const k of interfaceKeys(nested)) out.add(k);
  }
  return [...out].sort();
}

/**
 * Top-level property names of a TS **interface** body.
 *
 * `lint.ts#topLevelKeys` reads an object LITERAL, whose members are comma-separated; an interface
 * separates with `;` or a newline, so that function stops after the first member here. Same shape,
 * different separator set — and a field list that silently contains one entry would turn every
 * subsequent binding into a menu-shaped lie.
 */
function interfaceKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let atKey = true;
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
      atKey = true;
      continue;
    }
    if (depth !== 0 || !atKey) continue;
    const m = /^\s*(?:readonly\s+)?(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z_$][\w$]*))\s*\??\s*:/.exec(
      body.slice(i),
    );
    if (m) {
      keys.push((m[1] ?? m[2] ?? m[3])!);
      i += m[0].length - 1;
      atKey = false;
    } else if (!/\s/.test(c)) {
      atKey = false;
    }
  }
  return keys;
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
    endpoints.push({
      name,
      method: relative(apiDir, file).split(sep).pop()!.replace(/\.ts$/, ''),
      outputFields: declaredFields(src, 'Output'),
      inputKeys: declaredFields(src, 'Input'),
    });
  }

  const loaded = loadProjectViews(projectRoot);
  return {
    endpoints,
    components: loaded.components.map((c) => c.def),
    routes: loaded.views.map((v) => v.route),
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
  components: Map<string, ViewComponentSpec> | undefined;
  routes: string[] | undefined;
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
  if (!ctx.routes.includes(route)) ctx.errors.push(unknownRoute(path, route, ctx.routes));
}

function checkSectionId(id: string, path: string, ctx: WalkCtx): void {
  if (!ctx.sectionIds.has(id)) ctx.errors.push(unknownSection(path, id, [...ctx.sectionIds]));
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
  }

  // `create` binds no rows: its fields come from the mutation's INPUT schema, not its Output, and
  // the section body carries only page-supplied `input` values.
  const fields =
    kind === 'create'
      ? undefined
      : schema
        ? new Set(outputFieldUniverse(schema))
        : ep?.outputFields
          ? new Set(ep.outputFields)
          : undefined;

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

    if (rec['input']) checkInputKeys(rec['input'], scope.ep, childPath(path, 'input'), ctx);

    if (String(rec['kind']) === 'create') {
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
    mutations: contracts.endpoints.filter((e) => e.method !== 'GET').map((e) => e.name).sort(),
    allNames: contracts.endpoints.map((e) => e.name).sort(),
    components: contracts.components ? new Map(contracts.components.map((c) => [c.name, c])) : undefined,
    routes: contracts.routes,
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
  const base: ViewContracts = { ...toViewContracts(contracts), components, routes };

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

/** What one page's smoke run found. */
export interface ViewSmokeReport {
  route: string;
  /** Endpoints this page called, and what they answered. */
  calls: { endpoint: string; status: number; rows: number; ok: boolean }[];
  /** Bound `$.field` paths that resolved non-null at least once / were checked. */
  bindingsCovered: number;
  bindingsChecked: number;
  /** `bindingsCovered / bindingsChecked`, or `1` when nothing was bindable. */
  coverage: number;
  /** True when the page produced no visible value at all. */
  empty: boolean;
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

/** Rows an endpoint answered with, whatever envelope it used. */
function rowsOf(body: unknown): Record<string, unknown>[] {
  const objects = (a: unknown[]): Record<string, unknown>[] =>
    a.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  if (Array.isArray(body)) return objects(body);
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  // An ENVELOPE's array is the rows even when it is EMPTY — which is the whole point. Treating
  // `{ items: [] }` as one row (the envelope itself) is how a blank page reports as populated.
  const arrays = Object.values(obj).filter(Array.isArray) as unknown[][];
  if (arrays.length) return objects(arrays[0]);
  return [obj];
}

/** Every `$.field` binding in a section, with the instance path it sits at. */
function boundPaths(node: unknown, path: string, out: { path: string; binding: string }[] = []): { path: string; binding: string }[] {
  if (typeof node === 'string') {
    if (node.startsWith('$.') && isBinding(node)) out.push({ path, binding: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => boundPaths(v, `${path}[${i}]`, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) boundPaths(v, childPath(path, k), out);
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

  // Route parameters are filled from ids real rows actually carry, so a `[id]` page is smoked
  // against a record that exists rather than the literal string "undefined" a broken caller sends.
  const paramPool = new Map<string, unknown>();
  const responses = new Map<string, { status: number; body: unknown }>();

  async function callOnce(name: string, input: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
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
    for (const row of rowsOf(res.body)) {
      for (const [k, v] of Object.entries(row)) {
        if (/(^id$|Id$)/.test(k) && (typeof v === 'string' || typeof v === 'number') && !paramPool.has(k)) {
          paramPool.set(k, v);
        }
      }
    }
    return res;
  }

  // Two sweeps: list endpoints first so the id pool is populated before a detail page needs one.
  const ordered = [...loaded.views].sort((a, b) => Number(a.route.includes('[')) - Number(b.route.includes('[')));

  for (const { route, spec, path } of ordered) {
    const report: ViewSmokeReport = {
      route,
      calls: [],
      bindingsCovered: 0,
      bindingsChecked: 0,
      coverage: 1,
      empty: false,
    };
    const params = [...route.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((m) => m[1]);

    for (const [i, section] of spec.sections.entries()) {
      const rec = section as unknown as Record<string, unknown>;
      const name = typeof rec['query'] === 'string' ? rec['query'] : undefined;
      if (!name) continue;
      const ep = byName.get(name);
      const input: Record<string, unknown> = {};
      for (const p of params) {
        const v = paramPool.get(p) ?? paramPool.get('id');
        if (v !== undefined && (!ep?.inputKeys || ep.inputKeys.includes(p))) input[p] = v;
      }
      const res = await callOnce(name, input);
      const rows = rowsOf(res.body);
      const ok = res.status >= 200 && res.status < 300;
      report.calls.push({ endpoint: name, status: res.status, rows: rows.length, ok });

      if (!ok) {
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
      if (rows.length === 0) continue;

      for (const { path: bindPath, binding } of boundPaths(rec, `sections[${i}]`)) {
        report.bindingsChecked++;
        const present = rows.some((row) => !isEmptyValue(readPath(row, binding)));
        if (present) {
          report.bindingsCovered++;
          continue;
        }
        // Declared but never produced: the endpoint's problem, not the page's.
        if (ep?.outputFields?.includes(binding.slice(2).split('.')[0].replace(/\[\d+\]$/, ''))) {
          errors.push(alwaysNullBinding(bindPath, binding, name, rows.length, path));
        }
      }
    }

    report.coverage = report.bindingsChecked === 0 ? 1 : report.bindingsCovered / report.bindingsChecked;
    const anyRows = report.calls.some((c) => c.rows > 0);
    const anyValue = report.bindingsChecked === 0 ? anyRows : report.bindingsCovered > 0;
    report.empty = report.calls.length > 0 && !anyValue;
    if (report.empty) {
      const detail = anyRows
        ? `${report.bindingsChecked} bound field(s), none of which had a value on any row`
        : `every section's endpoint returned zero rows`;
      errors.push(emptyRender(route, path, detail));
    }
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
    const view = (await import(RENDERER_MODULE)) as { ViewRenderer?: unknown };
    if (view.ViewRenderer) {
      const { renderToStaticMarkup } = (await import('react-dom/server')) as {
        renderToStaticMarkup: (el: unknown) => string;
      };
      const { createElement } = (await import('react')) as { createElement: (t: unknown, p: unknown) => unknown };
      const components = Object.fromEntries(loaded.components.map((c) => [c.name, c.def]));
      const thrown: ViewError[] = [];
      let rendered = 0;
      for (const { route, spec, path } of loaded.views) {
        try {
          renderToStaticMarkup(
            createElement(view.ViewRenderer, { spec, components, shell: loaded.shell ?? null, client: undefined }),
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
