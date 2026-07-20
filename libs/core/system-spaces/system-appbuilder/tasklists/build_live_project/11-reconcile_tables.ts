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
 * then be a lie at exactly the moment `implement_endpoints` and `implement_pages` start compiling
 * against them. So the LANDED schema is ground truth: this node re-reads `database/*.json`,
 * rebuilds the row types from it, and re-emits the contract.
 *
 * Column drift is reconciled SILENTLY — an extra column is the merge working as designed, not a
 * fault. A MISSING table is different: it is a planning failure, and every endpoint planned
 * against it will pass the compiler (the db surface is dynamically typed) and 500 at runtime. That
 * alone resolves `ok: false`, carrying the names.
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
  dependsOn: ['implement_tables', 'plan_tables', 'plan_endpoints', 'plan_components'],
  output: {
    ok: 'boolean',
    written: 'boolean',
    path: 'string',
    dts: 'string',
    missing: 'array',
    missingCount: 'number',
    drift: 'array',
    driftCount: 'number',
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
    columns?: Record<string, { type?: string; description?: string; primaryKey?: boolean; required?: boolean }>;
    relations?: Record<string, unknown>;
  };
}

interface ContractEndpoint {
  name: string;
  route?: string;
  purpose?: string;
  tables?: string[];
  fields?: unknown[];
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
  components: '// ─────────── components ───────────',
};

const HEADER = [
  '/**',
  ' * types/contract.d.ts — this app\'s TYPE CONTRACT.',
  ' *',
  ' * Emitted by the appbuilder from the AGREED plan BEFORE any implementation code was written,',
  ' * so every endpoint and page is checked against declared names instead of remembered ones.',
  ' *',
  ' * Import it with a RELATIVE, TYPE-ONLY import:',
  ' *     import type { CostLinesOutput } from \'../types/contract\';',
  ' *',
  ' * NOT via `@app/types` — that specifier is hard-mapped to `types/generated.d.ts`, which the',
  ' * build regenerates from the code that actually landed. This file is the other direction:',
  ' * what the code is supposed to be. Generated file — do not hand-edit.',
  ' */',
  '',
].join('\n');

function renderRows(tables: ContractTable[]): string {
  const name = uniqueNamer();
  const blocks: string[] = [];
  for (const table of [...tables].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const columns = table.schema?.columns ?? {};
    const lines: string[] = [];
    const description = doc(table.schema?.description ?? table.schema?.title ?? `Row of ${table.name}`);
    lines.push(`/** ${description} (table \`${table.name}\`) */`);
    lines.push(`export interface ${name(`${pascal(table.name)}Row`)} {`);
    const entries = Object.entries(columns);
    if (entries.length === 0) {
      lines.push('  [column: string]: unknown;');
    }
    for (const [column, spec] of entries) {
      const optional = spec?.primaryKey || spec?.required ? '' : '?';
      const description2 = doc(spec?.description);
      if (description2) lines.push(`  /** ${description2} */`);
      lines.push(`  ${propKey(column)}${optional}: ${COLUMN_TS[String(spec?.type)] ?? 'unknown'};`);
    }
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '// (no tables in the contract)';
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
    lines.push(`export interface ${base}Item {`);
    if (fields.length === 0) lines.push('  [field: string]: unknown;');
    for (const field of fields) lines.push(`  ${propKey(field.key)}: ${field.type};`);
    lines.push('}');
    lines.push(`export interface ${base}Output { items: ${base}Item[]; }`);
    lines.push(
      params.length > 0
        ? `export interface ${base}Input {\n${params.map((p) => `  ${propKey(p)}: string;`).join('\n')}\n}`
        : `export type ${base}Input = Record<string, unknown>;`,
    );
    blocks.push(lines.join('\n'));
  }
  const names = endpoints.map((e) => String(e.name)).filter(Boolean);
  const union =
    names.length > 0
      ? `/** Every endpoint name the plan assigned — the exact strings \`useApi\`/\`useApiMutation\`/\n *  \`apiCall\` take, and each handler's \`export const name\`. */\nexport type EndpointName =\n${[
          ...new Set(names),
        ]
          .map((n) => `  | ${quote(n)}`)
          .join('\n')};`
      : '/** No endpoints in the contract. */\nexport type EndpointName = never;';
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
    lines.push(`export interface ${name(`${pascal(component.name)}Props`)} {`);
    if (props.length === 0) lines.push('  [prop: string]: unknown;');
    for (const prop of props) lines.push(`  ${propKey(prop.key)}: ${prop.type};`);
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.length > 0 ? blocks.join('\n\n') : '// (no shared components in the contract)';
}

function assembleDts(sections: { rows: string; endpoints: string; components: string }): string {
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
function sectionsOf(text: string): { rows: string; endpoints: string; components: string } | null {
  const rowsAt = text.indexOf(MARK.rows);
  const endpointsAt = text.indexOf(MARK.endpoints);
  const componentsAt = text.indexOf(MARK.components);
  if (rowsAt < 0 || endpointsAt < rowsAt || componentsAt < endpointsAt) return null;
  return {
    rows: text.slice(rowsAt + MARK.rows.length, endpointsAt).trim(),
    endpoints: text.slice(endpointsAt + MARK.endpoints.length, componentsAt).trim(),
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

/** One reconciled difference between the plan and what is on disk. Reported, never failed on. */
interface Drift {
  table: string;
  kind: 'extra-columns' | 'absent-columns' | 'unplanned-table' | 'unreadable-schema';
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

  // ── re-emit, preserving any section this node's inputs cannot rebuild ──
  const previous = await ctx.readProjectFile(CONTRACT_PATH);
  const prior = previous?.ok ? sectionsOf(previous.content || '') : null;
  const endpoints = pick<ContractEndpoint>(input, 'endpoints', 'plan_endpoints');
  const components = pick<ContractComponent>(input, 'components', 'plan_components');
  const dts = assembleDts({
    rows: renderRows(landed),
    endpoints: endpoints ? renderEndpoints(endpoints) : (prior?.endpoints ?? renderEndpoints([])),
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
    // Column drift is reconciled, not failed on. ONLY a table that never landed is a failure —
    // every endpoint planned against it compiles clean and 500s at runtime.
    ok: missing.length === 0,
    written,
    path: CONTRACT_PATH,
    dts,
    missing,
    missingCount: missing.length,
    drift,
    driftCount: drift.length,
    landed: landedNames,
    error,
  };
}
