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
 * each names one endpoint and asserts, against the SEEDED data, a row-count floor (`rows-min`), a
 * numeric-field floor (`field-min`), or an EXACT computed value (`field-equals`). This node CALLS each
 * endpoint and evaluates them.
 *
 * `field-equals` is the one that catches the failure nothing else in this pipeline can see: an
 * arithmetic rule the brief STATES ("labour is £45/hour; a job's total is labour plus the parts fitted
 * to it") whose handler computes only some of the terms. The shape is right, the type is right, every
 * static gate is green, and the page renders a confident wrong number — the bike-workshop build
 * (scenario 30, run 202) shipped a job total of £70.49 where the brief's own arithmetic over the
 * seeded rows says 2.5h × £45 + £70.49 = £182.99. A floor cannot catch that; only the expected VALUE
 * can, so the planner computes it and this node compares against it within a tolerance.
 *
 * **The contract with `plan_acceptance` is enforced, not assumed.** A check emitted in a shape this
 * node cannot evaluate is WORSE than no check: the pipeline reads it as covered while it proves
 * nothing. Every check is validated BEFORE anything is called; a malformed one lands in `malformed`,
 * makes `ok` false, and `onFail` resumes the PLANNER with the reasons — it is never silently skipped.
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
    malformed: 'array',
    malformedCount: 'number',
    skipped: 'number',
    unavailable: 'boolean',
    reason: 'string',
  },
  // A check this node cannot evaluate is a PLANNER fault, and the only node that can repair it is the
  // planner — so resume it, carrying the malformed entries as `feedback`. Nothing written is redone:
  // nothing else depends on `plan_acceptance`, so `resumeSet` here is exactly
  // {plan_acceptance, check_acceptance}. A genuine FAILED check must NEVER come here — that is a CODE
  // fault and flows through `verify.offending` to the per-file `fix` fork.
  onFail: {
    goto: 'plan_acceptance',
    when: 'check_acceptance.malformedCount > 0',
    carry: 'malformed',
    maxAttempts: 1,
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

/**
 * One acceptance check — THE CONTRACT with `plan_acceptance`. Every key here is validated by
 * `contractError` below before a single endpoint is called, and the prompt documents exactly this
 * shape. Change one side and you must change the other; `build-live-project-acceptance.test.ts`
 * asserts the two agree.
 */
interface Check {
  id?: string;
  story?: string;
  endpoint?: string;
  input?: unknown;
  /** `rows-min` | `field-min` | `field-equals` */
  kind?: string;
  /** rows-min: the row-count floor. field-min: the numeric floor. */
  min?: number;
  /** field-min / field-equals: the numeric key read off the selected row. */
  field?: string;
  /** field-min / field-equals: select the ONE row to read `field` off. Omitted ⇒ `items[0]`. */
  match?: { field?: string; value?: unknown };
  /** field-equals: the EXACT value the brief's own arithmetic works out to over the seeded rows. */
  equals?: number;
  /** field-equals: absolute tolerance around `equals`. Default one penny. */
  tolerance?: number;
  why?: string;
}

/** A check the gate cannot evaluate (or that would prove nothing) — reported, never skipped. */
interface Malformed {
  check: string;
  endpoint: string;
  kind: string;
  reason: string;
  message: string;
}

interface Finding {
  phase: string;
  probe: string;
  message: string;
}

const KINDS = ['rows-min', 'field-min', 'field-equals'];
/** One penny — currency arithmetic is what these checks assert, and it rounds. */
const DEFAULT_TOLERANCE = 0.01;

const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate ONE check against the contract. Returns the reason it cannot be evaluated, or `null`.
 *
 * This runs BEFORE anything is called, and it is deliberately strict about checks that would
 * "pass" while proving nothing (`rows-min` with `min: 0`, `field-min` with `min: 0`) — a vacuous
 * check is the same defect as an unevaluable one: the pipeline reads the story as covered.
 */
function contractError(check: Check): string | null {
  const kind = String(check.kind ?? '');
  if (!String(check.endpoint ?? '').trim()) {
    return 'no `endpoint` — every check must name exactly one `plan_endpoints` name';
  }
  if (KINDS.indexOf(kind) === -1) {
    return `unknown kind ${JSON.stringify(check.kind)} — must be one of ${KINDS.join(' | ')}`;
  }
  if (kind === 'rows-min') {
    if (check.match !== undefined) return '`match` is meaningless on rows-min — it counts rows and reads no field';
    if (check.min !== undefined && !isNum(check.min)) return '`min` must be a finite number';
    if (isNum(check.min) && (check.min as number) < 1) {
      return `min ${check.min} proves nothing — a rows-min floor must be at least 1`;
    }
    return null;
  }
  // field-min / field-equals both read ONE numeric key off ONE row.
  if (!String(check.field ?? '').trim()) return `${kind} needs a \`field\` — the numeric key it reads off the row`;
  if (check.match !== undefined) {
    const m = check.match as { field?: unknown; value?: unknown } | null;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return '`match` must be `{ field, value }`';
    if (!String(m.field ?? '').trim()) return '`match.field` must name the key that selects the row';
    if (m.value === undefined || m.value === null || String(m.value).trim() === '') {
      return '`match.value` must be the value that selects the row';
    }
  }
  if (kind === 'field-min') {
    if (!isNum(check.min)) return 'field-min needs a numeric `min` — the floor the value must clear';
    if ((check.min as number) <= 0) {
      return `min ${check.min} proves nothing — a field-min floor must be > 0 (use field-equals for an exact figure)`;
    }
    return null;
  }
  if (!isNum(check.equals)) {
    return "field-equals needs a numeric `equals` — the value the brief's stated arithmetic works out to over the seeded rows";
  }
  if (check.tolerance !== undefined && (!isNum(check.tolerance) || (check.tolerance as number) < 0)) {
    return '`tolerance` must be a non-negative number';
  }
  return null;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Select the ONE row a `field-*` check reads.
 *
 * Row ORDER is the reason this exists: a list endpoint makes no ordering promise, so `items[0]` can
 * only be trusted for a single-row aggregate. `match` addresses a row by a stable business value
 * instead — and the planner declining to check a per-row figure "because order isn't guaranteed" is
 * exactly how the £70.49 total shipped unchecked (run 202's own comment says so).
 *
 * Three outcomes, and the difference matters: an ambiguous selector is the PLANNER's fault
 * (`malformed`), while "no row carries that value" is the APP's — the endpoint did not return the
 * row the source promised, which is a real finding.
 */
type Picked = { row: Record<string, unknown> } | { fail: string } | { malformed: string };

function pickRow(items: unknown[], match: { field?: string; value?: unknown } | undefined): Picked {
  const rows = items.map((i) => (i && typeof i === 'object' && !Array.isArray(i) ? (i as Record<string, unknown>) : {}));
  if (!match) {
    if (rows.length === 0) return { fail: 'the endpoint returned no rows at all' };
    return { row: rows[0] as Record<string, unknown> };
  }
  const key = String(match.field ?? '');
  const want = norm(match.value);
  const exact = rows.filter((r) => norm(r[key]) === want);
  // Fall back to containment either way round: the source says "Allez", the row says
  // "Specialized Allez". Exact wins outright when it matches, so this never loosens a clean hit.
  const candidates =
    exact.length > 0
      ? exact
      : rows.filter((r) => {
          const got = norm(r[key]);
          return got !== '' && want !== '' && (got.indexOf(want) !== -1 || want.indexOf(got) !== -1);
        });
  if (candidates.length === 1) return { row: candidates[0] as Record<string, unknown> };
  if (candidates.length > 1) {
    return {
      malformed:
        `\`match\` on ${key}=${JSON.stringify(match.value)} selected ${candidates.length} rows — a selector must ` +
        'address exactly ONE row. Pick a value unique in the seeded data.',
    };
  }
  const keys = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>).join(', ') : '(none)';
  return {
    fail:
      `no returned row has ${key}=${JSON.stringify(match.value)} ` +
      `(${rows.length} row(s) came back; their keys are: ${keys})`,
  };
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
    return { ok: true, checked: 0, offending: [], offendingCount: 0, dataGaps: [], dataGapCount: 0, malformed: [], malformedCount: 0, skipped: 0, unavailable: false, reason: '' };
  }

  if (typeof ctx.callProjectApi !== 'function') {
    // Fail LOUD, like smoke: an un-run gate reporting ok:true with no findings is indistinguishable
    // from a clean one. `offending` stays empty so `fix` is not pointed at a host wiring bug.
    return {
      ok: false, checked: 0, offending: [], offendingCount: 0, dataGaps: [], dataGapCount: 0, malformed: [], malformedCount: 0, skipped: 0,
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
  const malformed: Malformed[] = [];
  let skipped = 0;
  const add = (file: string, name: string, f: Finding): void => {
    nameOf[file] = name;
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };
  const reject = (check: Check, reason: string): void => {
    malformed.push({
      check: String(check.id || check.endpoint || 'check'),
      endpoint: String(check.endpoint ?? ''),
      kind: String(check.kind ?? ''),
      reason,
      message:
        `acceptance check "${String(check.id || check.endpoint || 'check')}" could not be evaluated: ${reason}. ` +
        'It was NOT run, so nothing it claimed is proven — re-emit it in the documented shape ' +
        '(rows-min: min>=1 · field-min: field + min>0 · field-equals: field + equals, optional match/tolerance), ' +
        'or drop it if no source figure grounds it.',
    });
  };

  for (const check of checks) {
    const name = String(check.endpoint ?? '').trim();
    const label = String(check.id || name || 'check');
    const kind = String(check.kind ?? '');
    const min = typeof check.min === 'number' ? check.min : 1;
    // THE SEAM. A check the contract does not admit is reported, never skipped: a silently-dropped
    // check reads to every downstream node as a story that was verified.
    const bad = contractError(check);
    if (bad) {
      reject(check, bad);
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

    // Evaluate. `value` is the number actually read (NaN when there was none) — the fault
    // discriminator below reads it, so it must survive out of this block.
    let passed: boolean;
    let observed: string;
    let expected: string;
    let value = NaN;
    if (kind === 'rows-min') {
      passed = items.length >= min;
      observed = `${items.length} row(s)`;
      expected = `>= ${min} rows`;
    } else {
      const field = String(check.field ?? '');
      const picked = pickRow(items, check.match);
      const where = check.match ? ` (row where ${String(check.match.field)}=${JSON.stringify(check.match.value)})` : '';
      const tol = isNum(check.tolerance) ? (check.tolerance as number) : DEFAULT_TOLERANCE;
      expected = kind === 'field-equals' ? `${field} == ${check.equals} (±${tol})${where}` : `${field} >= ${min}${where}`;
      if ('malformed' in picked) {
        reject(check, picked.malformed);
        continue;
      }
      if ('fail' in picked) {
        passed = false;
        observed = picked.fail;
      } else {
        const raw = picked.row[field];
        value = typeof raw === 'number' ? raw : Number(raw);
        const present = Object.prototype.hasOwnProperty.call(picked.row, field);
        passed = Number.isFinite(value)
          ? kind === 'field-equals'
            ? Math.abs(value - (check.equals as number)) <= tol
            : value >= min
          : false;
        observed = present
          ? `${field}=${Number.isFinite(value) ? value : JSON.stringify(raw)}`
          : `${field} is ABSENT from the returned row (keys: ${Object.keys(picked.row).join(', ') || 'none'})`;
      }
    }
    if (passed) continue;

    // FAILED. Code fault (data exists, endpoint reports it wrong → fixable) vs extraction gap
    // (backing data short → not a code fix). rows-min needs >= min backing rows to be a code fault;
    // field-min needs >= 1 (some data the aggregate should have reflected).
    const rows = await backingRows(ref);
    const need = kind === 'rows-min' ? min : 1;
    // An EXACT-arithmetic miss that came back as a real non-zero number is NEVER a data gap: the
    // endpoint had enough data to produce a figure and produced the wrong one, so a TERM of the
    // brief's arithmetic was dropped. Route it to the handler whatever the row counter can see —
    // this is the £70.49-instead-of-£182.99 case, and letting it fall into `dataGaps` would report
    // "the source was under-mined" about data that is sitting right there.
    const wrongNotEmpty = kind === 'field-equals' && Number.isFinite(value) && value !== 0;
    const isCodeFault = wrongNotEmpty || (rows !== null && rows >= need);

    const detail =
      `acceptance check "${label}" FAILED: expected ${expected} ` +
      `but got ${observed}. ${check.why ? `Source basis: ${check.why}.` : ''}`;

    if (isCodeFault && ref) {
      const dataNote =
        rows !== null
          ? `The backing table(s) hold ${rows} row(s), so the DATA is there`
          : `The endpoint answered with real data`;
      const repair =
        kind === 'field-equals'
          ? `— the handler computed the WRONG FIGURE. The expected value is what the brief's own stated ` +
            `arithmetic works out to over the seeded rows, so a TERM of it is missing (a rate never ` +
            `applied, a joined table never summed, a component silently dropped). Recompute EVERY term ` +
            `the source states and return the whole figure.`
          : `— the handler reads the wrong table/column or filters on a value the rows never use. Query ` +
            `the data that actually backs this and return it.`;
      add(ref.path, name, {
        phase: 'acceptance',
        probe: label,
        message: `${detail} ${dataNote} ${repair}`,
      });
    } else {
      dataGaps.push({
        check: label,
        endpoint: name,
        message: isCodeFault
          ? // A wrong figure with nowhere to send it: the runtime answered but no `api/` module
            // exports this name, so the per-file fixer has no file. Still reported LOUDLY.
            `${detail} The endpoint answered with real data, so this is a computation fault — but no api/ ` +
            `module exports the name "${name}", so it could not be routed to a file. Find the handler ` +
            `serving "${name}" and recompute every term the source states.`
          : `${detail} The backing data itself is short (${rows === null ? 'row count unknown' : `${rows} row(s)`}), ` +
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

  // `ok` is COMPUTED, never claimed: a malformed check counts against it exactly like a code fault.
  // A gate that ran half its checks and reports clean is the failure this node exists to prevent.
  return {
    ok: offending.length === 0 && malformed.length === 0,
    checked: checks.length,
    offending,
    offendingCount: offending.length,
    dataGaps,
    dataGapCount: dataGaps.length,
    malformed,
    malformedCount: malformed.length,
    skipped,
    unavailable: false,
    reason: '',
  };
}
