/**
 * The endpoint smoke gate — HOST-RUN, and the ONLY thing in this pipeline that ever CALLS a
 * generated endpoint.
 *
 * Everything upstream is static. `writeProjectApi` parses the module, `verify` typechecks it and
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
   * NOT WIRED TODAY — see the report accompanying this node. `createCodeNodeCtxFactory`
   * (`libs/cli/src/server/tasklist-runner.ts`) hands a code node only `db`, `delegate`,
   * `callConnection` and the `authoring` writers, and `ProjectAuthoringGlobals`
   * (`libs/cli/src/app/authoring/globals.ts`) has no api-invoking member — `buildProjectApp` is its
   * closest sibling and the exact precedent for adding one. Until it is threaded, this node
   * reports `unavailable: true` LOUDLY rather than returning an empty finding list, because an
   * empty finding list is precisely what the pipeline reads as "clean".
   */
  callProjectApi?: (name: string, input?: unknown) => Promise<ApiResponse>;
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
    found.push({ path, name: m[1] as string, params, method, input: parseInputFields(src) });
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
    };
  }
  const call = ctx.callProjectApi;

  const byFile: Record<string, Finding[]> = {};
  const nameOf: Record<string, string> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };

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
  };
}
