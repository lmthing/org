import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The endpoint smoke gate — `13-smoke_endpoints.ts`, a HOST-RUN code node — driven against a mocked
 * project filesystem and a scripted api runtime.
 *
 * It exists because NOTHING else in `build_live_project` ever calls a generated endpoint. Two real
 * builds shipped on that blind spot:
 *  - 06-tanzania run 25 step 10: `actual-payments-list` / `blended-spending-total` shipped with
 *    `built: true` and 500 on the first request — no backing table was ever created. Found by a
 *    human with curl, after the pipeline declared success.
 *  - run 32 step 3: a "TOTAL COST" tile reading €0 + $0 over a db holding €2707 + $3344.20. A
 *    handler reading a column nobody populated is structurally perfect and semantically empty.
 *
 * Every fault must come back as DATA — a code node has no salvage path, so a throw would abort the
 * whole tasklist instead of routing the faults to the per-file `fix` fork.
 */

type Offending = {
  path: string;
  kind: string;
  name?: string;
  errors: Array<{ phase: string; probe: string; message: string }>;
};
type SmokeResult = {
  ok: boolean;
  checked: number;
  offending: Offending[];
  offendingCount: number;
  unavailable: boolean;
  reason: string;
};

// The node lives outside libs/core's tsconfig `include: ["src"]`, so it is reached by a computed
// dynamic import rather than a static one.
let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<SmokeResult>;
beforeAll(async () => {
  const mod = (await import(
    new URL(
      '../../system-spaces/system-appbuilder/tasklists/build_live_project/13-smoke_endpoints.ts',
      import.meta.url,
    ).href
  )) as { run: typeof run };
  run = mod.run;
});

type ApiResponse = { status: number; body: unknown };
/** `name -> (input) => response`. A handler may also THROW, to model a rejected host proxy. */
type Handlers = Record<string, (input: Record<string, unknown>) => ApiResponse>;

/** A project as a flat `path -> contents` map plus a scripted api runtime. `listProjectDir` returns
 *  BARE entry names for ONE directory level, exactly like the real authoring global. */
function ctxFor(files: Record<string, string>, handlers: Handlers, calls?: Array<[string, unknown]>) {
  const paths = Object.keys(files);
  return {
    listProjectDir: (dir: string) => {
      const entries = new Set<string>();
      for (const p of paths) {
        if (!p.startsWith(`${dir}/`)) continue;
        entries.add(p.slice(dir.length + 1).split('/')[0]!);
      }
      return { ok: true, entries: [...entries] };
    },
    readProjectFile: (path: string) => ({ ok: true, content: files[path] ?? '' }),
    callProjectApi: async (name: string, input?: unknown) => {
      calls?.push([name, input]);
      const h = handlers[name];
      if (!h) return { status: 404, body: { error: `no endpoint named "${name}"` } };
      return h((input ?? {}) as Record<string, unknown>);
    },
  };
}

const LIST_ENDPOINT = `export const name = 'costs-list';
export interface Input {}
export interface Output { items: any[] }
export default async function handler(_i: Input, ctx: any) { return { items: await ctx.db.query('costs') }; }
`;

const DETAIL_ENDPOINT = `export const name = 'trips-detail';
export interface Input { id: string }
export interface Output { items: any[] }
export default async function handler(i: Input, ctx: any) { return { items: [] }; }
`;

const ok = (items: unknown[]) => ({ status: 200, body: { items } });

const messagesFor = (r: SmokeResult, path: string) =>
  (r.offending.find((o) => o.path === path)?.errors ?? []).map((e) => e.message).join(' | ');

describe('build_live_project — the endpoint smoke gate (13-smoke_endpoints.ts)', () => {
  it('passes an endpoint set where every probe answers correctly', async () => {
    const r = await run(
      ctxFor({ 'api/costs-list/GET.ts': LIST_ENDPOINT }, { 'costs-list': () => ok([{ amount: 1 }]) }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.offendingCount).toBe(0);
    expect(r.checked).toBe(1);
    expect(r.unavailable).toBe(false);
  });

  it('actually INVOKES each endpoint — valid, wrong-typed and missing-param probes', async () => {
    const calls: Array<[string, unknown]> = [];
    await run(
      ctxFor(
        { 'api/trips/[id]/GET.ts': DETAIL_ENDPOINT },
        { 'trips-detail': (i) => ok(i['id'] === 'smoke-id' ? [{ id: 'smoke-id' }] : []) },
        calls,
      ),
      {},
    );
    const inputs = calls.map(([, i]) => i as Record<string, unknown>);
    expect(calls.every(([n]) => n === 'trips-detail')).toBe(true);
    expect(inputs).toContainEqual({ id: 'smoke-id' }); // valid
    expect(inputs).toContainEqual({ id: 12345 }); // wrong-typed (a number where a string is declared)
    expect(inputs).toContainEqual({}); // missing route param
    expect(inputs).toContainEqual({ id: 'undefined' }); // what client.ts actually produces
  });

  it('reports a 500 — the run-25 fault: compiles, bundles, then dies on the first real call', async () => {
    const r = await run(
      ctxFor(
        { 'api/actual-payments-list/GET.ts': LIST_ENDPOINT.replace('costs-list', 'actual-payments-list') },
        { 'actual-payments-list': () => ({ status: 500, body: { error: 'internal error' } }) },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = messagesFor(r, 'api/actual-payments-list/GET.ts');
    expect(msg).toContain('500');
    expect(msg).toContain('table'); // names the usual cause — it is the fixer's whole input
  });

  it('reports a route param that arrives as the literal string "undefined"', async () => {
    // The handler ignores `id` entirely, so `id="undefined"` still answers 200 with a plausible row.
    const r = await run(
      ctxFor({ 'api/trips/[id]/GET.ts': DETAIL_ENDPOINT }, { 'trips-detail': () => ok([{ id: 'trip-1' }]) }),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = messagesFor(r, 'api/trips/[id]/GET.ts');
    expect(msg).toContain('undefined');
    expect(msg).toContain('[id]');
  });

  it('does NOT flag a [id] route whose handler really does filter on the param', async () => {
    // A false positive teaches the fixer to "repair" working code, which is worse than a miss.
    const r = await run(
      ctxFor(
        { 'api/trips/[id]/GET.ts': DETAIL_ENDPOINT },
        { 'trips-detail': (i) => ok(i['id'] === 'smoke-id' ? [{ id: 'smoke-id' }] : []) },
      ),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reports a wrong-typed input that crashes the handler', async () => {
    const r = await run(
      ctxFor(
        { 'api/trips/[id]/GET.ts': DETAIL_ENDPOINT },
        {
          'trips-detail': (i) => {
            if (typeof i['id'] !== 'string') return { status: 500, body: { error: 'id.trim is not a function' } };
            return ok(i['id'] === 'smoke-id' ? [{ id: 'smoke-id' }] : []);
          },
        },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    const errors = r.offending[0]!.errors;
    expect(errors.map((e) => e.probe)).toContain('wrong-typed-input');
    expect(messagesFor(r, 'api/trips/[id]/GET.ts')).toContain('500');
  });

  it('does NOT flag a 4xx on a deliberately bad input — rejecting it is the CORRECT answer', async () => {
    const r = await run(
      ctxFor(
        { 'api/trips/[id]/GET.ts': DETAIL_ENDPOINT },
        {
          'trips-detail': (i) => {
            if (typeof i['id'] !== 'string') return { status: 400, body: { error: 'invalid input' } };
            return ok(i['id'] === 'smoke-id' ? [{ id: 'smoke-id' }] : []);
          },
        },
      ),
      {},
    );
    expect(r.offending).toEqual([]);
  });

  it('reports a read endpoint that breaks the { items: T[] } envelope', async () => {
    const r = await run(
      ctxFor(
        { 'api/dashboard-summary/GET.ts': LIST_ENDPOINT.replace('costs-list', 'dashboard-summary') },
        // The aggregate returned as a BARE object instead of the one element of `items`.
        { 'dashboard-summary': () => ({ status: 200, body: { items: { grand_total_usd: 0 } } }) },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    expect(messagesFor(r, 'api/dashboard-summary/GET.ts')).toContain('items');
  });

  it('does NOT impose the read envelope on a write endpoint', async () => {
    const r = await run(
      ctxFor(
        { 'api/costs-create/POST.ts': LIST_ENDPOINT.replace('costs-list', 'costs-create') },
        { 'costs-create': () => ({ status: 200, body: { id: 'new-1' } }) },
      ),
      {},
    );
    expect(r.offending).toEqual([]);
  });

  it('reports a name the api runtime does not know (404)', async () => {
    const r = await run(ctxFor({ 'api/costs-list/GET.ts': LIST_ENDPOINT }, {}), {});
    expect(r.ok).toBe(false);
    expect(messagesFor(r, 'api/costs-list/GET.ts')).toContain('404');
  });

  it('groups findings per endpoint file, one entry per file', async () => {
    const r = await run(
      ctxFor(
        {
          'api/costs-list/GET.ts': LIST_ENDPOINT,
          'api/trips/[id]/GET.ts': DETAIL_ENDPOINT,
        },
        {
          'costs-list': () => ({ status: 500, body: { error: 'boom' } }),
          'trips-detail': () => ok([{ id: 'trip-1' }]),
        },
      ),
      {},
    );
    expect(r.offendingCount).toBe(2);
    expect(r.offending.map((o) => o.path).sort()).toEqual(['api/costs-list/GET.ts', 'api/trips/[id]/GET.ts']);
    expect(r.offending.every((o) => o.kind === 'api')).toBe(true);
    expect(r.offending.find((o) => o.path === 'api/costs-list/GET.ts')!.name).toBe('costs-list');
    expect(r.offending.every((o) => Array.isArray(o.errors) && o.errors.length > 0)).toBe(true);
  });

  it('emits a scalar-friendly shape — `getAtPath` returns undefined for arrays', async () => {
    // `x.offending.length > 0` is NOT expressible in a `when:` condition, so the node must carry
    // scalars a condition can actually read.
    const r = await run(
      ctxFor({ 'api/costs-list/GET.ts': LIST_ENDPOINT }, { 'costs-list': () => ({ status: 500, body: {} }) }),
      {},
    );
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.offendingCount).toBe('number');
    expect(typeof r.checked).toBe('number');
    expect(typeof r.unavailable).toBe('boolean');
    expect(r.offendingCount).toBe(1);
  });

  it('never throws — a rejected call comes back as DATA, not as a failed node', async () => {
    // A throw would abort the whole tasklist instead of routing the fault to `fix`.
    const r = await run(
      ctxFor(
        { 'api/costs-list/GET.ts': LIST_ENDPOINT },
        {
          'costs-list': () => {
            throw new Error('worker timed out');
          },
        },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.offending)).toBe(true);
    expect(messagesFor(r, 'api/costs-list/GET.ts')).toContain('worker timed out');
  });

  it('passes cleanly when the project defines no endpoints at all', async () => {
    const r = await run(ctxFor({}, {}), {});
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(0);
  });

  it('fails LOUDLY, with an empty `offending`, when the ctx has no api-invoking capability', async () => {
    // An un-run gate that reported `ok: true` with no findings would be indistinguishable from a
    // clean one — the silent, load-bearing failure the host-run gates exist to end. `offending`
    // stays empty so the per-file `fix` fan-out is not pointed at a host wiring bug.
    const base = ctxFor({ 'api/costs-list/GET.ts': LIST_ENDPOINT }, {}) as Record<string, unknown>;
    delete base['callProjectApi'];
    const r = await run(base, {});
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.offendingCount).toBe(0);
    expect(r.reason).toContain('callProjectApi');
  });
});
