/**
 * The endpoint smoke gate — HOST-RUN, and the ONLY thing in this pipeline that ever CALLS a
 * generated endpoint.
 *
 * Everything upstream is static. `writeProjectQuery` generates the module, `verify` typechecks it and
 * bundles it, and the scans in `16-verify.ts` read the source with a regex. None of that executes a
 * handler, so an endpoint whose body is structurally perfect and semantically empty sails through
 * every gate:
 *
 *  - 06-tanzania run 25 step 10 shipped `actual-payments-list` and `blended-spending-total` with
 *    `built: true`. Both 500 on the first real call — no backing table was ever created. The 500s
 *    were found by a human running `.tables` + curl AFTER the build declared success; nothing in
 *    the pipeline had issued a single request.
 *  - run 32 step 3 shipped a homepage whose "TOTAL COST" tile read €0 + $0 while the db held €2707
 *    of flights and $3344.20 of costs. A handler that reads a column nobody populated returns
 *    `{ items: [{ total: 0 }] }` — valid TypeScript, valid envelope, valid bundle, wrong app.
 *
 * So this node invokes every endpoint the project defines, three ways: with valid input synthesized
 * from its declared `Input`, with every declared field WRONG-TYPED, and — for a `[param]` route —
 * with the param missing, and with the param set to the literal string `"undefined"` that
 * `client.ts` produces when a page forgets to pass it. That last probe is the one a static scan
 * cannot make: `"undefined"` still matches the route and still passes validation, so the endpoint
 * answers 200 with a plausible row (see the same fault, from the CALLER's side, in `16-verify.ts`).
 *
 * It reports; it never fixes, and it NEVER throws (a code node has no salvage path — a throw fails
 * the whole node and aborts the tasklist). Every fault comes back as DATA, grouped per endpoint FILE
 * so the per-file `fix` fork consumes it exactly like `verify.offending`.
 *
 * THREE outcomes per endpoint, not two — ran-and-returned-rows, ran-and-legitimately-empty, and
 * NEVER-RUN-CERTIFIABLY are NOT the same verdict, and treating the middle as the third (or either as
 * a pass) is how a page whose query can never return data ships green: its section renders loading
 * skeletons forever, which is valid markup that passes typecheck, the render smoke and app
 * validation. The valid-input probe fills every route param with a synthetic `smoke-<p>` NO real row
 * can match, so a clean `{ items: [] }` under it proves the handler RUNS, never that it can RETURN
 * data. When the probe comes back empty, this gate re-asks the endpoint with a REAL id read straight
 * out of the backing table: rows then → measured; still empty → a FINDING (it can never return data
 * for a real record); every backing table genuinely empty (a brand-new app) → legitimately empty and
 * counted `unmeasured`, never a finding — "the query could not run" is a fault, "the query ran and
 * there is no data" is not.
 *
 * Output is deliberately SCALAR-first (`ok`, `offendingCount`, `checked`): `getAtPath` returns
 * `undefined` for arrays, so `x.offending.length > 0` is not expressible in a `when:` condition.
 *
 * The `walkFiles`/`read`/`realEndpoints` helpers are duplicated from `16-verify.ts` rather than
 * imported: a code node is transpiled standalone (esbuild `transform`, not `bundle`) and evaluated
 * in a worker, so a relative import would fail to resolve at require time.
 */

type Await<T> = T | Promise<T>;

export const node = {
  id: 'smoke_endpoints',
  dependsOn: ['implement_endpoints'],
  output: {
    ok: 'boolean',
    checked: 'number',
    offending: 'array',
    offendingCount: 'number',
    unavailable: 'boolean',
    reason: 'string',
    measured: 'number',
    unmeasured: 'number',
  },
};

/** One endpoint invocation's result — the shape of `ApiRuntime.callByName` (`libs/cli/src/app/api/runtime.ts`). */
interface ApiResponse {
  status: number;
  body: unknown;
}

interface Ctx {
  // MUST be awaited even though they look synchronous: `worker-load-entry.ts` proxies every
  // authoring global into the worker as an RPC stub returning a PROMISE, so a bare
  // `ctx.listProjectDir(dir).entries` reads a property off a Promise — `undefined` — and the walk
  // silently returns []. The node would then report ZERO endpoints and resolve `ok:true`, which is
  // indistinguishable from a clean run. A sync-mock unit test cannot see this.
  listProjectDir: (dir: string) => Await<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Await<{ ok: boolean; content: string; error?: string }>;
  /**
   * Enter one of THIS project's endpoints by its `export const name` — the code-node counterpart of
   * the agent-facing `apiCall` global, resolving to the same `ApiRuntime.callByName`. It never
   * rejects for a handler fault (a throwing handler is a 500 response), but the host proxy itself
   * can reject (no api runtime, worker timeout), so every call below is still guarded.
   *
   * Wired via `ProjectAuthoringGlobals.callProjectApi` (`libs/cli/src/app/authoring/globals.ts`),
   * implemented in `session-manager.ts` (resolves the project's `ApiRuntime` and calls `callByName`)
   * and spread onto the code-node ctx as `authoring` by `createCodeNodeCtxFactory`
   * (`libs/cli/src/server/tasklist-runner.ts`). It is ABSENT only for a project with no `api/`
   * runtime; this node then reports `unavailable: true` LOUDLY rather than returning an empty finding
   * list, because an empty finding list is precisely what the pipeline reads as "clean".
   */
  callProjectApi?: (name: string, input?: unknown) => Promise<ApiResponse>;
  /**
   * The project's async data API — the SAME `db` the handlers see, injected onto the code-node ctx
   * (`tasklist-runner.ts#createCodeNodeCtxFactory` spreads `deps.getDb().async`). Used to count rows
   * (the dead-list probe) and to read a REAL row back (the real-id re-probe: an endpoint probed with
   * a synthetic `smoke-<param>` can answer an empty `{ items: [] }` forever, so certifying it needs
   * an id that actually exists). Every method is an async RPC stub — it MUST be awaited. Absent for a
   * project with no tables.
   */
  db?: {
    tables: () => Promise<string[]>;
    query: (table: string, opts?: unknown) => Promise<unknown[]>;
  };
}

interface Finding {
  phase: string;
  probe: string;
  message: string;
}

/** Every `.ts`/`.tsx` file under `dir`, walked breadth-first. */
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

interface EndpointRef {
  /** `api/costs/[id]/GET.ts` */
  path: string;
  /** The stable id from `export const name` — what `callByName` and `useApi` both key on. */
  name: string;
  /** Route params, from `[param]` path segments. */
  params: string[];
  /** `GET`/`POST`/… from the filename. */
  method: string;
  /** Declared `export interface Input` fields as `name -> declared type text`. */
  input: Record<string, string>;
  /** Table names the handler reads via `ctx.db.query('<table>')` — the dead-list probe's backing set. */
  queries: string[];
}

/** Table names a handler passes to `db.query('<table>')` — a literal first argument only (a computed
 *  name is not a wrong-table smell we can prove). Powers the dead-list probe. */
function parseQueriedTables(src: string): string[] {
  const out = new Set<string>();
  const re = /\bdb\s*\.\s*query\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[1] as string);
  return [...out];
}

/** Fields of `export interface Input { … }`, as `name -> type text`. Optional `?` is stripped. */
function parseInputFields(src: string): Record<string, string> {
  const m = /export\s+interface\s+Input\s*\{([^}]*)\}/.exec(src);
  const out: Record<string, string> = {};
  if (!m) return out;
  const field = /([A-Za-z_$][\w$]*)\s*\??\s*:\s*([^;\n,}]+)/g;
  for (let f = field.exec(m[1] as string); f; f = field.exec(m[1] as string)) {
    out[f[1] as string] = (f[2] as string).trim();
  }
  return out;
}

/** Endpoints the project's `api/` actually exports (mirrors `realEndpoints()` in `16-verify.ts`). */
async function realEndpoints(ctx: Ctx): Promise<EndpointRef[]> {
  const found: EndpointRef[] = [];
  for (const path of await walkFiles(ctx, 'api')) {
    const src = await read(ctx, path);
    const m = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/.exec(src);
    if (!m) continue;
    const segs = path.split('/');
    const params: string[] = [];
    for (const seg of segs) {
      const p = /^\[([A-Za-z0-9_]+)\]$/.exec(seg);
      if (p) params.push(p[1] as string);
    }
    const method = (segs[segs.length - 1] as string).replace(/\.tsx?$/, '').toUpperCase();
    found.push({ path, name: m[1] as string, params, method, input: parseInputFields(src), queries: parseQueriedTables(src) });
  }
  return found;
}

/** A plausible VALID value for a declared type. */
function validValue(type: string): unknown {
  const t = type.toLowerCase();
  if (t.includes('[]') || t.startsWith('array')) return [];
  if (t.includes('number')) return 1;
  if (t.includes('boolean')) return true;
  return 'smoke';
}

/** A value of the WRONG type for a declared type (a number where a string is declared, …). */
function wrongValue(type: string): unknown {
  const t = type.toLowerCase();
  if (t.includes('[]') || t.startsWith('array')) return 'not-an-array';
  if (t.includes('number')) return 'not-a-number';
  if (t.includes('boolean')) return 'not-a-boolean';
  return 12345;
}

interface Probe {
  label: string;
  input: Record<string, unknown>;
  /** What this probe is allowed to prove. */
  expectEnvelope: boolean;
  /** A 2xx carrying rows here means the route param was never used. */
  undefinedParam: boolean;
}

/** The probes for one endpoint. Route params are always strings — they arrive through the path. */
function probesFor(ep: EndpointRef): Probe[] {
  const valid: Record<string, unknown> = {};
  for (const p of ep.params) valid[p] = `smoke-${p}`;
  for (const k of Object.keys(ep.input)) {
    if (valid[k] === undefined) valid[k] = validValue(ep.input[k] as string);
  }

  const wrong: Record<string, unknown> = {};
  for (const p of ep.params) wrong[p] = 12345;
  for (const k of Object.keys(ep.input)) {
    if (wrong[k] === undefined) wrong[k] = wrongValue(ep.input[k] as string);
  }

  const probes: Probe[] = [
    { label: 'valid-input', input: valid, expectEnvelope: true, undefinedParam: false },
  ];
  // Nothing to mis-type on an endpoint that declares no input at all — a second identical `{}` call
  // would only double the runtime and could never fail differently.
  if (Object.keys(wrong).length > 0) {
    probes.push({ label: 'wrong-typed-input', input: wrong, expectEnvelope: false, undefinedParam: false });
  }
  if (ep.params.length > 0) {
    probes.push({ label: 'missing-route-params', input: {}, expectEnvelope: false, undefinedParam: true });
    const undef: Record<string, unknown> = {};
    for (const p of ep.params) undef[p] = 'undefined';
    probes.push({ label: 'undefined-route-params', input: undef, expectEnvelope: false, undefinedParam: true });
  }
  return probes;
}

/** `{ items: T[] }` — the envelope `12-implement_endpoints.md` requires of every read endpoint. */
function envelopeFault(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return `returned ${Array.isArray(body) ? 'a bare array' : JSON.stringify(body)}`;
  }
  const items = (body as Record<string, unknown>)['items'];
  if (items === undefined) return 'returned an object with no `items` key';
  if (!Array.isArray(items)) return `returned \`items\` as ${typeof items}, not an array`;
  return undefined;
}

/** Row count of a well-formed `{ items: [...] }` body; -1 when the body is not that shape. */
function itemCount(body: unknown): number {
  if (typeof body !== 'object' || body === null) return -1;
  const items = (body as Record<string, unknown>)['items'];
  return Array.isArray(items) ? items.length : -1;
}

export async function run(ctx: Ctx, _inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpoints = await realEndpoints(ctx);

  if (typeof ctx.callProjectApi !== 'function') {
    // Fail LOUD. Returning `ok: true` with no findings would make an un-run gate indistinguishable
    // from a clean one — the exact silent-and-load-bearing failure `16-verify.ts` was built to end.
    // `offending` stays EMPTY so the per-file `fix` fan-out is not pointed at a host wiring bug it
    // cannot repair.
    return {
      ok: false,
      checked: 0,
      offending: [],
      offendingCount: 0,
      unavailable: true,
      reason:
        'smoke_endpoints could not run: the code-node ctx has no `callProjectApi`. Thread an ' +
        'api-invoking member through `ProjectAuthoringGlobals` (libs/cli/src/app/authoring/globals.ts, ' +
        'alongside `buildProjectApp`) so `createCodeNodeCtxFactory` passes it in `authoring`. Until ' +
        'then no generated endpoint is ever invoked before the app ships.',
      measured: 0,
      unmeasured: 0,
    };
  }
  const call = ctx.callProjectApi;

  // Row SAMPLES, memoised, for the dead-list probe (a count) and the real-id re-probe (the first
  // row of a populated table). `db` is absent for a table-less project — the probes then simply
  // never fire (they can prove nothing without rows). `null` = the table could not be read, which
  // is itself informative: an unreadable backing table is an unmeasurable endpoint, not a clean one.
  const rowsCache = new Map<string, unknown[] | null>();
  const tableRows = async (table: string): Promise<unknown[] | null> => {
    if (!ctx.db) return null;
    if (rowsCache.has(table)) return rowsCache.get(table)!;
    try {
      const rows = await ctx.db.query(table);
      const out = Array.isArray(rows) ? rows : [];
      rowsCache.set(table, out);
      return out;
    } catch {
      rowsCache.set(table, null);
      return null; // an unqueryable table proves nothing about the endpoint
    }
  };
  const rowCount = async (table: string): Promise<number | null> => {
    const rows = await tableRows(table);
    return rows === null ? null : rows.length;
  };
  /** A plain list is a GET with no route params and no declared Input — nothing can legitimately
   *  narrow its result to empty, so 0 rows over a populated backing table is a wrong/empty-table read. */
  const isPlainList = (ep: EndpointRef): boolean =>
    ep.method === 'GET' && ep.params.length === 0 && Object.keys(ep.input).length === 0;

  const byFile: Record<string, Finding[]> = {};
  const nameOf: Record<string, string> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };
  // The three-outcome tally, per GET endpoint: `measured` = ran and returned rows (the only outcome
  // that certifies the data plumbing); `unmeasured` = ran and answered zero rows where zero rows
  // could be legitimate (every backing table genuinely empty — a brand-new app) or no real row could
  // be sourced to re-ask with. Neither scalar gates `ok`; the FINDINGS below do.
  let measuredCount = 0;
  let unmeasuredCount = 0;

  for (const ep of endpoints) {
    nameOf[ep.path] = ep.name;
    for (const probe of probesFor(ep)) {
      let res: ApiResponse;
      try {
        res = await call(ep.name, probe.input);
      } catch (e) {
        add(ep.path, {
          phase: 'smoke',
          probe: probe.label,
          message:
            `apiCall("${ep.name}", ${JSON.stringify(probe.input)}) THREW: ` +
            `${String(e instanceof Error ? e.message : e)} — a handler must never reject the caller; ` +
            `return a value or let the runtime turn the fault into a response.`,
        });
        continue;
      }

      const status = typeof res?.status === 'number' ? res.status : 0;

      if (status >= 500 || status === 0) {
        add(ep.path, {
          phase: 'smoke',
          probe: probe.label,
          message:
            `apiCall("${ep.name}", ${JSON.stringify(probe.input)}) returned ${status || 'no status'} — ` +
            `the endpoint compiles and bundles but 500s on the very first real call ` +
            `(${JSON.stringify(res?.body)}). The usual cause is a \`ctx.db.query\` against a table ` +
            `that was never created, or a column the schema does not declare.`,
        });
        continue;
      }

      if (status === 404) {
        add(ep.path, {
          phase: 'smoke',
          probe: probe.label,
          message:
            `apiCall("${ep.name}") returned 404 — no endpoint is registered under that name. ` +
            `\`export const name\` must match the id the plan assigned, character-for-character; ` +
            `pages pass that exact string to useApi().`,
        });
        continue;
      }

      if (status >= 400) continue; // A 4xx on a deliberately bad input is the CORRECT answer.

      if (probe.expectEnvelope && ep.method === 'GET') {
        const fault = envelopeFault(res.body);
        if (fault) {
          add(ep.path, {
            phase: 'smoke',
            probe: probe.label,
            message:
              `${fault} — every read endpoint must answer \`{ items: T[] }\` with \`items\` ALWAYS an ` +
              `array (an aggregate is the ONE element: \`return { items: [summary] }\`). Pages read ` +
              `\`data.items\`, so a non-array \`items\` silently gives the page nothing.`,
          });
        }
        // (a) RAN AND RETURNED ROWS — the only outcome that certifies the data plumbing.
        else if (itemCount(res.body) > 0) {
          measuredCount++;
        }
        // DEAD-LIST probe: a plain list that answers 0 rows while EVERY table it queries is populated
        // is reading the wrong (or an empty) table — a valid-envelope, valid-bundle, 200 response that
        // renders an empty page over a full db. Only fires when the emptiness cannot be legitimate:
        // no route params, no input filter, and the backing tables provably hold rows. An aggregate
        // (itemCount === 1) is never flagged here — a zero total is a domain/data concern the
        // contract's column unions and the source-fidelity checks own, not a wrong-table smell.
        else if (isPlainList(ep) && ep.queries.length > 0) {
          const counts = await Promise.all(ep.queries.map(async (t) => ({ t, n: await rowCount(t) })));
          const known = counts.filter((c) => c.n !== null) as Array<{ t: string; n: number }>;
          if (known.length === ep.queries.length && known.every((c) => c.n > 0)) {
            add(ep.path, {
              phase: 'smoke',
              probe: probe.label,
              message:
                `answered 200 with ZERO rows, but the table(s) it queries hold data ` +
                `(${known.map((c) => `${c.t}=${c.n}`).join(', ')}). A no-filter list over a populated ` +
                `table returning nothing means the handler reads the wrong table, an unpopulated column, ` +
                `or filters on a value the rows never use — the page will render empty over a full db. ` +
                `Query the table that actually holds these rows and return them.`,
            });
          } else {
            unmeasuredCount++;
          }
        }
        // The SYNTHETIC-PROBE BLINDNESS, closed. The valid probe fills every route param with
        // `smoke-<p>` and every filter with a synthetic value NO real row can match, so a clean
        // `{ items: [] }` proves the handler RUNS — never that it can ever RETURN data. Source a
        // REAL row from the backing table and ask again: rows → measured; STILL zero rows → a
        // FINDING (the endpoint can never return data for a real record, and the page bound to it
        // renders loading skeletons forever while every other gate stays green); every backing table
        // genuinely empty → a brand-new app, legitimately empty, counted `unmeasured` and never a
        // finding. "The query could not run" is a fault; "the query ran and there is no data" is not.
        else if (ep.queries.length > 0) {
          const samples: Array<{ table: string; row: Record<string, unknown>; n: number }> = [];
          let unreadable: string | null = null;
          for (const t of ep.queries) {
            const rows = await tableRows(t);
            if (rows === null) {
              unreadable = t;
              continue;
            }
            const row = rows.length > 0 ? rows[0] : null;
            if (row !== null && typeof row === 'object') {
              samples.push({ table: t, row: row as Record<string, unknown>, n: rows.length });
            }
          }
          if (samples.length === 0 && unreadable !== null) {
            // (c) NEVER-RUN-CERTIFIABLY: the backing table could not even be read, so no real id
            // exists to re-ask with. Unmeasured is a FINDING here, not a pass.
            unmeasuredCount++;
            add(ep.path, {
              phase: 'smoke',
              probe: 'real-row-probe',
              message:
                `answered 200 with ZERO rows and its data plumbing is UNMEASURED: \`db.query("${unreadable}")\` ` +
                `failed, so the gate could not read a real row to re-ask with. The endpoint compiles and ` +
                `answers, but nothing proves it can ever return data — and the page bound to it renders ` +
                `loading skeletons forever. Make sure the table exists and the handler queries it by name.`,
            });
          } else if (samples.length === 0) {
            // (b) RAN AND LEGITIMATELY EMPTY: every backing table is genuinely empty — a brand-new
            // app. The query ran; there is no data. Not a finding, and NOT counted as verified.
            unmeasuredCount++;
          } else {
            let verified = false;
            const tried: string[] = [];
            for (const { table, row, n } of samples.slice(0, 2)) {
              const real: Record<string, unknown> = { ...probe.input };
              let usable = true;
              for (const p of ep.params) {
                const v = row[p] ?? row['id'];
                if (v === undefined || v === null || v === '') {
                  usable = false;
                  break;
                }
                real[p] = v;
              }
              for (const k of Object.keys(ep.input)) {
                if (row[k] !== undefined) real[k] = row[k];
              }
              if (!usable) continue;
              const realDesc = ep.params.length > 0
                ? `${ep.params.map((p) => `${p}=${JSON.stringify(real[p])}`).join(', ')}`
                : JSON.stringify(real);
              try {
                const rr = await call(ep.name, real);
                const st = typeof rr?.status === 'number' ? rr.status : 0;
                if (st >= 200 && st < 400 && itemCount(rr.body) > 0) {
                  verified = true;
                  break;
                }
                tried.push(
                  `with the REAL \`${table}\` row (${realDesc}; the table holds ${n}) it answered ` +
                    `${st || 'no status'} with ${itemCount(rr.body)} row(s)`,
                );
              } catch (e) {
                tried.push(
                  `with the REAL \`${table}\` row (${realDesc}) it THREW: ${String(e instanceof Error ? e.message : e)}`,
                );
              }
            }
            if (verified) {
              measuredCount++;
            } else if (tried.length > 0) {
              add(ep.path, {
                phase: 'smoke',
                probe: 'real-row-probe',
                message:
                  `answered 200 with ZERO rows for the synthetic probe, AND ${tried.join('; ')} — ` +
                  `the endpoint can never return data for a real record, so the page bound to it ` +
                  `renders loading skeletons forever while typecheck, the bundle and app validation ` +
                  `all stay green. Read \`input.${ep.params[0] ?? Object.keys(ep.input)[0] ?? 'id'}\` ` +
                  `and return the row(s) the backing table actually holds for that value.`,
              });
            } else {
              unmeasuredCount++; // rows exist but none carries the param/id field — cannot certify
            }
          }
        } else {
          unmeasuredCount++; // no literal table to source a real row from — cannot certify
        }
      }

      if (probe.undefinedParam && itemCount(res.body) > 0) {
        add(ep.path, {
          phase: 'smoke',
          probe: probe.label,
          message:
            `called with ${probe.label === 'missing-route-params' ? 'NO route params' : `${ep.params.map((p) => `${p}="undefined"`).join(', ')}`} ` +
            `it still answered ${status} with ${itemCount(res.body)} row(s) — the route declares ` +
            `${ep.params.map((p) => `[${p}]`).join('')} but the handler never reads it, so a page that ` +
            `forgets the value gets a plausible 200 carrying the WRONG row (client.ts stringifies the ` +
            `missing value into the path, which still matches and still passes validation). Read ` +
            `\`input.${ep.params[0]}\` and return only the matching row(s).`,
        });
      }
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
    checked: endpoints.length,
    offending,
    offendingCount: offending.length,
    unavailable: false,
    reason: '',
    measured: measuredCount,
    unmeasured: unmeasuredCount,
  };
}
