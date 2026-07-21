/**
 * The acceptance gate — HOST-RUN, and the ONE place the pipeline checks that the app is not merely
 * well-typed and correctly-SHAPED but actually RIGHT.
 *
 * `smoke_endpoints` proves every endpoint answers `{ items: T[] }` and does not 500; the typecheck
 * proves the code compiles. Neither proves the numbers MEAN anything. A handler that reads a column
 * nobody populated, or filters on a value the rows never use, returns `{ items: [{ total: 0 }] }` —
 * valid TypeScript, valid envelope, a dashboard reading €0 over a €2,707 trip (run 32 step 3, live).
 *
 * `plan_acceptance` distilled the user stories + the source figures into machine-checkable checks —
 * each names one endpoint and asserts, against the SEEDED data, either a row-count floor (`rows-min`)
 * or a numeric-field floor (`field-min`). This node CALLS each endpoint and evaluates them.
 *
 * The load-bearing distinction — why this never sends the per-file `fix` fork chasing a bug it cannot
 * repair: a failed check is only a CODE fault when the backing data EXISTS but the endpoint reports
 * nothing/zero (a wrong query, column or filter — `fix` can repair that). When the backing table is
 * itself short of data, the fault is UPSTREAM extraction (the source was under-mined), which a code
 * fixer cannot touch — so that lands in `dataGaps`, reported by `finalize`, NOT in `offending`.
 *
 * It reports; it never fixes and NEVER throws (a code node has no salvage path — a throw aborts the
 * whole tasklist). Output is SCALAR-first (`ok`, `offendingCount`, `dataGapCount`): `getAtPath`
 * returns `undefined` for arrays, so `x.offending.length > 0` is not expressible in a `when:`.
 *
 * The `walkFiles`/`read`/`realEndpoints`/`parseQueriedTables` helpers are duplicated from
 * `13-smoke_endpoints.ts` on purpose: a code node is transpiled standalone (esbuild `transform`, not
 * `bundle`) and evaluated in a worker, so a relative import would not resolve at require time.
 */

type Await<T> = T | Promise<T>;

export const node = {
  id: 'check_acceptance',
  // The app must be fully built AND its data seeded before a check can call an endpoint and get real
  // numbers — endpoints (12) exist, tables (10) landed their source rows. `plan_acceptance` carries
  // the checks. `reconcile_tables` is not needed (it only re-emits types).
  dependsOn: ['plan_acceptance', 'implement_endpoints', 'implement_tables'],
  output: {
    ok: 'boolean',
    checked: 'number',
    offending: 'array',
    offendingCount: 'number',
    dataGaps: 'array',
    dataGapCount: 'number',
    skipped: 'number',
    unavailable: 'boolean',
    reason: 'string',
  },
};

interface ApiResponse {
  status: number;
  body: unknown;
}

interface Ctx {
  // Every authoring/db member is proxied into the worker as an ASYNC rpc stub — MUST be awaited (a
  // bare sync read gets a property off a Promise → undefined, and the node silently reports nothing).
  listProjectDir: (dir: string) => Await<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Await<{ ok: boolean; content: string; error?: string }>;
  /** Invoke one of THIS project's endpoints by name — the same wiring `smoke_endpoints` uses. Absent
   *  for a project with no api/ runtime, in which case the node reports `unavailable: true` loudly. */
  callProjectApi?: (name: string, input?: unknown) => Promise<ApiResponse>;
  /** The project's async data API — used ONLY to count backing rows, to tell a code fault (data
   *  exists, endpoint wrong) from an extraction gap (data missing). Absent for a table-less project. */
  db?: { query: (table: string, opts?: unknown) => Promise<unknown[]> };
}

/** One acceptance check, as `plan_acceptance` emits it. */
interface Check {
  id?: string;
  story?: string;
  endpoint?: string;
  input?: unknown;
  kind?: string;
  min?: number;
  field?: string;
  why?: string;
}

interface Finding {
  phase: string;
  probe: string;
  message: string;
}

async function walkFiles(ctx: Ctx, dir: string): Promise<string[]> {
  const out: string[] = [];
  const listed = await ctx.listProjectDir(dir);
  const queue = (listed?.entries || []).map((n) => `${dir}/${n}`);
  while (queue.length > 0) {
    const p = queue.shift() as string;
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
      continue;
    }
    const sub = await ctx.listProjectDir(p);
    for (const child of sub?.entries || []) queue.push(`${p}/${child}`);
  }
  return out;
}

async function read(ctx: Ctx, path: string): Promise<string> {
  const r = await ctx.readProjectFile(path);
  return r?.content || '';
}

/** Table names a handler passes to `db.query('<table>')` — a literal first argument only. */
function parseQueriedTables(src: string): string[] {
  const out = new Set<string>();
  const re = /\bdb\s*\.\s*query\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[1] as string);
  return [...out];
}

interface EndpointRef {
  path: string;
  name: string;
  queries: string[];
}

/** `endpoint name -> { file path, backing tables }`, from the project's real `api/` exports. */
async function realEndpoints(ctx: Ctx): Promise<Map<string, EndpointRef>> {
  const found = new Map<string, EndpointRef>();
  for (const path of await walkFiles(ctx, 'api')) {
    const src = await read(ctx, path);
    const m = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/.exec(src);
    if (!m) continue;
    found.set(m[1] as string, { path, name: m[1] as string, queries: parseQueriedTables(src) });
  }
  return found;
}

/** `{ items: [...] }` → the array; `null` when the body is not that envelope. */
function itemsOf(body: unknown): unknown[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const items = (body as Record<string, unknown>)['items'];
  return Array.isArray(items) ? items : null;
}

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const planned = (inputs?.['plan_acceptance'] ?? {}) as { checks?: unknown };
  const checks: Check[] = Array.isArray(planned.checks) ? (planned.checks as Check[]) : [];

  // No checks is a legitimate, common outcome (an app whose stories are all "see the data on a page"
  // and whose source states no hard figures). Nothing to prove ⇒ clean, not unavailable.
  if (checks.length === 0) {
    return { ok: true, checked: 0, offending: [], offendingCount: 0, dataGaps: [], dataGapCount: 0, skipped: 0, unavailable: false, reason: '' };
  }

  if (typeof ctx.callProjectApi !== 'function') {
    // Fail LOUD, like smoke: an un-run gate reporting ok:true with no findings is indistinguishable
    // from a clean one. `offending` stays empty so `fix` is not pointed at a host wiring bug.
    return {
      ok: false, checked: 0, offending: [], offendingCount: 0, dataGaps: [], dataGapCount: 0, skipped: 0,
      unavailable: true,
      reason:
        'check_acceptance could not run: the code-node ctx has no `callProjectApi`. It is wired via ' +
        'ProjectAuthoringGlobals.callProjectApi (libs/cli/src/app/authoring/globals.ts); a project with ' +
        'an api/ runtime should always have it.',
    };
  }
  const call = ctx.callProjectApi;
  const endpoints = await realEndpoints(ctx);

  // Backing-row counts, memoised — the code-fault vs data-gap discriminator.
  const rowCountCache = new Map<string, number>();
  const rowCount = async (table: string): Promise<number | null> => {
    if (!ctx.db) return null;
    if (rowCountCache.has(table)) return rowCountCache.get(table) as number;
    try {
      const rows = await ctx.db.query(table);
      const n = Array.isArray(rows) ? rows.length : 0;
      rowCountCache.set(table, n);
      return n;
    } catch {
      return null;
    }
  };
  /** Total known rows across an endpoint's backing tables; `null` if none are countable. */
  const backingRows = async (ref: EndpointRef | undefined): Promise<number | null> => {
    if (!ref || ref.queries.length === 0) return null;
    let total = 0;
    let known = false;
    for (const t of ref.queries) {
      const n = await rowCount(t);
      if (n !== null) {
        total += n;
        known = true;
      }
    }
    return known ? total : null;
  };

  const byFile: Record<string, Finding[]> = {};
  const nameOf: Record<string, string> = {};
  const dataGaps: Array<{ check: string; endpoint: string; message: string }> = [];
  let skipped = 0;
  const add = (file: string, name: string, f: Finding): void => {
    nameOf[file] = name;
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };

  for (const check of checks) {
    const name = String(check.endpoint ?? '').trim();
    const label = String(check.id || name || 'check');
    const kind = String(check.kind ?? '');
    const min = typeof check.min === 'number' ? check.min : kind === 'rows-min' ? 1 : 0;
    if (!name || (kind !== 'rows-min' && kind !== 'field-min')) {
      skipped++;
      continue;
    }
    const ref = endpoints.get(name);

    let res: ApiResponse;
    try {
      res = await call(name, (check.input ?? {}) as unknown);
    } catch {
      skipped++; // a rejected host proxy is smoke's concern, not an acceptance signal
      continue;
    }
    const status = typeof res?.status === 'number' ? res.status : 0;
    // A missing/erroring endpoint is smoke/verify's domain — an acceptance check can only evaluate a
    // healthy 2xx response, so anything else is SKIPPED rather than double-reported.
    if (status < 200 || status >= 300) {
      skipped++;
      continue;
    }
    const items = itemsOf(res.body);
    if (items === null) {
      skipped++; // a broken envelope is smoke's finding
      continue;
    }

    // Evaluate.
    let passed: boolean;
    let observed: string;
    if (kind === 'rows-min') {
      passed = items.length >= min;
      observed = `${items.length} row(s)`;
    } else {
      const first = (items[0] ?? {}) as Record<string, unknown>;
      const raw = first[String(check.field ?? '')];
      const v = typeof raw === 'number' ? raw : Number(raw);
      passed = Number.isFinite(v) && v >= min;
      observed = `${String(check.field)}=${Number.isFinite(v) ? v : JSON.stringify(raw)}`;
    }
    if (passed) continue;

    // FAILED. Code fault (data exists, endpoint reports it wrong → fixable) vs extraction gap
    // (backing data short → not a code fix). rows-min needs >= min backing rows to be a code fault;
    // field-min needs >= 1 (some data the aggregate should have reflected).
    const rows = await backingRows(ref);
    const need = kind === 'rows-min' ? min : 1;
    const isCodeFault = rows !== null && rows >= need;

    const detail =
      `acceptance check "${label}" FAILED: expected ${kind === 'rows-min' ? `>= ${min} rows` : `${check.field} >= ${min}`} ` +
      `but got ${observed}. ${check.why ? `Source basis: ${check.why}.` : ''}`;

    if (isCodeFault && ref) {
      add(ref.path, name, {
        phase: 'acceptance',
        probe: label,
        message:
          `${detail} The backing table(s) hold ${rows} row(s), so the DATA is there — the handler ` +
          `reads the wrong table/column or filters on a value the rows never use. Query the data that ` +
          `actually backs this and return it.`,
      });
    } else {
      dataGaps.push({
        check: label,
        endpoint: name,
        message:
          `${detail} The backing data itself is short (${rows === null ? 'row count unknown' : `${rows} row(s)`}), ` +
          `so this is an EXTRACTION gap — the source was under-mined upstream, not a handler bug. Report it; ` +
          `do not send it to the per-file fixer.`,
      });
    }
  }

  const offending = Object.keys(byFile).map((path) => ({
    path,
    kind: 'api',
    name: nameOf[path],
    errors: byFile[path],
  }));

  return {
    ok: offending.length === 0,
    checked: checks.length,
    offending,
    offendingCount: offending.length,
    dataGaps,
    dataGapCount: dataGaps.length,
    skipped,
    unavailable: false,
    reason: '',
  };
}
