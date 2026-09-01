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
 * **What this gate checks changed with the one-builder merge.** Pages are SPECS now: no imports, no
 * JSX, no class names. So the TSX scans this file used to drive — a `useApi` name no endpoint
 * exports, a `[id]` route called with no input, a `Page()` returning a `{ type, props }` descriptor,
 * a surface token used as a text colour — are gone, because those faults cannot be AUTHORED here and
 * a scan for them could only produce false positives. In their place the node merges three ground
 * truths, none of them a model self-assessment:
 *
 *  1. `buildProjectApp()` — the real typecheck + esbuild over the host-generated page wrappers.
 *  2. `validateAppViews()` — the WHOLE-APP checks a per-page save cannot make.
 *  3. `renderSmokeViews()` — every view MOUNTED against the app's live endpoint responses.
 *
 * (3) is the one nothing else can see: a spec whose every name resolves and whose every binding is
 * contract-valid still ships a blank page when the endpoint's computed field is not computed. An
 * always-null binding is therefore an ENDPOINT defect and must be routed to the HANDLER — pointing
 * it at the view teaches the fixer to delete the binding, i.e. to delete the feature.
 *
 * The ONE mechanical scan that survives is the one whose fault class survives too: a handler or hook
 * naming a table that does not exist. The db surface is dynamically typed, so it builds CLEAN and
 * 500s on every call — and that 500 is what a section renders as permanently empty.
 */

type Offending = { path: string; kind: string; errors: Array<{ line?: number; phase: string; message: string }> };
type GateResult = {
  ok: boolean;
  built: boolean;
  routes: string[];
  offending: Offending[];
  offendingCount: number;
  viewsValidated: boolean;
  renderSmoked: boolean;
  unavailable: string[];
};

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

/** `libs/cli/src/app/view-spec/messages.ts#ViewError`. */
type ViewError = {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  endpoint?: string;
};

const viewResult = (errors: ViewError[], checked = 3) => ({
  ok: errors.length === 0,
  errorCount: errors.filter((e) => e.severity === 'error').length,
  warningCount: errors.filter((e) => e.severity === 'warning').length,
  checked,
  errors,
});
const smokeResult = (errors: ViewError[], extra: Record<string, unknown> = {}) => ({
  ...viewResult(errors),
  unavailable: false,
  rendererMounted: true,
  ...extra,
});

/**
 * A project as a flat `path -> contents` map plus a scripted `buildApp()` result. `listProjectDir`
 * returns BARE entry names for ONE directory level — never full paths — exactly like the real
 * global in `sdk/org/libs/cli/src/app/authoring/globals.ts`.
 *
 * `validateAppViews`/`renderSmokeViews` are supplied CLEAN by default. That default is the point:
 * the node treats an ABSENT view gate as a finding (see the tests below), so a mock that omitted
 * them would report two errors on every otherwise-clean project.
 */
function ctxFor(
  files: Record<string, string>,
  build?: Record<string, unknown>,
  views?: { validate?: unknown; smoke?: unknown },
) {
  const paths = Object.keys(files);
  const ctx: Record<string, unknown> = {
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
  const validate = views && 'validate' in views ? views.validate : viewResult([]);
  const smoke = views && 'smoke' in views ? views.smoke : smokeResult([]);
  if (validate !== undefined) ctx['validateAppViews'] = () => validate;
  if (smoke !== undefined) ctx['renderSmokeViews'] = () => smoke;
  return ctx;
}

/** The ctx the node ACTUALLY gets: every authoring global proxied as an async RPC stub. */
function asyncCtxFor(
  files: Record<string, string>,
  build?: Record<string, unknown>,
  views?: { validate?: unknown; smoke?: unknown },
) {
  const sync = ctxFor(files, build, views) as Record<string, (...a: never[]) => unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(sync)) out[k] = async (...a: never[]) => fn(...a);
  return out;
}

const LIST_ENDPOINT = `export const name = 'costs-list';
export interface Output { items: any[] }
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('costs') }; }
`;

const findingsFor = (r: GateResult, path: string) =>
  (r.offending.find((o) => o.path === path)?.errors ?? []).map((e) => e.message).join(' | ');

/** A clean baseline project: one table, one endpoint reading it, one page spec + its shell. */
const CLEAN = {
  'database/costs.json': '{}',
  'api/costs-list/GET.ts': LIST_ENDPOINT,
  'views/index.view.json': '{"route":"index","sections":[]}',
  'shell.view.json': '{"nav":[]}',
};

/** The scaffold every new project is born with — `libs/cli/src/server/projects.ts#newbornIndexViewSpec`
 *  plus `#NEWBORN_SHELL_SPEC`. No table, no endpoint, one placeholder chat page. */
const NEWBORN = {
  'views/index.view.json':
    '{"route":"index","title":"Reading List","sections":[{"id":"chat","kind":"chat","agent":"thing","height":"full"}]}',
  'shell.view.json': '{"assistant":false}',
};

describe('build_live_project — the verify gate (16-verify.ts)', () => {
  it('flags a build that produced NOTHING — the app is still the newborn scaffold', async () => {
    // Measured, not hypothesised: `runProjectAppCheck` answers `{ok:true,built:true,routes:["/"]}` on
    // exactly this project, because the placeholder chat page is genuinely valid. Every gate in this
    // node agreed with it — `validateAppViews` sees `checked: 1`, so even the zero-artifact guard
    // passes — and a reading-list build whose only page was that placeholder shipped as a success.
    const r = await run(ctxFor(NEWBORN), {});
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'shell.view.json')).toContain('nothing was built');
    // It must NOT read as a broken file, or `fix` would edit the placeholder instead of re-running
    // the implement steps.
    expect(findingsFor(r, 'shell.view.json')).toContain('Do not "fix" this file');
  });

  it('does NOT flag a real app that happens to have one view', async () => {
    // The floor is exact, not a "small app" heuristic: one REAL page is a legitimate app. Only the
    // untouched newborn chat index — route `index`, a single `chat` section — counts as unbuilt.
    const r = await run(
      ctxFor({
        'database/costs.json': '{}',
        'api/costs-list/GET.ts': LIST_ENDPOINT,
        'views/costs.view.json':
          '{"route":"costs","sections":[{"id":"costs","kind":"list","endpoint":"costs-list"}]}',
        'shell.view.json': '{"nav":[]}',
      }),
      {},
    );
    expect(findingsFor(r, 'shell.view.json')).not.toContain('nothing was built');
  });

  it('does NOT flag a real app whose index page is a chat among other pages', async () => {
    // A built app may legitimately KEEP a chat index; what makes the scaffold the scaffold is that
    // it is the ONLY view.
    const r = await run(
      ctxFor({
        'database/costs.json': '{}',
        'api/costs-list/GET.ts': LIST_ENDPOINT,
        'views/index.view.json':
          '{"route":"index","sections":[{"id":"chat","kind":"chat","agent":"thing"}]}',
        'views/costs.view.json':
          '{"route":"costs","sections":[{"id":"costs","kind":"list","endpoint":"costs-list"}]}',
        'shell.view.json': '{"nav":[]}',
      }),
      {},
    );
    expect(findingsFor(r, 'shell.view.json')).not.toContain('nothing was built');
  });

  it('passes a clean project', async () => {
    const r = await run(ctxFor(CLEAN), {});
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.offendingCount).toBe(0);
    expect(r.viewsValidated).toBe(true);
    expect(r.renderSmoked).toBe(true);
    expect(r.unavailable).toEqual([]);
  });

  it('LOAD-BEARING: the scans still run when ctx is ASYNC — the real worker shape', async () => {
    // `worker-load-entry.ts` proxies every authoring global as an RPC stub returning a PROMISE, so
    // a synchronous `ctx.listProjectDir(dir).entries` reads a property off a Promise (undefined) and
    // every scan silently finds nothing. The node still resolves and still reports the compiler's
    // errors, so the pipeline reads "no scan findings" as "the scans were clean" — the exact
    // silent-and-load-bearing failure this gate exists to end. A sync-mock test cannot see it.
    const r = await run(
      asyncCtxFor({
        ...CLEAN,
        'api/costs-list/GET.ts': `export const name = 'costs-list';
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('expenses') }; }
`,
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'api/costs-list/GET.ts')).toContain('expenses'); // the table scan ran
  });

  it('finds nothing to report on a clean project through an ASYNC ctx', async () => {
    const r = await run(asyncCtxFor(CLEAN), {});
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // ── (1) THE BUILD ────────────────────────────────────────────────────────────────────────────

  it('folds real compiler errors in alongside the scans, grouped by file', async () => {
    const r = await run(
      ctxFor(
        {
          ...CLEAN,
          'api/costs-list/GET.ts': `export const name = 'costs-list';
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('expenses') }; }
`,
        },
        {
          ok: false,
          errors: [{ phase: 'typecheck', file: 'api/costs-list/GET.ts', line: 3, message: "Cannot find name 'console'." }],
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
      ctxFor(CLEAN, { ok: false, built: false, errors: [{ phase: 'build', file: 'api/costs-list/GET.ts', message: 'bundle failed' }] }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.built).toBe(false);
  });

  // ── (2) THE APP-WIDE VIEW VALIDATION ─────────────────────────────────────────────────────────

  it('routes an app-wide view fault to the SHELL — the only artifact that owns the app as a whole', async () => {
    // An orphan route and a dangling nav target belong to no single page. The shell is where a fix
    // for either one actually goes, so that is where the finding has to land.
    const r = await run(
      ctxFor(CLEAN, undefined, {
        validate: viewResult([
          { code: 'orphan-route', path: 'nav', message: 'route "costs" is not reachable from the nav', severity: 'error' },
        ]),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.offending.map((o) => o.path)).toEqual(['shell.view.json']);
    expect(r.offending[0]!.kind).toBe('shell');
    expect(findingsFor(r, 'shell.view.json')).toContain('not reachable from the nav');
    expect(r.offending[0]!.errors[0]!.phase).toBe('views');
  });

  it('routes a per-artifact view fault to the artifact the message names, with the right kind', async () => {
    // ORDER MATTERS in `kindOf`: the shell path and the component prefix must be tested before the
    // generic view fallback, or a component would be handed to the fixer as a view — and the fix
    // fork would reach for `writeProjectView` on a component definition.
    const r = await run(
      ctxFor(CLEAN, undefined, {
        validate: viewResult([
          { code: 'bad-field', path: 'sections[1].item', message: 'metaFormat is not a property', severity: 'error', file: 'views/index.view.json' },
          { code: 'bad-el', path: 'node.children[1].el', message: '"chip" is not an element', severity: 'error', file: 'components/CostRow.view.json' },
        ]),
      }),
      {},
    );
    const byPath = Object.fromEntries(r.offending.map((o) => [o.path, o.kind]));
    expect(byPath['views/index.view.json']).toBe('view');
    expect(byPath['components/CostRow.view.json']).toBe('viewComponent');
    // The instance PATH rides along with the message — it is the whole reason the fixer can edit
    // one field instead of rewriting the artifact.
    expect(findingsFor(r, 'views/index.view.json')).toContain('sections[1].item:');
  });

  it('REPORTS a warning but never ROUTES it — fix fans out over offending and would "repair" it', async () => {
    const r = await run(
      ctxFor(CLEAN, undefined, {
        validate: viewResult([
          { code: 'dead-component', path: 'components', message: 'CostRow is declared but nothing uses it', severity: 'warning', file: 'components/CostRow.view.json' },
        ]),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('treats an UN-RUN view gate as a finding, not as clean', async () => {
    // The failure this exists for is silent: a gate that did not execute contributes no findings,
    // which every downstream reader takes for "clean". `checked: 0` with `ok: true` is exactly that
    // shape, and so is a ctx that never got the global wired at all.
    const zero = await run(ctxFor(CLEAN, undefined, { validate: viewResult([], 0) }), {});
    expect(zero.ok).toBe(false);
    expect(zero.viewsValidated).toBe(false);
    expect(findingsFor(zero, 'shell.view.json')).toContain('examined 0 artifacts');

    const missing = await run(ctxFor(CLEAN, undefined, { validate: undefined }), {});
    expect(missing.ok).toBe(false);
    expect(missing.viewsValidated).toBe(false);
    expect(missing.unavailable).toContain('validateAppViews');
    // And it must name the exact wiring that is absent — this message is the only thing that ever
    // gets the global threaded through `ProjectAuthoringGlobals`.
    expect(findingsFor(missing, 'shell.view.json')).toContain('libs/cli/src/app/authoring/globals.ts');
  });

  // ── (3) THE RENDER SMOKE — the failure only a MOUNT can see ───────────────────────────────────

  it('routes an ALWAYS-NULL binding to the ENDPOINT that fails to compute it, never to the view', async () => {
    // The single most important routing decision in this node. The symptom is on the page (a column
    // of blanks) and the instinct is to hand the page to the fixer — which gets the binding deleted,
    // i.e. the feature deleted, and the gate then goes quiet. `endpoint` on the ViewError is the
    // override that says "the defect is in the handler", and it must beat `file`.
    const r = await run(
      ctxFor(CLEAN, undefined, {
        smoke: smokeResult([
          {
            code: 'always-null',
            path: 'sections[0].item.caption',
            message: '$.paid_by_name was null on every row',
            severity: 'error',
            file: 'views/index.view.json',
            endpoint: 'costs-list',
          },
        ]),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.offending.map((o) => o.path)).toEqual(['api/costs-list/GET.ts']);
    expect(r.offending[0]!.kind).toBe('api');
    expect(r.offending[0]!.errors[0]!.phase).toBe('render-smoke');
    expect(findingsFor(r, 'api/costs-list/GET.ts')).toContain('paid_by_name');
  });

  it('says so when the named endpoint has no module at all, rather than silently dropping it', async () => {
    const r = await run(
      ctxFor(CLEAN, undefined, {
        smoke: smokeResult([
          { code: 'always-null', path: 'sections[0]', message: '$.total was null on every row', severity: 'error', endpoint: 'costs-summary' },
        ]),
      }),
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.offending.map((o) => o.path)).toEqual(['api']);
    expect(findingsFor(r, 'api')).toContain('no api module exports the name "costs-summary"');
    expect(findingsFor(r, 'api')).toContain('the endpoint was never written');
  });

  it('treats an UNAVAILABLE render smoke as a finding — a page that shows nothing would ship clean', async () => {
    const unavailable = await run(
      ctxFor(CLEAN, undefined, { smoke: { ...smokeResult([]), unavailable: true, reason: 'ctx has no callProjectApi' } }),
      {},
    );
    expect(unavailable.ok).toBe(false);
    expect(unavailable.renderSmoked).toBe(false);
    expect(unavailable.unavailable).toContain('renderSmokeViews');
    expect(findingsFor(unavailable, 'shell.view.json')).toContain('ctx has no callProjectApi');

    const missing = await run(ctxFor(CLEAN, undefined, { smoke: undefined }), {});
    expect(missing.ok).toBe(false);
    expect(missing.renderSmoked).toBe(false);
    expect(missing.unavailable).toContain('renderSmokeViews');
    expect(findingsFor(missing, 'shell.view.json')).toContain('every binding contract-valid and every value null');
  });

  // ── FOLDED-IN RUNTIME PROBES ─────────────────────────────────────────────────────────────────

  it('FOLDS IN smoke_endpoints findings — fix fans out over verify.offending and nothing else', async () => {
    // `verify` depends on `smoke_endpoints` but originally never READ it, so every runtime fault the
    // only node that actually calls an endpoint could find was computed and discarded. Worse than not
    // probing: the pipeline reports a gate that ran and found nothing.
    const r = await run(ctxFor(CLEAN), {
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

  it('FOLDS IN check_acceptance code faults — a valid shape carrying meaningless numbers', async () => {
    const r = await run(ctxFor(CLEAN), {
      check_acceptance: {
        ok: false,
        offending: [
          {
            path: 'api/costs-list/GET.ts',
            kind: 'api',
            errors: [{ phase: 'acceptance', message: 'total was 0 over 96 seeded rows' }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'api/costs-list/GET.ts')).toContain('96 seeded rows');
  });

  it('surfaces an UNAVAILABLE probe rather than letting it read as clean', async () => {
    for (const node of ['smoke_endpoints', 'check_acceptance']) {
      const r = await run(ctxFor(CLEAN), {
        [node]: { ok: false, unavailable: true, reason: 'ctx has no callProjectApi', offending: [] },
      });
      expect(r.ok, `${node} unavailable must fail the gate`).toBe(false);
      expect(r.unavailable).toContain(node);
      expect(JSON.stringify(r.offending)).toContain('did not run');
    }
  });

  it('is unaffected when smoke_endpoints reports clean', async () => {
    const r = await run(ctxFor(CLEAN), { smoke_endpoints: { ok: true, offending: [], offendingCount: 0 } });
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // ── THE ONE SURVIVING MECHANICAL SCAN: a table that does not exist ────────────────────────────

  it('flags an api module querying a table that does not exist', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/costs-list/GET.ts': `export const name = 'costs-list';
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('expenses') }; }
`,
      }),
      {},
    );
    expect(r.ok).toBe(false);
    const msg = findingsFor(r, 'api/costs-list/GET.ts');
    expect(msg).toContain('expenses');
    expect(msg).toContain('costs'); // names the tables that DO exist — the fixer's whole input
    // And it names the runtime consequence, which is what makes it worth a build failure: the file
    // compiles, 500s on every call, and the section that reads it renders permanently empty.
    expect(msg).toContain('builds clean but 500s at runtime');
    expect(msg).toContain('renders permanently empty');
    expect(r.offending.find((o) => o.path === 'api/costs-list/GET.ts')?.kind).toBe('api');
  });

  it('never throws on a finding — a code node has no salvage path', async () => {
    // A throw would fail the whole node and abort the tasklist instead of routing the faults to
    // `fix`. Every fault must come back as DATA.
    const r = await run(ctxFor({}, { ok: false, errors: [{ phase: 'typecheck', file: 'api/x/GET.ts', message: 'boom' }] }), {});
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.offending)).toBe(true);
  });

  // ── HOOK (automation) scans — a hook loads clean and then its handler 500s or never fires ──────
  const CRON_BAD = `export default { type: 'cron', every: '7d', handler: async ({ db }) => {
  const rows = await db.query('shopping_list');
  return rows.length;
} };
`;
  const CRON_GOOD = `export default { type: 'cron', every: '7d', handler: async ({ db }) => {
  const rows = await db.query('costs');
  return rows.length;
} };
`;
  const EVENT_BAD = `export default { type: 'event', on: { event: 'project/db.reminders.insert' }, handler: async () => {} };
`;

  it('flags a hook whose handler queries a table that does not exist — routed as kind "hook"', async () => {
    const r = await run(ctxFor({ ...CLEAN, 'hooks/weekly-list.ts': CRON_BAD }), {});
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'hooks/weekly-list.ts')).toContain('shopping_list');
    // Must be marked 'hook' so the per-file `fix` fork uses writeProjectHook, not writeProjectView.
    expect(r.offending.find((o) => o.path === 'hooks/weekly-list.ts')?.kind).toBe('hook');
  });

  it('flags an event hook subscribing to project/db.<missingTable>.* — that write is never emitted', async () => {
    const r = await run(ctxFor({ ...CLEAN, 'hooks/on-reminder.ts': EVENT_BAD }), {});
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'hooks/on-reminder.ts')).toContain('reminders');
    expect(findingsFor(r, 'hooks/on-reminder.ts')).toContain('never fires');
  });

  it('LOAD-BEARING: the hook scan runs through an ASYNC ctx (the real worker shape)', async () => {
    // Same silent-nothing trap as every other scan: a sync `ctx.listProjectDir(...).entries` off a
    // Promise is undefined, so the walk finds no hooks and the automation ships broken behind a clean gate.
    const r = await run(asyncCtxFor({ ...CLEAN, 'hooks/weekly-list.ts': CRON_BAD }), {});
    expect(r.ok).toBe(false);
    expect(findingsFor(r, 'hooks/weekly-list.ts')).toContain('shopping_list');
  });

  it('is clean when a hook only touches real tables and a real db address', async () => {
    const r = await run(
      asyncCtxFor({
        ...CLEAN,
        'hooks/weekly-list.ts': CRON_GOOD,
        'hooks/on-cost.ts': `export default { type: 'event', on: { event: 'project/db.costs.insert' }, handler: async () => {} };\n`,
      }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('does NOT scan a spec for anything — a view spec has no imports, no JSX and no class names', async () => {
    // The regression guard for the merge. A spec is JSON; carrying the TSX scans over would mean
    // inventing findings on text that cannot express the fault. `$.` bindings, an element named
    // `text`, a `chat` section naming an agent — none of these is a dangling endpoint reference,
    // and none may be reported as one.
    const r = await run(
      ctxFor({
        ...CLEAN,
        'views/index.view.json': JSON.stringify({
          route: 'index',
          sections: [
            { kind: 'list', id: 'costs', query: 'costs-list', item: { title: '$.label', caption: '$.paid_by_name' } },
            { kind: 'chat', id: 'dock', agent: 'thing' },
          ],
        }),
        'components/CostRow.view.json': JSON.stringify({
          name: 'CostRow',
          node: { el: 'row', children: [{ el: 'text', text: '$props.cost.label' }] },
        }),
      }),
      {},
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
