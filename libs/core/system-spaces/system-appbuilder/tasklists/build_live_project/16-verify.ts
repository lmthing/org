/**
 * The build gate — HOST-RUN, so it always executes.
 *
 * Three ground truths are merged here, and NONE of them is a model self-assessment:
 *
 *  1. **`buildProjectApp()`** — the real project-app typecheck then the esbuild bundle, over the
 *     generated page wrappers (`writeProjectView` persists `pages/<route>.view.json` AND host-writes
 *     the trivial `pages/<route>.tsx` that renders it), the api handlers and the hooks.
 *  2. **`validateAppViews()`** — the WHOLE-APP static checks a per-artifact save cannot make: an
 *     orphan route no nav reaches, a nav target that is not a route, a declared component nothing
 *     uses, a `reveals`/`rowAction`/`prefill` target that resolves nowhere app-wide, a page with no
 *     data-bound section.
 *  3. **`renderSmokeViews()`** — the view twin of `smoke_endpoints`: every view spec MOUNTED against
 *     the app's LIVE endpoint responses over the seeded rows, reporting render errors, binding
 *     coverage, and empty-render detection.
 *
 * (3) is the one that catches what nothing else can. A spec whose every name resolves and whose every
 * binding is contract-valid still ships a blank page when the endpoint's computed field is not
 * actually computed — the "structurally-valid zeros" failure, which passes the writer, passes
 * `validateAppViews`, passes typecheck and passes the bundle. **An always-null binding is therefore
 * an ENDPOINT defect, not a view defect**, and this node routes it to the handler's file so `fix`
 * repairs the thing that is actually wrong. Pointing that at the view instead teaches the fixer to
 * delete the binding — i.e. to delete the feature — which is how a gate makes an app worse.
 *
 * There is deliberately no TSX scanning here. The appbuilder's copy of this node scans for dangling
 * imports, `{ type, props }` descriptors leaking into JSX and surface-token-as-text, because its
 * pages are freshly authored TSX. A spec has no imports, no JSX and no class names — those whole
 * fault classes do not exist in this builder, and carrying the scans would only invent work.
 *
 * It reports; it never fixes, and it never throws on a finding (a code node has no salvage path — a
 * throw fails the whole node). `fix` fans out over `offending`, then resumes this node via its
 * `onFail`, so the verify→fix cycle loops until clean.
 */

export const node = {
  id: 'verify',
  dependsOn: [
    'implement_tables',
    'implement_endpoints',
    'smoke_endpoints',
    'check_acceptance',
    'implement_view_components',
    'implement_views',
    'implement_shell',
    'implement_automations',
  ],
  output: {
    ok: 'boolean',
    built: 'boolean',
    routes: 'array',
    offending: 'array',
    offendingCount: 'number',
    viewsValidated: 'boolean',
    renderSmoked: 'boolean',
    unavailable: 'array',
  },
};

type Await<T> = T | Promise<T>;

/**
 * EVERY member here must be `await`ed, including the ones that look synchronous.
 *
 * `worker-load-entry.ts` proxies each authoring global into the worker as an RPC stub returning a
 * PROMISE, so `ctx.listProjectDir(dir).entries` reads a property off a Promise — `undefined` — and
 * `walkFiles` silently returns `[]`. The node still resolves, still reports the compiler errors, and
 * contributes ZERO findings, which the pipeline reads as "the checks were clean". That is exactly the
 * silent-and-load-bearing failure this gate exists to end.
 */
interface Ctx {
  buildProjectApp: () => Promise<{
    ok: boolean;
    built: boolean;
    routes: string[];
    errors: Array<{ phase: string; file: string; line?: number; column?: number; message: string }>;
  }>;
  listProjectDir: (dir: string) => Await<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Await<{ ok: boolean; content: string; error?: string }>;
  /**
   * App-wide view validation — `libs/cli/src/app/view-spec/validate.ts#validateAppViews`, bound to
   * this project's root by the code-node ctx factory (exactly as `buildProjectApp` is).
   *
   * ZERO-ARG on purpose: a code node is transpiled standalone and evaluated in a worker, so it
   * cannot import `validate.ts` and cannot construct the `ContractsLike` the underlying function
   * optionally takes. Both underlying functions accept `{ contracts }` to skip a second full
   * `ts-json-schema-generator` pass over every handler; threading one call's contracts into the
   * next is therefore the HOST's job, at the single place that owns both bindings
   * (`libs/cli/src/app/authoring/globals.ts` — the `validateAppViews`/`renderSmokeViews` entries of
   * `createProjectAuthoringGlobals`). Nothing about it is expressible from here.
   */
  validateAppViews?: () => Await<ViewValidationResult>;
  /**
   * Headless render smoke over the live endpoint responses —
   * `libs/cli/src/app/view-spec/validate.ts#renderSmokeViews`, bound the same way (and supplied
   * with `callProjectApi`, without which it reports `unavailable` rather than a clean run).
   */
  renderSmokeViews?: () => Await<RenderSmokeResult>;
}

/**
 * One finding — `libs/cli/src/app/view-spec/messages.ts#ViewError`.
 *
 * `file` is the project-relative artifact the finding belongs to. **`endpoint` overrides it**: it is
 * set by `renderSmokeViews` for an always-null binding, where the view named a field the contract
 * declares and the defect is that the ENDPOINT never computes it.
 */
interface ViewError {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  endpoint?: string;
}
/** `libs/cli/src/app/view-spec/messages.ts#ViewValidationResult`. */
interface ViewValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  /** How many artifacts were examined. `0` with `ok:true` means NOTHING RAN, not "clean". */
  checked: number;
  errors: ViewError[];
}
/** `libs/cli/src/app/view-spec/validate.ts#RenderSmokeResult`. */
interface RenderSmokeResult extends ViewValidationResult {
  unavailable: boolean;
  reason?: string;
  rendererMounted: boolean;
}

/** `libs/cli/src/app/view-spec/files.ts#SHELL_SPEC_PATH` — `_`-prefixed, so never a route. */
const SHELL_SPEC_PATH = 'pages/_shell.view.json';
/** `libs/cli/src/app/view-spec/files.ts#VIEW_COMPONENT_DIR`, under `pages/`. */
const VIEW_COMPONENT_PREFIX = 'pages/components/';

interface Finding {
  line?: number;
  phase: string;
  message: string;
}

/** Every `.ts`/`.tsx`/`.json` file under `dir`, walked breadth-first. */
async function walkFiles(ctx: Ctx, dir: string): Promise<string[]> {
  const out: string[] = [];
  const listed = await ctx.listProjectDir(dir);
  const queue = (listed?.entries || []).map((n) => `${dir}/${n}`);
  while (queue.length > 0) {
    const p = queue.shift() as string;
    if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.json')) {
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

/** Endpoint NAME → the api module file that exports it. This is what lets an always-null binding be
 *  routed to the handler that fails to compute the field, instead of to the page that reads it. */
async function endpointFiles(ctx: Ctx): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const path of await walkFiles(ctx, 'api')) {
    if (!path.endsWith('.ts')) continue;
    const src = await read(ctx, path);
    const m = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/.exec(src);
    if (m) found.set(m[1] as string, path);
  }
  return found;
}

/** Table names on disk (`database/<name>.json`). */
async function realTables(ctx: Ctx): Promise<string[]> {
  const listed = await ctx.listProjectDir('database');
  return (listed?.entries || [])
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.replace(/\.json$/, ''));
}

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const build = await ctx.buildProjectApp();
  const byFile: Record<string, Finding[]> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };
  const unavailable: string[] = [];

  // FOLD IN the runtime probes. `smoke_endpoints` is the only node that actually CALLS a generated
  // endpoint, and its findings must land in `offending` because `fix` fans out over
  // `verify.offending` and nothing else.
  const smoke = inputs['smoke_endpoints'] as
    | { offending?: Array<{ path?: string; errors?: Finding[] }>; unavailable?: boolean; reason?: string }
    | undefined;
  if (smoke?.unavailable) {
    unavailable.push('smoke_endpoints');
    add('api', { phase: 'smoke', message: `endpoint smoke probes did not run: ${smoke.reason ?? 'unavailable'}` });
  }
  for (const entry of smoke?.offending ?? []) {
    for (const e of entry.errors ?? []) add(String(entry.path ?? 'api'), e);
  }

  // FOLD IN the acceptance gate the same way. Its `offending` is ONLY the code faults; the extraction
  // gaps it found go to `finalize` as `dataGaps`, never to `fix`.
  const acceptance = inputs['check_acceptance'] as
    | { offending?: Array<{ path?: string; errors?: Finding[] }>; unavailable?: boolean; reason?: string }
    | undefined;
  if (acceptance?.unavailable) {
    unavailable.push('check_acceptance');
    add('api', { phase: 'acceptance', message: `acceptance checks did not run: ${acceptance.reason ?? 'unavailable'}` });
  }
  for (const entry of acceptance?.offending ?? []) {
    for (const e of entry.errors ?? []) add(String(entry.path ?? 'api'), e);
  }

  for (const e of build.errors) {
    add(e.file, { line: e.line, phase: e.phase, message: e.message });
  }

  const apiFiles = await endpointFiles(ctx);
  const tables = await realTables(ctx);

  /**
   * Route ONE view-check error to the file the FIX belongs in.
   *
   * The subtlety this function exists for: `endpoint` set (or `cause: 'endpoint'`) means the defect
   * is in the HANDLER even though the symptom was seen on a page — an always-null binding is a
   * computed field that is not computed. Sending it to the view would get the binding deleted.
   */
  const routeViewError = (e: ViewError, phase: string): void => {
    // WARNINGS are reported, never routed: `fix` fans out over `offending`, so sending it a dead
    // component would have the model "repair" something the gate itself does not consider broken.
    if (e.severity !== 'error') return;
    const message = e.path ? `${e.path}: ${e.message}` : e.message;
    const endpointName = String(e.endpoint ?? '');
    if (endpointName) {
      const file = apiFiles.get(endpointName);
      add(file ?? 'api', {
        phase,
        message: file
          ? message
          : `${message} (no api module exports the name "${endpointName}" — the endpoint was never written)`,
      });
      return;
    }
    // `file` is already project-relative (`pages/index.view.json`,
    // `pages/components/RecipeCard.view.json`). App-wide findings carry none — the shell is the
    // only artifact that owns the app as a whole, so an orphan-route / bad-nav-target lands there.
    add(e.file || SHELL_SPEC_PATH, { phase, message });
  };

  // (A) WHOLE-APP view validation.
  let viewsValidated = false;
  if (typeof ctx.validateAppViews === 'function') {
    const res = await ctx.validateAppViews();
    // `checked: 0` with `ok: true` means NOTHING was examined — the exact reading that makes an
    // un-run gate indistinguishable from a clean one.
    viewsValidated = (res?.checked ?? 0) > 0;
    for (const e of res?.errors ?? []) routeViewError(e, 'views');
    if (!viewsValidated) {
      add(SHELL_SPEC_PATH, {
        phase: 'views',
        message: 'app-wide view validation examined 0 artifacts — nothing was checked, which is not the same as clean',
      });
    }
  } else {
    unavailable.push('validateAppViews');
    add(SHELL_SPEC_PATH, {
      phase: 'views',
      message:
        'app-wide view validation did not run: the code-node ctx has no `validateAppViews`. Thread it ' +
        'through `ProjectAuthoringGlobals` (libs/cli/src/app/authoring/globals.ts, alongside ' +
        '`buildProjectApp`) so `createCodeNodeCtxFactory` passes it in `authoring`. Until then an ' +
        'orphan route, a dangling nav target and a dead component all ship unnoticed.',
    });
  }

  // (B) RENDER SMOKE — mount every view against the live endpoint responses over the seeded rows.
  let renderSmoked = false;
  if (typeof ctx.renderSmokeViews === 'function') {
    const res = await ctx.renderSmokeViews();
    renderSmoked = res?.unavailable !== true;
    for (const e of res?.errors ?? []) routeViewError(e, 'render-smoke');
    if (!renderSmoked) {
      unavailable.push('renderSmokeViews');
      add(SHELL_SPEC_PATH, {
        phase: 'render-smoke',
        message: `view render smoke did not run: ${res?.reason ?? 'unavailable'}`,
      });
    }
  } else {
    unavailable.push('renderSmokeViews');
    add(SHELL_SPEC_PATH, {
      phase: 'render-smoke',
      message:
        'view render smoke did not run: the code-node ctx has no `renderSmokeViews`. Thread it through ' +
        '`ProjectAuthoringGlobals` alongside `buildProjectApp`. Until then a page that renders but ' +
        'shows nothing — every binding contract-valid and every value null — passes every gate.',
    });
  }

  // The ONE mechanical scan a spec app still needs: a handler (or a hook) querying a table that does
  // not exist. The db surface is dynamically typed, so it builds CLEAN and 500s on every call — and
  // that 500 is what a view renders as a permanently empty section.
  for (const path of [...(await walkFiles(ctx, 'api')), ...(await walkFiles(ctx, 'hooks'))]) {
    if (!path.endsWith('.ts')) continue;
    const src = await read(ctx, path);
    const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
    for (let m = ref.exec(src); m; m = ref.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message:
          `references table "${m[1]}" which does not exist in database/ (have: ${tables.join(', ') || 'none'}) ` +
          `— builds clean but 500s at runtime, and the section that reads it renders permanently empty`,
      });
    }
    const evt = /['"`]project\/db\.([A-Za-z0-9_]+)\.(?:insert|update|remove)['"`]/g;
    for (let m = evt.exec(src); m; m = evt.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message:
          `hook subscribes to project/db.${m[1]}.* but table "${m[1]}" does not exist in database/ ` +
          `(have: ${tables.join(', ') || 'none'}) — that write is never emitted, so the automation never fires.`,
      });
    }
  }

  // ORDER MATTERS: the component dir and the shell both live UNDER `pages/`, so the generic page
  // branch has to come last or every component would be handed to the fixer as a view.
  const kindOf = (path: string): string => {
    if (path === SHELL_SPEC_PATH) return 'shell';
    if (path.startsWith(VIEW_COMPONENT_PREFIX)) return 'viewComponent';
    if (path.startsWith('api/')) return 'api';
    if (path.startsWith('hooks/')) return 'hook';
    return 'view';
  };

  const offending = Object.keys(byFile).map((path) => ({
    path,
    kind: kindOf(path),
    errors: byFile[path],
  }));

  return {
    ok: build.ok && offending.length === 0,
    built: build.built,
    routes: build.routes,
    offending,
    offendingCount: offending.length,
    viewsValidated,
    renderSmoked,
    unavailable,
  };
}
