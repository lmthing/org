/**
 * Reconcile the CONTRACT to the schema that actually LANDED — HOST-RUN, so it always executes.
 *
 * `emit_types` wrote `types/contract.d.ts` from the PLAN. `implement_tables` then wrote the plan
 * to disk — and the writer is not a passthrough. `writeProjectTable` MERGES an incoming schema
 * with the one already on disk and can never DROP a declared column
 * (`libs/cli/src/app/authoring/globals.ts#mergeWithExistingTable`), because the live table cannot
 * drop one either — `reconcileTable` only ever ADDs columns to the running SQLite table. Its own
 * doc records the fault that forced it: a 9-column redefinition over a 13-column table left the
 * declaration describing a table the runtime did not have, and every downstream consumer reads the
 * DECLARATION, so the surviving columns silently left the DTS, the marshalling and the pages.
 *
 * The consequence for the contract is direct: after `implement_tables`, `database/*.json` and
 * `plan_tables.tables` can legitimately disagree — a retried element, a name the writer corrected
 * to snake_case, a column merged in from a pre-existing table. Types emitted from the plan would
 * then be a lie at exactly the moment `implement_endpoints` and `implement_views` start compiling
 * against them. So the LANDED schema is ground truth: this node re-reads `database/*.json`,
 * rebuilds the row types from it, and re-emits the contract.
 *
 * Column drift is reconciled SILENTLY — an extra column is the merge working as designed, not a
 * fault. A MISSING table is different: it is a planning failure, and every endpoint planned
 * against it will pass the compiler (the db surface is dynamically typed) and 500 at runtime. That
 * alone resolves `ok: false`, carrying the names.
 *
 * The SECOND failure a planner can cause is a SINGULAR/PLURAL DUPLICATE of one entity — `dog` AND
 * `dogs`, `walk` AND `walks` both real on disk, endpoints split across both. `plan_tables` now
 * bans it (one canonical plural noun per entity, reused, never re-spelled), but a build that
 * ignores that still lands two files, and each is REAL so neither counts as missing — the old
 * reconcile let both pass as distinct. There is no safe merge here: collapsing would rename one
 * file and re-wire every endpoint already compiled against it, which the writer surface (free-form
 * `writeProjectFile` only — no rename/delete) cannot do without silently dropping or copying
 * rows. So a detected pair resolves `ok: false` and is reported as a `singular-plural-collision`
 * drift finding NAMING both tables + the canonical one to keep — loud, never silent.
 *
 * `ok` is a SCALAR paired with counts: the condition DSL's `getAtPath` returns `undefined` for
 * arrays, so `reconcile_tables.missing.length > 0` is not expressible in a `when:` (see
 * `libs/core/src/spaces/tasklist-load.ts#TaskOnFail`). And nothing here throws on a finding — a
 * code node has no salvage path, so a throw fails the whole node and aborts the tasklist.
 *
 * DUPLICATION IS DELIBERATE — do not "helpfully" refactor the emitter below into a module shared
 * with `09-emit_types.ts`. A code node is transpiled ALONE: `worker-load.ts#transpileFile` runs
 * esbuild `transform` (loader 'ts', format 'cjs'), NOT `build`/`bundle`, and the resulting string
 * is evaluated by `worker-load-entry.ts#evalModule` via `new Function(module, exports, require)`
 * with a `require` shim bound to the worker entry's own path. A relative `require('./shared.js')`
 * therefore fails at require time and takes the whole tasklist down. A shared file is not
 * expressible in the directory either: `load.ts#loadTasklists` treats EVERY non-`.d.ts` `.ts` in a
 * tasklist dir as a node and requires it to export `run`. `13-smoke_endpoints.ts` duplicates
 * `16-verify.ts`'s scanners for the same reason.
 */

export const node = {
  id: 'reconcile_tables',
  // `implement_tables` is the gate — this node reads what it wrote. The three plan nodes are
  // listed because `orchestrator.ts#getUpstreamOutputs` iterates `task.dependsOn` and NOT the
  // transitive closure: an upstream output that is not a DIRECT dependency simply is not in
  // `inputs`. They add no ordering (all three already run before `implement_tables`) and no
  // cycle; without them this node could not see the contract it is reconciling.
  dependsOn: ['implement_tables', 'plan_tables', 'plan_endpoints', 'plan_view_components'],
  output: {
    ok: 'boolean',
    written: 'boolean',
    path: 'string',
    dts: 'string',
    missing: 'array',
    missingCount: 'number',
    drift: 'array',
    driftCount: 'number',
    collisions: 'array',
    collisionsCount: 'number',
    landed: 'array',
    error: 'string',
  },
};

/** Every authoring global is proxied into the worker as an ASYNC rpc stub
 *  (`worker-load-entry.ts` builds `authoring[method] = (...a) => rpc('authoring', …)`), while the
 *  same functions are SYNCHRONOUS in-process. Accepting both and awaiting is the only shape that
 *  is correct in the worker and still drivable by a plain mocked ctx in a test. */
type Awaitable<T> = T | Promise<T>;

interface Ctx {
  listProjectDir: (dir: string) => Awaitable<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Awaitable<{ ok: boolean; content: string; error?: string }>;
  /** Land a free-form file under the project root. NOT currently part of
   *  `ProjectAuthoringGlobals` (`libs/cli/src/app/authoring/globals.ts`) — see {@link WRITER_GAP}.
   *  Declared optional and probed at call time so its absence is reported as data. */
  writeProjectFile?: (path: string, contents: string) => Awaitable<{ ok: boolean; error?: string }>;
}

/** The path the contract lands at — the same file `09-emit_types.ts` wrote. Reached by project
 *  source through a RELATIVE type-only import, never `@app/types` (that specifier is hard-mapped
 *  to `types/generated.d.ts`, a build artifact `generateAppTypes` rewrites on every build). */
const CONTRACT_PATH = 'types/contract.d.ts';

const WRITER_GAP =
  `cannot write ${CONTRACT_PATH}: the host exposes no free-form project-file writer. ` +
  `ProjectAuthoringGlobals (libs/cli/src/app/authoring/globals.ts) declares only ` +
  `writeProjectTable/Page/Api/Component/Hook/Event/Function, each of which forces its own ` +
  `directory, filename shape and lint. Wire a writeProjectFile onto ProjectAuthoringGlobals — it ` +
  `is proxied onto a code node's ctx automatically (tasklist-runner.ts#createCodeNodeCtxFactory ` +
  `passes the whole object as \`authoring\`). The full .d.ts text is returned as \`dts\` regardless.`;

// ── contract shapes (grounded in 04/05/06-plan_*.md) ────────────────────────

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

interface ContractEndpoint {
  name: string;
  route?: string;
  purpose?: string;
  tables?: string[];
  fields?: unknown[];
  /**
   * A WRITE endpoint's request-body keys, as `'key: type'` — verbatim twin of
   * `09-emit_types.ts#ContractEndpoint.input`. It has to be carried HERE too, and forgetting it was
   * a silent total regression: this node re-emits the WHOLE contract from disk, so a version of
   * `renderEndpoints` that ignores `input` does not merely fail to add the body — it OVERWRITES the
   * good `interface <Base>Input` that `emit_types` had already written with the typeless
   * `Record<string, unknown>` fallback. Measured on `13-plant-care` run 8: `plan_endpoints` declared
   * `input` on `create-plant` in all three planning rounds, `emit_types` resolved the correct
   * 4-property interface, and the file on disk still ended up with
   * `type CreatePlantInput = Record<string, unknown>;` — because this twin ran after it.
   */
  input?: unknown[];
}

interface ContractComponent {
  name: string;
  purpose?: string;
  props?: unknown[];
}

// ── contract → TypeScript (verbatim twin of 09-emit_types.ts; see the module doc) ──

/** Column kind → TS type. Mirrors `schema.ts#COLUMN_TS` exactly. */
const COLUMN_TS: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  json: 'unknown',
};

/** A column's TS type: a string-literal UNION for a `string` column with a CLOSED `enum` domain,
 *  else the base mapping. RC-2 — verbatim twin of `09-emit_types.ts#columnTsType`. Here the domain
 *  comes off the LANDED schema, so the union tracks what actually persisted. */
function columnTsType(spec: { type?: string; enum?: unknown } | undefined): string {
  const base = COLUMN_TS[String(spec?.type)] ?? 'unknown';
  if (base !== 'string') return base;
  const values = Array.isArray(spec?.enum) ? (spec as { enum: unknown[] }).enum : [];
  const literals = [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))];
  return literals.length > 0 ? literals.map((v) => quote(v)).join(' | ') : base;
}

/** The type names a plan's `'key: type'` string may use. Anything else degrades to `unknown`. */
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

function tsTypeOf(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return 'unknown';
  const parts = text.split('|').map((p) => p.trim());
  const mapped: string[] = [];
  for (const part of parts) {
    const isArray = part.endsWith('[]');
    const base = (isArray ? part.slice(0, -2) : part).trim();
    const resolved = PLAN_TS[base];
    if (!resolved) return 'unknown';
    mapped.push(isArray ? `${resolved}[]` : resolved);
  }
  const unique = [...new Set(mapped)];
  return unique.length > 0 ? unique.join(' | ') : 'unknown';
}

/** A parsed `fields`/`props` entry — verbatim twin of `09-emit_types.ts#ParsedField`. */
interface ParsedField {
  key: string;
  type: string;
  nested?: { item: ParsedField[]; list: boolean; nullable: boolean };
}

function parseField(entry: unknown): ParsedField | null {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const o = entry as {
      name?: unknown; key?: unknown; type?: unknown;
      item?: unknown; fields?: unknown; list?: unknown; array?: unknown; nullable?: unknown;
    };
    const key = String(o.name ?? o.key ?? '').trim();
    if (!key) return null;
    const rawItem = Array.isArray(o.item) ? o.item : Array.isArray(o.fields) ? o.fields : null;
    if (rawItem) {
      const item = rawItem.map(parseField).filter(Boolean) as ParsedField[];
      if (item.length > 0) {
        const typeText = String(o.type ?? '');
        const list = o.list === true || o.array === true || typeText.endsWith('[]');
        const nullable = o.nullable === true || /\|\s*null\b/.test(typeText);
        return { key, type: '', nested: { item, list, nullable } };
      }
    }
    return { key, type: tsTypeOf(o.type) };
  }
  const text = String(entry ?? '').trim();
  if (!text) return null;
  const colon = text.indexOf(':');
  const key = (colon < 0 ? text : text.slice(0, colon)).trim();
  if (!key) return null;
  return { key, type: colon < 0 ? 'unknown' : tsTypeOf(text.slice(colon + 1)) };
}

/** A single-quoted TS string literal (the committed style in this repo). */
function quote(text: string): string {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function propKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

/** `cost-lines` / `feed_items` → `CostLines` / `FeedItems`. Deliberately NOT singularized —
 *  `generated.d.ts` singularizes, and both files can be in scope at once. */
function pascal(raw: string): string {
  const parts = String(raw ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'Unnamed';
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(joined) ? `T${joined}` : joined;
}

function uniqueNamer(): (base: string) => string {
  const used = new Set<string>();
  return (base: string): string => {
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}${n}`;
    used.add(name);
    return name;
  };
}

function routeParams(route: unknown): string[] {
  const out: string[] = [];
  for (const seg of String(route ?? '').split('/')) {
    const m = /^\[([A-Za-z0-9_]+)\]$/.exec(seg.trim());
    if (m) out.push(m[1] as string);
  }
  return out;
}

/** A few common English irregular plurals → singular, spelled snake_case. The regular rules in
 *  {@link singularize} handle `walks`/`dogs`/`categories`; these are the ones those rules would
 *  miss (`people`→`person`). Small and closed on purpose. */
const IRREGULAR_SINGULAR: Record<string, string> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  mice: 'mouse',
  teeth: 'tooth',
  geese: 'goose',
};

/** The best-effort singular of a snake_case plural table name. `walks` → `walk`, `categories` →
 *  `category`, `boxes` → `box`, `people` → `person`. Terse on purpose: it only has to be right
 *  enough to flag the duplicate-entity bug; a miss just means that particular spelling pair is not
 *  auto-detected (safe — the plan_tables rule still forbids it), and via the irregular map the
 *  common cases are covered. */
function singularize(name: string): string {
  const known = IRREGULAR_SINGULAR[name];
  if (known) return known;
  // ...ies -> y (bodies, categories)
  if (name.endsWith('ies') && name.length > 3) return `${name.slice(0, -3)}y`;
  // ...es after s/x/z/ch/sh -> strip the 'es' (boxes, addresses, crashes, branches)
  if (/[sxz]$/.test(name) && name.endsWith('es') && name.length > 2) return name.slice(0, -2);
  if (/(ches|shes)$/.test(name) && name.length > 4) return name.slice(0, -2);
  // plain -s (walks, dogs) — but NOT a genuine -ss word (status, glass, address stays itself)
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 1) return name.slice(0, -1);
  return name;
}

/**
 * Detect two table names that are the SAME entity under a singular/plural spelling — `dog`+`dogs`,
 * `walk`+`walks`, `category`+`categories`, `person`+`people`. Collision is decided by comparing the
 * REDUCED singular of both sides, which is symmetric: whichever direction the pluralizer caught, the
 * two names collapse to the same singular iff they are the same entity. Conservative by
 * construction: two names collide only if one is a plausible inflection of the other, so a
 * `trips`/`cost_lines` app is untouched. Returns the pair as `[dropped, canonical]` where canonical
 * is the plural form — the name the build should keep — or `null` when not the same entity.
 */
function pluralCollision(a: string, b: string): [string, string] | null {
  if (a === b) return null;
  const singularA = singularize(a);
  const singularB = singularize(b);
  // Same reduced singular ⇒ same entity (dog/dogs, category/categories, person/people). This test
  // is symmetric, so it catches both orientations regardless of which side the pluralizer saw.
  if (singularA !== singularB) return null;
  // canonical = the plural; the shorter (singular) form is the one to retire.
  return singularize(a) === a ? [a, b] : [b, a];
}

/** Reduce a landed table list to the canonical member of any singular/plural pair, naming both.
 *  Each pair is reported exactly once; a table already consumed by one pair cannot join a second.
 *  \`canonical\` is the plural form — the name the build should keep (convention in \`plan_tables\`). */
function findPluralCollisions(landed: string[]): Array<{ dropped: string; canonical: string }> {
  const out: Array<{ dropped: string; canonical: string }> = [];
  const used = new Set<string>();
  for (const name of [...landed].sort()) {
    if (used.has(name)) continue;
    for (const other of landed) {
      if (name === other || used.has(other)) continue;
      const pair = pluralCollision(name, other);
      if (!pair) continue;
      const [dropped, canonical] = pair;
      out.push({ dropped, canonical });
      used.add(name);
      used.add(other);
      break;
    }
    used.add(name);
  }
  return out;
}

function doc(text: unknown): string {
  return String(text ?? '')
    .replace(/\*\//g, '* /')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Section markers. They are what lets this node re-emit the ROW section from disk without
 *  losing sections it cannot rebuild — see {@link sectionsOf}. */
const MARK = {
  rows: '// ─────────── rows (database/*.json) ───────────',
  endpoints: '// ─────────── endpoints (api/**) ───────────',
  server: '// ─────────── server (api/** handler surface: ctx.db, ApiCtx, ApiHandler) ───────────',
  components: '// ─────────── components ───────────',
};

/** Per-endpoint markers — the verbatim twin of `09-emit_types.ts`. They are what makes the
 *  contract ADDITIVE across runs (see {@link carryForwardEndpoints}); this node must emit them
 *  too, because when `plan_endpoints` reaches it, it re-renders the endpoints section itself and
 *  would otherwise delete what `emit_types` had just preserved. */
const ENDPOINT_MARK = '//#endpoint ';
const ENDPOINT_NAMES_MARK = '//#endpoint-names';

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

/** The SERVER section — the typed `api/**` handler surface (`ctx.db`, `ApiCtx`, `ApiHandler`).
 *  Verbatim twin of `09-emit_types.ts#renderServer`; here `TableRows` is keyed on the LANDED tables,
 *  so `ctx.db.query` tracks what actually persisted. See that node's doc for the RC-1 rationale. */
function renderServer(rowTypeByTable: Record<string, string>): string {
  const entries = Object.entries(rowTypeByTable);
  const tableRows =
    entries.length > 0
      ? `interface TableRows {\n${entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([table, rowType]) => `  ${propKey(table)}: ${rowType};`)
          .join('\n')}\n}`
      : `interface TableRows { [table: string]: Record<string, unknown>; }`;

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
 *  \`export default async function handler(input: <Base>Input, ctx: ApiCtx): Promise<<Base>Output>\`.
 *  The writer REJECTS an \`any\`/\`Promise<any>\` boundary and a return that is not the endpoint's
 *  contract \`<Base>Output\` (\`lint.ts#apiHandlerTypingError\`). */
type ApiHandler<Input = Record<string, unknown>, Output = { items: unknown[] }> = (
  input: Input,
  ctx: ApiCtx,
) => Output | Promise<Output>;`;

  return `${tableRows}\n\n${STATIC}`;
}

/** Verbatim twin of `09-emit_types.ts#renderShape` — render an object shape to a NAMED interface plus
 *  the interfaces its nested `item` fields need, so list/record data is structural, never a `string`. */
function renderShape(
  topName: string,
  childPrefix: string,
  fields: ParsedField[],
  name: (base: string) => string,
  placeholder: string,
): { typeName: string; preBlocks: string[]; block: string } {
  const preBlocks: string[] = [];
  const body: string[] = [];
  for (const field of fields) {
    if (field.nested) {
      const prefix = `${childPrefix}${pascal(field.key)}`;
      const child = renderShape(`${prefix}Item`, prefix, field.nested.item, name, 'field');
      preBlocks.push(...child.preBlocks, child.block);
      const suffix = `${field.nested.list ? '[]' : ''}${field.nested.nullable ? ' | null' : ''}`;
      body.push(`  ${propKey(field.key)}: ${child.typeName}${suffix};`);
    } else {
      body.push(`  ${propKey(field.key)}: ${field.type};`);
    }
  }
  if (body.length === 0) body.push(`  [${placeholder}: string]: unknown;`);
  const typeName = name(topName);
  return { typeName, preBlocks, block: [`interface ${typeName} {`, ...body, '}'].join('\n') };
}

function renderEndpoints(endpoints: ContractEndpoint[], carried: CarriedEndpoint[] = []): string {
  const name = uniqueNamer();
  const blocks: string[] = [];
  for (const endpoint of endpoints) {
    const base = name(pascal(endpoint.name));
    const params = routeParams(endpoint.route);
    const fields = (endpoint.fields ?? []).map(parseField).filter(Boolean) as ParsedField[];
    const item = renderShape(`${base}Item`, base, fields, name, 'field');
    const lines: string[] = [`${ENDPOINT_MARK}${endpoint.name}`];
    for (const pre of item.preBlocks) lines.push(pre, '');
    const purpose = doc(endpoint.purpose);
    lines.push(`/** \`${endpoint.name}\`${endpoint.route ? ` — ${endpoint.route}` : ''}${purpose ? `: ${purpose}` : ''} */`);
    lines.push(item.block);
    lines.push(`interface ${base}Output { items: ${item.typeName}[]; }`);
    /**
     * `Input` = the route's parameters PLUS the declared request body — verbatim twin of
     * `09-emit_types.ts#renderEndpoints`. See {@link ContractEndpoint.input} for why omitting it here
     * is worse than omitting it there: this node re-emits the whole file, so the old params-only
     * version silently UNDID the body that had already been emitted.
     */
    const bodyFields = (endpoint.input ?? []).map(parseField).filter(Boolean) as ParsedField[];
    const inputProps = [
      ...params.map((p) => `  ${propKey(p)}: string;`),
      ...bodyFields
        // A route param and a body key of the same name are the same value; the path wins.
        .filter((f) => !params.includes(f.key.replace(/\?$/, '')))
        .map((f) => {
          const optional = f.key.endsWith('?');
          const key = f.key.replace(/\?$/, '');
          const type = f.type && f.type.trim() !== '' ? f.type : 'unknown';
          return `  ${propKey(key)}${optional ? '?' : ''}: ${type};`;
        }),
    ];
    lines.push(
      inputProps.length > 0
        ? `interface ${base}Input {\n${inputProps.join('\n')}\n}`
        : `type ${base}Input = Record<string, unknown>;`,
    );
    blocks.push(lines.join('\n'));
  }

  // Verbatim twin of `09-emit_types.ts#renderEndpoints`: an endpoint a PREVIOUS contract declared
  // that this plan does not mention keeps its declarations, unless a planned endpoint already
  // claims one of its identifiers (a duplicate `interface` is a compile error).
  const claimed = new Set(declaredNames(blocks.join('\n')));
  const kept: string[] = [];
  for (const entry of carried) {
    const own = declaredNames(entry.text);
    if (own.some((n) => claimed.has(n))) continue;
    for (const n of own) claimed.add(n);
    kept.push(entry.name);
    blocks.push(`${ENDPOINT_MARK}${entry.name}\n${entry.text}`);
  }

  const names = [...endpoints.map((e) => String(e.name)).filter(Boolean), ...kept];
  const union =
    names.length > 0
      ? `/** Every endpoint name the plan assigned — the exact strings \`useApi\`/\`useApiMutation\`/\n *  \`apiCall\` take, and each handler's \`export const name\`. */\ntype EndpointName =\n${[
          ...new Set(names),
        ]
          .map((n) => `  | ${quote(n)}`)
          .join('\n')};`
      : '/** No endpoints in the contract. */\ntype EndpointName = never;';
  blocks.push(`${ENDPOINT_NAMES_MARK}\n${union}`);
  return blocks.join('\n\n');
}

/** An endpoint block lifted verbatim out of a previously-emitted contract. */
interface CarriedEndpoint {
  name: string;
  text: string;
}

/** Every top-level `interface X` / `type X` a block declares — the collision key for a carry-forward. */
function declaredNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
    if (m) out.push(m[1] as string);
  }
  return out;
}

/**
 * Endpoints a previously-emitted contract declared that the current plan does not mention.
 *
 * The full rationale is on `09-emit_types.ts#carryForwardEndpoints`. The short version: a
 * follow-up request re-plans only what IT is about, so re-emitting from the plan alone deleted the
 * types every already-shipped handler compiles against — measured live, it took a working app to
 * `POST …/app/build → 400` and a 404 root route. `section` is the endpoints section text (this
 * node has already sliced it with {@link sectionsOf}).
 */
function carryForwardEndpoints(section: string, planned: Set<string>): CarriedEndpoint[] {
  if (!section) return [];
  const out: CarriedEndpoint[] = [];
  let current: CarriedEndpoint | null = null;
  let lines: string[] = [];
  const flush = (): void => {
    if (current) {
      const text = lines.join('\n').trim();
      if (text) out.push({ name: current.name, text });
    }
    current = null;
    lines = [];
  };
  for (const line of section.split('\n')) {
    if (line.startsWith(ENDPOINT_NAMES_MARK)) {
      flush();
      break;
    }
    if (line.startsWith(ENDPOINT_MARK)) {
      flush();
      const name = line.slice(ENDPOINT_MARK.length).trim();
      if (name && !planned.has(name)) current = { name, text: '' };
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return out;
}

function renderComponents(components: ContractComponent[]): string {
  const name = uniqueNamer();
  const blocks: string[] = [];
  for (const component of components) {
    const props = (component.props ?? []).map(parseField).filter(Boolean) as ParsedField[];
    const top = `${pascal(component.name)}Props`;
    const shape = renderShape(top, top, props, name, 'prop');
    const lines: string[] = [];
    for (const pre of shape.preBlocks) lines.push(pre, '');
    const purpose = doc(component.purpose);
    lines.push(`/** Props of \`<${component.name} />\`${purpose ? ` — ${purpose}` : ''} */`);
    lines.push(shape.block);
    blocks.push(lines.join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '// (no shared components in the contract)';
}

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

/**
 * Split a previously-emitted contract back into its three marked sections.
 *
 * This is the safety net for a section this node cannot rebuild. Its inputs are the plan's
 * endpoints/components, and `orchestrator.ts#getUpstreamOutputs` only passes DIRECT dependencies
 * — so if the wiring ever changes and one of them stops arriving, re-emitting from an empty list
 * would DELETE working type declarations from the file. Falling back to the text already on disk
 * makes that failure mode structurally impossible: the worst case is a stale section, never a
 * missing one. Returns `null` for anything that is not a file this emitter wrote.
 */
function sectionsOf(text: string): { rows: string; endpoints: string; server: string; components: string } | null {
  const rowsAt = text.indexOf(MARK.rows);
  const endpointsAt = text.indexOf(MARK.endpoints);
  const serverAt = text.indexOf(MARK.server);
  const componentsAt = text.indexOf(MARK.components);
  if (rowsAt < 0 || endpointsAt < rowsAt || serverAt < endpointsAt || componentsAt < serverAt) return null;
  return {
    rows: text.slice(rowsAt + MARK.rows.length, endpointsAt).trim(),
    endpoints: text.slice(endpointsAt + MARK.endpoints.length, serverAt).trim(),
    server: text.slice(serverAt + MARK.server.length, componentsAt).trim(),
    components: text.slice(componentsAt + MARK.components.length).trim(),
  };
}

// ── inputs ──────────────────────────────────────────────────────────────────

function namedItems<T>(value: unknown): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every(
    (v) => v !== null && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' && (v as { name: string }).name !== '',
  );
  return ok ? (value as T[]) : null;
}

/** Pull one contract list out of the inputs, looking in every plausible carrier (the plan node
 *  itself, a `validate_contract`/`contract` envelope, the input root). A shape that is not a list
 *  of named objects is ignored rather than guessed at. */
function pick<T>(inputs: Record<string, unknown>, field: string, own: string): T[] | null {
  const box = (key: string): Record<string, unknown> => {
    const v = inputs[key];
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  };
  const candidates = [box(own)[field], box('validate_contract')[field], box('contract')[field], inputs[field]];
  for (const candidate of candidates) {
    const items = namedItems<T>(candidate);
    if (items) return items;
  }
  return null;
}

// ── the node ────────────────────────────────────────────────────────────────

/** One reconciled difference between the plan and what is on disk. Most are reported, never
 *  failed on; `singular-plural-collision` is the exception — it FAILS the node (see the module
 *  doc: a duplicate entity split across two tables cannot be merged safely, only surfaced). */
interface Drift {
  table: string;
  kind: 'extra-columns' | 'absent-columns' | 'unplanned-table' | 'unreadable-schema' | 'singular-plural-collision';
  columns?: string[];
  detail?: string;
}

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = inputs ?? {};
  const planned = pick<ContractTable>(input, 'tables', 'plan_tables') ?? [];
  const plannedByName = new Map(planned.map((t) => [String(t.name), t]));

  // ── the landed schema is ground truth ──
  const listing = await ctx.listProjectDir('database');
  const landedNames = (listing?.entries ?? []).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));

  const landed: ContractTable[] = [];
  const drift: Drift[] = [];
  for (const name of landedNames) {
    const read = await ctx.readProjectFile(`database/${name}.json`);
    let schema: ContractTable['schema'];
    try {
      const parsed = JSON.parse(read?.content || '{}') as ContractTable['schema'];
      schema = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      // A corrupt declaration is a finding, not a throw. The table still EXISTS (so it is not
      // "missing"); it simply contributes an open row type until someone fixes the file.
      drift.push({
        table: name,
        kind: 'unreadable-schema',
        detail: `database/${name}.json did not parse as JSON: ${String(e instanceof Error ? e.message : e)}`,
      });
      schema = {};
    }
    landed.push({ name, schema });

    const onDisk = Object.keys(schema?.columns ?? {});
    const plan = plannedByName.get(name);
    if (!plan) {
      // A table on disk the plan never named — a write-time name correction, or a table the
      // project already had. It is REAL, so it gets row types either way.
      drift.push({ table: name, kind: 'unplanned-table' });
      continue;
    }
    const planned2 = Object.keys(plan.schema?.columns ?? {});
    const extra = onDisk.filter((c) => !planned2.includes(c));
    const absent = planned2.filter((c) => !onDisk.includes(c));
    // Both directions are reconciled SILENTLY — `writeProjectTable` MERGES and never drops, so an
    // extra column is the writer working as designed. Reported so the run is auditable.
    if (extra.length > 0) drift.push({ table: name, kind: 'extra-columns', columns: extra });
    if (absent.length > 0) drift.push({ table: name, kind: 'absent-columns', columns: absent });
  }

  // ── the ONE failure: a planned table that is entirely absent ──
  const missing = planned.map((t) => String(t.name)).filter((n) => !landedNames.includes(n));

  // ── the SECOND failure: a singular/plural duplicate of one entity (dog AND dogs, walk AND walks).
  // Both are REAL on disk, so neither lands in `missing` — old reconcile let both pass as distinct.
  // There is no safe automatic merge (no rename/delete writer; collapsing would orphan every
  // endpoint already compiled against one name), so report each pair LOUDLY and fail.
  const collisions = findPluralCollisions(landedNames);
  for (const c of collisions) {
    drift.push({
      table: c.dropped,
      kind: 'singular-plural-collision',
      detail: `"${c.dropped}" and "${c.canonical}" are the SAME entity under singular/plural spelling — keep ONLY "${c.canonical}" (plural) and remove "${c.dropped}"; endpoints are split across both and would double-count.`,
    });
  }

  // ── re-emit, preserving any section this node's inputs cannot rebuild ──
  const previous = await ctx.readProjectFile(CONTRACT_PATH);
  const prior = previous?.ok ? sectionsOf(previous.content || '') : null;
  const endpoints = pick<ContractEndpoint>(input, 'endpoints', 'plan_endpoints');
  const components = pick<ContractComponent>(input, 'components', 'plan_view_components');
  const rows = renderRows(landed);
  // Re-rendering the endpoints section from the plan must not DELETE an endpoint the plan does not
  // mention — on a follow-up edit that is every endpoint the app already shipped.
  const plannedEndpointNames = new Set((endpoints ?? []).map((e) => String(e.name)).filter(Boolean));
  const dts = assembleDts({
    rows: rows.text,
    endpoints: endpoints
      ? renderEndpoints(endpoints, carryForwardEndpoints(prior?.endpoints ?? '', plannedEndpointNames))
      : (prior?.endpoints ?? renderEndpoints([])),
    // The server surface is keyed on the LANDED tables (ground truth), always re-rendered fresh —
    // `ctx.db.query` must track what actually persisted, not a stale prior emission.
    server: renderServer(rows.rowTypeByTable),
    components: components ? renderComponents(components) : (prior?.components ?? renderComponents([])),
  });

  let written = false;
  let error = '';
  if (typeof ctx.writeProjectFile === 'function') {
    try {
      const result = await ctx.writeProjectFile(CONTRACT_PATH, dts);
      written = Boolean(result?.ok);
      if (!written) error = String(result?.error ?? 'writeProjectFile returned { ok: false }');
    } catch (e) {
      error = `writeProjectFile threw: ${String(e instanceof Error ? e.message : e)}`;
    }
  } else {
    error = WRITER_GAP;
  }

  return {
    // Column drift is reconciled, not failed on. A failure is a table that never landed — every
    // endpoint planned against it compiles clean and 500s at runtime — OR a singular/plural
    // duplicate that landed, which would split endpoints across two copies. Both fail loudly.
    ok: missing.length === 0 && collisions.length === 0,
    written,
    path: CONTRACT_PATH,
    dts,
    missing,
    missingCount: missing.length,
    drift,
    driftCount: drift.length,
    collisions,
    collisionsCount: collisions.length,
    landed: landedNames,
    error,
  };
}
