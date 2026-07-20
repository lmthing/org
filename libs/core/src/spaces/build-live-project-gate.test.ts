import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The build gate — `16-verify.ts`, a HOST-RUN code node — driven against a mocked project
 * filesystem.
 *
 * This file used to extract the fenced ```typescript block out of `12-compile_pass1.md` and eval
 * it, because the scans lived in prose the MODEL had to re-emit on every pass. That arrangement
 * was as much the bug as the thing under test: in 06-tanzania run 32, 44 of 124 errors across the
 * three build steps were the model failing to reproduce that snippet (`'gateErrors' is not
 * defined` cascades) — and a gate that fails to execute contributes no findings, which the
 * pipeline reads as "clean". The scans are now real code, so this exercises the real `run()`.
 *
 * Each fault below is invisible to `buildApp()` (typecheck + esbuild); three were measured live:
 *  - `useApi('costs-summary')` — an endpoint never generated. The client rejects an unknown name
 *    BEFORE issuing a request, so the page renders an error state with no network trace.
 *  - a `[id]` route called with no input — the missing value is stringified into the path, which
 *    still matches and passes validation, returning a plausible 200 carrying the wrong row.
 *  - `Page()` returning a bare `{ type, props }` literal — this system's OWN display()-descriptor
 *    shape, not renderable React: typechecks, then throws React error #31.
 *  - `text-muted` — a surface token as a text colour. A shipped app carried 149 of these at
 *    contrast 1.08 where WCAG AA needs 4.5.
 */

type Offending = { path: string; kind: string; errors: Array<{ line?: number; phase: string; message: string }> };
type GateResult = { ok: boolean; built: boolean; routes: string[]; offending: Offending[]; offendingCount: number };

// The node lives outside libs/core's tsconfig `include: ["src"]`, so it is reached by a computed
// dynamic import rather than a static one.
let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<GateResult>;
beforeAll(async () => {
  const mod = (await import(
    new URL(
      '../../system-spaces/system-appbuilder/tasklists/build_live_project/16-verify.ts',
      import.meta.url,
    ).href
  )) as { run: typeof run };
  run = mod.run;
});

/**
 * A project as a flat `path -> contents` map plus a scripted `buildApp()` result. `listProjectDir`
 * returns BARE entry names for ONE directory level — never full paths — exactly like the real
 * global in `sdk/org/libs/cli/src/app/authoring/globals.ts`.
 */
function ctxFor(files: Record<string, string>, build?: Record<string, unknown>) {
  const paths = Object.keys(files);
  return {
    buildProjectApp: async () => ({ ok: true, built: true, routes: ['/'], errors: [], ...(build ?? {}) }),
    listProjectDir: (dir: string) => {
      const entries = new Set<string>();
      for (const p of paths) {
        if (!p.startsWith(`${dir}/`)) continue;
        entries.add(p.slice(dir.length + 1).split('/')[0]!);
      }
      return { ok: true, entries: [...entries] };
    },
    readProjectFile: (path: string) => ({ ok: true, content: files[path] ?? '' }),
  };
}

const LIST_ENDPOINT = `export const name = 'costs-list';
export interface Output { items: any[] }
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('costs') }; }
`;

const DETAIL_ENDPOINT = `export const name = 'trips-detail';
export interface Output { id: string }
export default async function handler(_i: any, ctx: any) { return { id: '' }; }
`;

const page = (body: string) => `import { useApi } from '@app/runtime';
export default function Page() {
${body}
}
`;

const findingsFor = (r: GateResult, path: string) =>
  (r.offending.find((o) => o.path === path)?.errors ?? []).map((e) => e.message).join(' | ');

/** A clean baseline project: one table, one endpoint, one page that reads it correctly. */
const CLEAN = {
  'database/costs.json': '{}',
  'api/costs-list/GET.ts': LIST_ENDPOINT,
};

/** The ctx the node ACTUALLY gets: every authoring global proxied as an async RPC stub. */
function asyncCtxFor(files: Record<string, string>, build?: Record<string, unknown>) {
  const sync = ctxFor(files, build);
  return {
    buildProjectApp: sync.buildProjectApp,
    listProjectDir: async (dir: string) => sync.listProjectDir(dir),
    readProjectFile: async (path: string) => sync.readProjectFile(path),
  };
}

describe('build_live_project — the verify gate (16-verify.ts)', () => {
  it('LOAD-BEARING: scans still run when ctx is ASYNC — the real worker shape', async () => {
    // `worker-load-entry.ts` proxies every authoring global as an RPC stub returning a PROMISE, so
    // a synchronous `ctx.listProjectDir(dir).entries` reads a property off a Promise (undefined) and
    // every scan silently finds nothing. The node still resolves and still reports the compiler's
    // errors, so the pipeline reads "no scan findings" as "the scans were clean" — the exact
    // silent-and-load-bearing failure this gate exists to end. A sync-mock test cannot see it.
    const r = await run(
      asyncCtxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-summary');
  return <p className="text-muted">{JSON.stringify(data)}</p>;`),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = findingsFor(r, 'pages/index.tsx');
    expect(msg).toContain('costs-summary'); // page→endpoint scan ran
    expect(msg).toContain('text-muted'); // surface-token scan ran
  });

  it('finds nothing to report on a clean project through an ASYNC ctx', async () => {
    const r = await run(
      asyncCtxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-list');
  return <div className="text-muted-foreground">{JSON.stringify(data)}</div>;`),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('passes a clean project', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-list');
  return <div className="text-muted-foreground">{JSON.stringify(data)}</div>;`),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.offendingCount).toBe(0);
  });

  it('flags a useApi name no endpoint exports', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-summary');
  return <div>{JSON.stringify(data)}</div>;`),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = findingsFor(r, 'pages/index.tsx');
    expect(msg).toContain('costs-summary');
    expect(msg).toContain('costs-list'); // must name the real options — it is the fixer's whole input
  });

  it('flags a [id] route called with no input', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/trips/[id]/GET.ts': DETAIL_ENDPOINT,
        'pages/detail.tsx': page(`  const { data } = useApi('trips-detail');
  return <div>{JSON.stringify(data)}</div>;`),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'pages/detail.tsx')).toContain('[id]');
  });

  it('accepts the same [id] route once its param is supplied', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/trips/[id]/GET.ts': DETAIL_ENDPOINT,
        'pages/detail.tsx': page(`  const { data } = useApi('trips-detail', { id: 'abc' });
  return <div>{JSON.stringify(data)}</div>;`),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
  });

  it('does NOT flag useApiMutation on a [id] route with no hook-time input', async () => {
    // Run 34 flagged `useApiMutation('notes-delete')` for a missing `[id]`. False positive: the hook
    // returns a MUTATE FUNCTION and the input is supplied when THAT is called. `useApi`/`apiCall`
    // take input positionally and are still checked (the test above).
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/notes/[id]/DELETE.ts': `export const name = 'notes-delete';
export default async function handler(_i: any, ctx: any) { return { ok: true }; }
`,
        'pages/notes.tsx': page(`  const del = useApiMutation('notes-delete');
  return <button onClick={() => del({ id: '1' })}>x</button>;`),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
  });

  it('FOLDS IN smoke_endpoints findings — fix fans out over verify.offending and nothing else', async () => {
    // `verify` depends on `smoke_endpoints` but originally never READ it, so every runtime fault the
    // only node that actually calls an endpoint could find was computed and discarded. Worse than not
    // probing: the pipeline reports a gate that ran and found nothing.
    const r = await run(ctxFor({ ...CLEAN, 'pages/index.tsx': page(`  return <div>ok</div>;`) }), {
      smoke_endpoints: {
        ok: false,
        offending: [
          {
            path: 'api/costs-list/GET.ts',
            kind: 'api',
            errors: [{ phase: 'smoke', message: 'valid-input probe returned 500' }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.offending.map((o) => o.path)).toContain('api/costs-list/GET.ts');
    expect(findingsFor(r, 'api/costs-list/GET.ts')).toContain('500');
  });

  it('surfaces an UNAVAILABLE smoke probe rather than letting it read as clean', async () => {
    const r = await run(ctxFor({ ...CLEAN, 'pages/index.tsx': page(`  return <div>ok</div>;`) }), {
      smoke_endpoints: { ok: false, unavailable: true, reason: 'ctx has no callProjectApi', offending: [] },
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.offending)).toContain('did not run');
  });

  it('is unaffected when smoke_endpoints reports clean', async () => {
    const r = await run(ctxFor({ ...CLEAN, 'pages/index.tsx': page(`  return <div>ok</div>;`) }), {
      smoke_endpoints: { ok: true, offending: [], offendingCount: 0 },
    });
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('flags a Page() returning a { type, props } descriptor instead of JSX', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'pages/index.tsx': `export default function Page() {
  return { type: 'div', props: { className: 'p-4', children: 'Cash Expenses' } };
}
`,
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'pages/index.tsx')).toContain('React error #31');
  });

  it('flags a surface token used as a text colour', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-list');
  return <p className="text-xs text-muted uppercase">{JSON.stringify(data)}</p>;`),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = findingsFor(r, 'pages/index.tsx');
    expect(msg).toContain('text-muted');
    expect(msg).toContain('text-muted-foreground'); // tells the fixer what to write instead
  });

  it('does NOT flag text-muted-foreground, nor bg-muted', async () => {
    // A false positive here would teach the fixer to "correct" working code.
    const r = await run(
      ctxFor({
        ...CLEAN,
        'pages/index.tsx': page(`  const { data } = useApi('costs-list');
  return <p className="bg-muted text-muted-foreground">{JSON.stringify(data)}</p>;`),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
  });

  it('flags an api module querying a table that does not exist', async () => {
    const r = await run(
      ctxFor({
        'database/costs.json': '{}',
        'api/costs-list/GET.ts': `export const name = 'costs-list';
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('expenses') }; }
`,
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'api/costs-list/GET.ts')).toContain('expenses');
  });

  it('scans components as well as pages', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'components/Total.tsx': `import { useApi } from '@app/runtime';
export default function Total() {
  const { data } = useApi('costs-summary');
  return <span className="text-muted">{JSON.stringify(data)}</span>;
}
`,
      }),
      {},
    );
    expect(r.offending.map((o) => o.path)).toEqual(['components/Total.tsx']);
    expect(r.offending[0]!.kind).toBe('component');
    expect(r.offending[0]!.errors).toHaveLength(2); // bad endpoint name AND the surface token
  });

  it('folds real compiler errors in alongside the scans, grouped by file', async () => {
    const r = await run(
      ctxFor(
        {
          ...CLEAN,
          'pages/index.tsx': page(`  const { data } = useApi('nope');
  return <div>{JSON.stringify(data)}</div>;`),
        },
        {
          ok: false,
          errors: [{ phase: 'typecheck', file: 'pages/index.tsx', line: 3, message: "Cannot find name 'console'." }],
        },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.offending).toHaveLength(1); // one entry per FILE…
    expect(r.offending[0]!.errors).toHaveLength(2); // …carrying compiler error AND gate finding
    expect(r.offending[0]!.errors.map((e) => e.phase).sort()).toEqual(['gate', 'typecheck']);
  });

  it('reports a build failure even when every scan is clean', async () => {
    const r = await run(
      ctxFor(
        {
          ...CLEAN,
          'pages/index.tsx': page(`  const { data } = useApi('costs-list');
  return <div>{JSON.stringify(data)}</div>;`),
        },
        { ok: false, built: false, errors: [{ phase: 'build', file: 'pages/index.tsx', message: 'bundle failed' }] },
      ),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.built).toBe(false);
  });

  it('never throws on a finding — a code node has no salvage path', async () => {
    // A throw would fail the whole node and abort the tasklist instead of routing the faults to
    // `fix`. Every fault must come back as DATA.
    const r = await run(ctxFor({ 'pages/index.tsx': page(`  return { type: 'div', props: {} };`) }), {});
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.offending)).toBe(true);
  });
});
