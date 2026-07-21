/**
 * Emit the app's TYPE CONTRACT — HOST-RUN, so it always executes, and it runs BEFORE the
 * first line of implementation code is written.
 *
 * Why this node exists: until now every implement node authored against names it REMEMBERED.
 * `plan_endpoints` declares `fields` as "the SINGLE SOURCE OF TRUTH for the response shape"
 * (`05-plan_endpoints.md`), and `implement_pages` is told to read exactly those keys — but
 * nothing in the toolchain ever compared the two. The project-app typecheck (`libs/cli/src/app/
 * build/typecheck.ts`) checks pages against `@app/runtime` and the endpoints' *generated*
 * contracts, which are derived FROM the handlers the model wrote — so a page and a handler that
 * agree on a name the PLAN never had still compile clean. The plan's field names only ever
 * existed as prose in a fork's scope. This node turns them into declared TypeScript that exists
 * on disk before `implement_tables` runs, so a divergence is a compiler error instead of an
 * empty card in the shipped app.
 *
 * It never throws on a finding: a code node has no salvage path (a throw fails the whole node
 * and aborts the tasklist), so an unreadable contract, an unwritable file and an unparseable
 * field all come back as DATA. `ok` is a SCALAR — the condition DSL's `getAtPath` returns
 * `undefined` for arrays, so `x.errors.length > 0` is not expressible in a `when:` (see
 * `libs/core/src/spaces/tasklist-load.ts#TaskOnFail`); every array is paired with a count.
 *
 * TARGET FILE — `types/contract.d.ts`, NOT `types/generated.d.ts`.
 * `typecheck.ts` hard-maps the specifier `@app/types` to `<projectRoot>/types/generated.d.ts`
 * (`createProgramHost`), which makes `generated.d.ts` the *only* name reachable by a bare
 * specifier. It is nevertheless the wrong target: `generated.d.ts` is a BUILD ARTIFACT that
 * `generateAppTypes` (`libs/cli/src/app/build/schema.ts`) rewrites from the tables and handlers
 * that actually landed, on every `buildProjectApp()` — writing a contract there would be erased
 * by the first build, which is the exact moment it is supposed to be enforcing something. So the
 * contract lands beside it as `types/contract.d.ts` and is reached by a RELATIVE type-only
 * import (`import type { … } from '../types/contract'`), which `createProgramHost` resolves
 * against the real filesystem like any other relative specifier. Type-only imports are erased by
 * esbuild, so the bundle is unaffected.
 *
 * The emitter below is DUPLICATED verbatim in `11-reconcile_tables.ts`. That is not a style
 * choice: a code node is transpiled ALONE — `worker-load.ts#transpileFile` runs esbuild
 * `transform` (not `bundle`) over the single node file and hands the string to a worker that
 * evaluates it with `new Function(...)` and a `require` shim bound to the worker entry's own
 * path (`worker-load-entry.ts#evalModule`). A sibling `import './lib/…'` would resolve against
 * the wrong directory at runtime. A shared module is also not expressible as a file: `load.ts#
 * loadTasklists` treats EVERY non-`.d.ts` `.ts` in a tasklist dir as a node and requires it to
 * export `run`.
 */

export const node = {
  id: 'emit_types',
  // `validate_contract` is the gate — the contract is only emitted once it has been cross-checked.
  // The three plan nodes are listed because `orchestrator.ts#getUpstreamOutputs` iterates
  // `task.dependsOn` and NOT the transitive closure, and `validate_contract` resolves only
  // `{ ok, errorCount, errors }` — it does not re-emit the plan. With `['validate_contract']`
  // alone this node's `inputs` would contain no tables, no endpoints and no components, and it
  // would emit an empty contract. They add no ordering (`validate_contract` already depends on
  // all three) and no cycle.
  dependsOn: ['validate_contract', 'plan_tables', 'plan_endpoints', 'plan_components'],
  output: {
    ok: 'boolean',
    written: 'boolean',
    path: 'string',
    dts: 'string',
    tableCount: 'number',
    endpointCount: 'number',
    componentCount: 'number',
    endpointNames: 'array',
    error: 'string',
  },
};

/** Every authoring global is proxied into the worker as an ASYNC rpc stub
 *  (`worker-load-entry.ts` builds `authoring[method] = (...a) => rpc('authoring', …)`), while the
 *  same functions are SYNCHRONOUS in-process. Accepting both and awaiting is the only shape that
 *  is correct in the worker and still drivable by a plain mocked ctx in a test. */
type Awaitable<T> = T | Promise<T>;

interface Ctx {
  /** Land a free-form file under the project root. NOT currently part of
   *  `ProjectAuthoringGlobals` (`libs/cli/src/app/authoring/globals.ts`) — see {@link WRITER_GAP}.
   *  Declared optional and probed at call time so its absence is reported as data rather than
   *  crashing the node. */
  writeProjectFile?: (path: string, contents: string) => Awaitable<{ ok: boolean; error?: string }>;
}

/** The path the contract lands at. Relative-imported by project source; never `@app/types`. */
const CONTRACT_PATH = 'types/contract.d.ts';

const WRITER_GAP =
  `cannot write ${CONTRACT_PATH}: the host exposes no free-form project-file writer. ` +
  `ProjectAuthoringGlobals (libs/cli/src/app/authoring/globals.ts) declares only ` +
  `writeProjectTable/Page/Api/Component/Hook/Event/Function, each of which forces its own ` +
  `directory, filename shape and lint (writeProjectComponent even THROWS a LintError for source ` +
  `with no default-exported React component). Wire a writeProjectFile onto ProjectAuthoringGlobals ` +
  `— it is proxied onto a code node's ctx automatically (tasklist-runner.ts#createCodeNodeCtxFactory ` +
  `passes the whole object as \`authoring\`). The full .d.ts text is returned as \`dts\` regardless.`;

// ── contract shapes (grounded in 04/05/06-plan_*.md) ────────────────────────

/** `plan_tables.tables[]` — `{ name, schema: { title, description, columns }, rows }`. */
interface ContractTable {
  name: string;
  schema?: {
    title?: string;
    description?: string;
    columns?: Record<
      string,
      { type?: string; description?: string; primaryKey?: boolean; required?: boolean; enum?: unknown }
    >;
    relations?: Record<string, unknown>;
  };
}

/** `plan_endpoints.endpoints[]` — `{ name, route, purpose, tables, fields }`, where each
 *  `fields` entry is the string `'<key>: <type>'` naming ONE key of `items[0]`. */
interface ContractEndpoint {
  name: string;
  route?: string;
  purpose?: string;
  tables?: string[];
  fields?: unknown[];
}

/** `plan_components.components[]` — `{ name, purpose, props }`, `props` as `'<name>: <type>'`. */
interface ContractComponent {
  name: string;
  purpose?: string;
  props?: unknown[];
}

interface Contract {
  tables: ContractTable[];
  endpoints: ContractEndpoint[];
  components: ContractComponent[];
}

// ── contract → TypeScript ───────────────────────────────────────────────────

/** Column kind → TS type. Mirrors `schema.ts#COLUMN_TS` exactly so the contract and the
 *  build-generated row types cannot disagree about what a `date` or a `json` column is. */
const COLUMN_TS: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  json: 'unknown',
};

/** The type names a plan's `'key: type'` string may use. Anything else degrades to `unknown`
 *  rather than being pasted into the output — a planner is prose, and prose must never be able
 *  to inject arbitrary text into a file the compiler then reads. */
const PLAN_TS: Record<string, string> = {
  ...COLUMN_TS,
  any: 'unknown',
  unknown: 'unknown',
  object: 'unknown',
  null: 'null',
  Date: 'string',
  ISO: 'string',
  text: 'string',
  int: 'number',
  integer: 'number',
  float: 'number',
  bool: 'boolean',
};

/** A column's TS type: a string-literal UNION when it declares a CLOSED `enum` domain (only
 *  meaningful for a `string` column), otherwise the base-kind mapping. This is the RC-2 mechanism —
 *  a domain column emitted as `'paid' | 'owed' | 'unconfirmed'` makes a handler comparing it against
 *  a value the domain never had (`r.status === 'still-owed'`) a compile error, the exact live defect
 *  where `costs-summary` filtered `'still-owed'` while the table stored `'owed'` and every "owed"
 *  total came back $0. An enum with a non-string member, or on a non-string column, is IGNORED —
 *  the domain is strictly opt-in and prose must never widen a mistyped plan into a garbage union. */
function columnTsType(spec: { type?: string; enum?: unknown } | undefined): string {
  const base = COLUMN_TS[String(spec?.type)] ?? 'unknown';
  if (base !== 'string') return base;
  const values = Array.isArray(spec?.enum) ? (spec as { enum: unknown[] }).enum : [];
  const literals = [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))];
  return literals.length > 0 ? literals.map((v) => quote(v)).join(' | ') : base;
}

/** Map one plan-declared type string to a safe TS type (`string[]`, `number | null`, …). */
function tsTypeOf(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return 'unknown';
  const parts = text.split('|').map((p) => p.trim());
  const mapped: string[] = [];
  for (const part of parts) {
    const isArray = part.endsWith('[]');
    const base = (isArray ? part.slice(0, -2) : part).trim();
    const resolved = PLAN_TS[base];
    if (!resolved) return 'unknown'; // one unknown member ⇒ the whole union is unknown
    mapped.push(isArray ? `${resolved}[]` : resolved);
  }
  const unique = [...new Set(mapped)];
  return unique.length > 0 ? unique.join(' | ') : 'unknown';
}

/** `'amount_usd: number'` → `{ key, type }`. Tolerates a bare `'amount_usd'` (⇒ `unknown`) and
 *  an already-structured `{ name, type }` entry. */
function parseField(entry: unknown): { key: string; type: string } | null {
  if (entry && typeof entry === 'object') {
    const o = entry as { name?: unknown; key?: unknown; type?: unknown };
    const key = String(o.name ?? o.key ?? '').trim();
    return key ? { key, type: tsTypeOf(o.type) } : null;
  }
  const text = String(entry ?? '').trim();
  if (!text) return null;
  const colon = text.indexOf(':');
  const key = (colon < 0 ? text : text.slice(0, colon)).trim();
  if (!key) return null;
  return { key, type: colon < 0 ? 'unknown' : tsTypeOf(text.slice(colon + 1)) };
}

/** A property key, quoted only when it is not a bare identifier. */
/** A single-quoted TS string literal (the committed style in this repo). */
function quote(text: string): string {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function propKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

/** `cost-lines` / `feed_items` → `CostLines` / `FeedItems`. Deliberately NOT singularized:
 *  `generated.d.ts` singularizes (`feed_items` → `FeedItem`), and both files can be in scope at
 *  once, so the contract's names must not collide with the build artifact's. */
function pascal(raw: string): string {
  const parts = String(raw ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'Unnamed';
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `T${joined}` : joined;
}

/** Hand out interface names that are unique within the file (a `trips` table and a `trip`
 *  table would otherwise both want `TripsRow`). */
function uniqueNamer(): (base: string) => string {
  const used = new Set<string>();
  return (base: string): string => {
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
    used.add(name);
    return name;
  };
}

/** Route params of `bookings/[id]/PATCH` → `['id']`. These are the values `useApi` must be
 *  called with; the verify gate flags a call that omits them. */
function routeParams(route: unknown): string[] {
  const out: string[] = [];
  for (const seg of String(route ?? '').split('/')) {
    const m = /^\[([A-Za-z0-9_]+)\]$/.exec(seg.trim());
    if (m) out.push(m[1] as string);
  }
  return out;
}

/** One line of JSDoc body: collapsed to a single line and with any comment terminator broken,
 *  so a planner's prose can never close the comment it is being written into. */
function doc(text: unknown): string {
  return String(text ?? '')
    .replace(/\*\//g, '* /')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Section markers, so `11-reconcile_tables` can re-emit the ROW section without losing the
 *  endpoint/component sections when those inputs are not in its (direct-dependency-only) scope. */
const MARK = {
  rows: '// ─────────── rows (database/*.json) ───────────',
  endpoints: '// ─────────── endpoints (api/**) ───────────',
  server: '// ─────────── server (api/** handler surface: ctx.db, ApiCtx, ApiHandler) ───────────',
  components: '// ─────────── components ───────────',
};

const HEADER = [
  '/**',
  ' * types/contract.d.ts — this app\'s TYPE CONTRACT.',
  ' *',
  ' * Emitted by the appbuilder from the AGREED plan BEFORE any implementation code was written,',
  ' * so every endpoint and page is checked against declared names instead of remembered ones.',
  ' *',
  ' * These are GLOBAL AMBIENT types — this file is a .d.ts SCRIPT (no export), and the project-app',
  ' * typecheck loads it as a program root, so every name here is in scope EVERYWHERE with NO import.',
  ' * A page writes `useApi<CostLinesOutput>(...)`, a component `function Row(props: RowProps)`, an',
  ' * endpoint `export type Output = CostLinesOutput` — never an `import`. That is deliberate: an',
  ' * import forces the author to compute a relative depth (`../` vs `../../`) and, when it looks',
  ' * wrong, to abandon the contract; a global type has neither failure mode. NOT `@app/types` either',
  ' * — that maps to `types/generated.d.ts`, which the build regenerates from the code that landed.',
  ' * This file is the other direction: what the code is supposed to be. Generated — do not hand-edit.',
  ' */',
  '',
].join('\n');

/** The row section text PLUS the `table name → its emitted interface name` map — the latter is
 *  what `renderServer` keys `TableRows`/`AppDb` on, so `ctx.db.query('costs')` resolves to the very
 *  interface rendered here. */
function renderRows(tables: ContractTable[]): { text: string; rowTypeByTable: Record<string, string> } {
  const name = uniqueNamer();
  const blocks: string[] = [];
  const rowTypeByTable: Record<string, string> = {};
  for (const table of [...tables].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const columns = table.schema?.columns ?? {};
    const lines: string[] = [];
    const description = doc(table.schema?.description ?? table.schema?.title ?? `Row of ${table.name}`);
    const rowType = name(`${pascal(table.name)}Row`);
    rowTypeByTable[String(table.name)] = rowType;
    lines.push(`/** ${description} (table \`${table.name}\`) */`);
    lines.push(`interface ${rowType} {`);
    const entries = Object.entries(columns);
    if (entries.length === 0) {
      lines.push('  [column: string]: unknown;');
    }
    for (const [column, spec] of entries) {
      // Same optionality rule as `schema.ts#renderRowInterface`: a primary-key or required
      // column is non-optional, everything else is `?`.
      const optional = spec?.primaryKey || spec?.required ? '' : '?';
      const description2 = doc(spec?.description);
      if (description2) lines.push(`  /** ${description2} */`);
      lines.push(`  ${propKey(column)}${optional}: ${columnTsType(spec)};`);
    }
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return {
    text: blocks.length > 0 ? blocks.join('\n\n') : '// (no tables in the contract)',
    rowTypeByTable,
  };
}

/**
 * The SERVER section — the typed surface every `api/**` handler authors against, RC-1's core. Its
 * shapes mirror the REAL runtime exactly (`worker.ts#WorkerCtx` = `{ db, apiCall, spawn }` with NO
 * `params`; `AsyncDbApi`/`QueryOpts`/`UpdateOpts`/`RemoveOpts` in `libs/core/src/db/types.ts`) so a
 * handler that satisfies `ApiHandler` cannot fail at runtime for a shape reason.
 *
 * Three live defects this kills, none catchable before:
 *  - `visa-insurance` shipped `handler(ctx)` — ONE arg — so `ctx` was really the INPUT and
 *    `ctx.db` was `undefined`: a 500 on the first call. With `ApiHandler` a one-arg handler, or one
 *    typing `ctx` as anything but `ApiCtx`, no longer compiles.
 *  - `itinerary/[id]` read `ctx.params.id`; there is no `ctx.params` — the `[id]` value arrives on
 *    the handler's FIRST argument. `ApiCtx` has no `params`, so `ctx.params` is a compile error.
 *  - the same handler ran `ctx.db.query('SELECT * FROM …')`; `db.query` takes a TABLE NAME, and
 *    `keyof TableRows` rejects an arbitrary SQL string.
 *
 * `TableRows` is keyed on the app's real tables; when there are none it degrades to an index
 * signature so `keyof` stays `string` and a table-less app's handlers are unconstrained rather than
 * uncompilable.
 */
function renderServer(rowTypeByTable: Record<string, string>): string {
  const entries = Object.entries(rowTypeByTable);
  const tableRows =
    entries.length > 0
      ? `interface TableRows {\n${entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([table, rowType]) => `  ${propKey(table)}: ${rowType};`)
          .join('\n')}\n}`
      : `interface TableRows { [table: string]: Record<string, unknown>; }`;

  // Static, parameterised only by `TableRows`. `apiCall`'s name is `EndpointName` (rendered in the
  // endpoints section) so a handler calling a sibling endpoint is checked against the real set too.
  const STATIC = `/** \`ctx.db.query\`'s options — mirrors \`QueryOpts\` (libs/core/src/db/types.ts). */
interface AppQueryOpts {
  where?: Record<string, unknown>;
  include?: string[];
  orderBy?: string | { column: string; dir?: 'asc' | 'desc' } | Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
}

/** The typed data API on \`ctx.db\` inside an \`api/**\` handler — the async mirror of \`AsyncDbApi\`,
 *  keyed by the app's REAL table names. \`ctx.db.query('costs')\` returns \`CostsRow[]\`; a raw SQL
 *  string or an unknown table name is a compile error. */
interface AppDb {
  query<K extends keyof TableRows>(table: K, opts?: AppQueryOpts): Promise<TableRows[K][]>;
  tables(): Promise<string[]>;
  insert<K extends keyof TableRows>(table: K, values: Partial<TableRows[K]> | Partial<TableRows[K]>[]): Promise<TableRows[K] | TableRows[K][]>;
  update<K extends keyof TableRows>(table: K, opts: { where: Partial<TableRows[K]>; set: Partial<TableRows[K]> }): Promise<number>;
  remove<K extends keyof TableRows>(table: K, opts: { where: Partial<TableRows[K]> }): Promise<number>;
}

/** The SECOND argument every \`api/**\` handler receives. There is deliberately NO \`params\` — a
 *  route \`[id]\` value arrives on the FIRST argument (the handler's \`Input\`), assembled from the
 *  path by the runtime. Reading \`ctx.params\` is therefore a compile error, by design. */
interface ApiCtx {
  db: AppDb;
  apiCall: (name: EndpointName, input?: Record<string, unknown>) => Promise<unknown>;
  spawn: (ref: string, input?: unknown, opts?: { onError?: (err: unknown) => void | Promise<void> }) => Promise<{ runId: string }>;
}

/** The exact signature of an \`api/**\` handler's default export. Every handler is
 *  \`export default async function handler(input: SomeInput, ctx: ApiCtx): Promise<SomeOutput>\`.
 *  The writer appends \`const _typecheck: ApiHandler<Input, Output> = handler\` at SAVE, so a
 *  one-arg \`(ctx)\` handler, or one typing \`ctx\` as anything but \`ApiCtx\`, is rejected in the same
 *  turn it is written. */
type ApiHandler<Input = Record<string, unknown>, Output = { items: unknown[] }> = (
  input: Input,
  ctx: ApiCtx,
) => Output | Promise<Output>;`;

  return `${tableRows}\n\n${STATIC}`;
}

function renderEndpoints(endpoints: ContractEndpoint[]): string {
  const name = uniqueNamer();
  const blocks: string[] = [];
  for (const endpoint of endpoints) {
    const base = name(pascal(endpoint.name));
    const params = routeParams(endpoint.route);
    const fields = (endpoint.fields ?? []).map(parseField).filter(Boolean) as Array<{ key: string; type: string }>;
    const lines: string[] = [];
    const purpose = doc(endpoint.purpose);
    lines.push(`/** \`${endpoint.name}\`${endpoint.route ? ` — ${endpoint.route}` : ''}${purpose ? `: ${purpose}` : ''} */`);
    lines.push(`interface ${base}Item {`);
    if (fields.length === 0) lines.push('  [field: string]: unknown;');
    for (const field of fields) lines.push(`  ${propKey(field.key)}: ${field.type};`);
    lines.push('}');
    // Every read endpoint answers `{ items: [...] }` — an aggregate is the single summary at
    // `items[0]` (`05-plan_endpoints.md`), so one shape covers both.
    lines.push(`interface ${base}Output { items: ${base}Item[]; }`);
    lines.push(
      params.length > 0
        ? `interface ${base}Input {\n${params.map((p) => `  ${propKey(p)}: string;`).join('\n')}\n}`
        : `type ${base}Input = Record<string, unknown>;`,
    );
    blocks.push(lines.join('\n'));
  }
  const names = endpoints.map((e) => String(e.name)).filter(Boolean);
  const union =
    names.length > 0
      ? `/** Every endpoint name the plan assigned — the exact strings \`useApi\`/\`useApiMutation\`/\n *  \`apiCall\` take, and each handler's \`export const name\`. */\ntype EndpointName =\n${[
          ...new Set(names),
        ]
          .map((n) => `  | ${quote(n)}`)
          .join('\n')};`
      : '/** No endpoints in the contract. */\ntype EndpointName = never;';
  blocks.push(union);
  return blocks.join('\n\n');
}

function renderComponents(components: ContractComponent[]): string {
  const name = uniqueNamer();
  const blocks: string[] = [];
  for (const component of components) {
    const props = (component.props ?? []).map(parseField).filter(Boolean) as Array<{ key: string; type: string }>;
    const lines: string[] = [];
    const purpose = doc(component.purpose);
    lines.push(`/** Props of \`<${component.name} />\`${purpose ? ` — ${purpose}` : ''} */`);
    lines.push(`interface ${name(`${pascal(component.name)}Props`)} {`);
    if (props.length === 0) lines.push('  [prop: string]: unknown;');
    for (const prop of props) lines.push(`  ${propKey(prop.key)}: ${prop.type};`);
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '// (no shared components in the contract)';
}

/** Assemble the three marked sections into the final file. Pre-rendered section text can be
 *  passed straight through — that is how `11-reconcile_tables` preserves sections it cannot
 *  rebuild from its own inputs. */
function assembleDts(sections: { rows: string; endpoints: string; server: string; components: string }): string {
  return [
    HEADER,
    MARK.rows,
    '',
    sections.rows,
    '',
    MARK.endpoints,
    '',
    sections.endpoints,
    '',
    MARK.server,
    '',
    sections.server,
    '',
    MARK.components,
    '',
    sections.components,
    '',
  ].join('\n');
}

/** The contract → the full `.d.ts` text. Pure: same contract in, same bytes out. */
export function emitContractDts(contract: Contract): string {
  const rows = renderRows(contract.tables);
  return assembleDts({
    rows: rows.text,
    endpoints: renderEndpoints(contract.endpoints),
    server: renderServer(rows.rowTypeByTable),
    components: renderComponents(contract.components),
  });
}

// ── inputs ──────────────────────────────────────────────────────────────────

/** Array members that are objects carrying a non-empty `name` — the shape every plan node
 *  resolves. Anything else (a bare list of table NAMES, a null, a stray string) is rejected so
 *  a loosely-shaped upstream never produces a garbage contract. */
function namedItems<T>(value: unknown): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every(
    (v) => v !== null && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' && (v as { name: string }).name !== '',
  );
  return ok ? (value as T[]) : null;
}

/**
 * Pull `tables`/`endpoints`/`components` out of the node's inputs.
 *
 * The orchestrator passes ONLY DIRECT dependencies' outputs
 * (`orchestrator.ts#getUpstreamOutputs` iterates `task.dependsOn`, not the transitive closure),
 * so with `dependsOn: ['validate_contract']` the plan nodes' outputs arrive only if
 * `validate_contract` re-emits them. Each key is therefore looked for in every plausible
 * carrier — the plan node itself, the validator's output, a `contract` envelope, or the input
 * root — and a shape that is not a list of named objects is ignored rather than guessed at.
 */
export function readContract(inputs: Record<string, unknown>): Contract {
  const box = (key: string): Record<string, unknown> => {
    const v = inputs[key];
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  };
  const validate = box('validate_contract');
  const envelope = box('contract');
  const pick = <T>(field: string, own: string): T[] => {
    const candidates = [box(own)[field], validate[field], envelope[field], inputs[field]];
    for (const candidate of candidates) {
      const items = namedItems<T>(candidate);
      if (items) return items;
    }
    return [];
  };
  return {
    tables: pick<ContractTable>('tables', 'plan_tables'),
    endpoints: pick<ContractEndpoint>('endpoints', 'plan_endpoints'),
    components: pick<ContractComponent>('components', 'plan_components'),
  };
}

// ── the node ────────────────────────────────────────────────────────────────

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const contract = readContract(inputs ?? {});
  const dts = emitContractDts(contract);

  let written = false;
  let error = '';
  if (typeof ctx.writeProjectFile === 'function') {
    try {
      const result = await ctx.writeProjectFile(CONTRACT_PATH, dts);
      written = Boolean(result?.ok);
      if (!written) error = String(result?.error ?? 'writeProjectFile returned { ok: false }');
    } catch (e) {
      // A writer fault is a FINDING, never a throw: a throw here aborts the whole tasklist.
      error = `writeProjectFile threw: ${String(e instanceof Error ? e.message : e)}`;
    }
  } else {
    error = WRITER_GAP;
  }

  return {
    ok: written,
    written,
    path: CONTRACT_PATH,
    dts,
    tableCount: contract.tables.length,
    endpointCount: contract.endpoints.length,
    componentCount: contract.components.length,
    endpointNames: contract.endpoints.map((e) => String(e.name)),
    error,
  };
}
