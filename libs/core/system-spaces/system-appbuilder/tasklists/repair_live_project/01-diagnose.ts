/**
 * The repair gate — HOST-RUN, computes everything FRESH from the live project's own disk/build state.
 * This is deliberately a close relative of `build_live_project/16-verify.ts` (same three ground
 * truths: `buildProjectApp()`, `validateAppViews()`, `renderSmokeViews()`, plus the "references a
 * table that does not exist" scan) — duplicated rather than imported because a code node is
 * transpiled standalone and evaluated in a worker, so a relative import would not resolve at require
 * time (see `13a-check_acceptance.ts`'s own comment on this).
 *
 * The one thing this node adds that `verify` does not: **a finding on an artifact that was never
 * written at all** (an endpoint a page calls that has no `api/` module, a page the shell's nav points
 * at that has no `views/<route>.view.json`) is NOT the same repair as an existing-but-wrong artifact.
 * `verify` bundles both into `offending` and hands them to `fix`, whose whole prompt assumes
 * `readProjectFile(item.path)` returns real content to EDIT — pointed at nothing, it edits an empty
 * string, which is why a genuinely absent artifact needs AUTHORING (`03-author_missing.md`), not
 * fixing (`02-fix_broken.md`). This node keeps the two apart from the start: `offending` only ever
 * names a REAL file; `toAuthor` names something referenced but not on disk.
 *
 * The caller's own `missing`/`errors` (straight from a `build_live_project`/`repair_live_project`
 * envelope) are MERGED IN, never trusted blind — the live project may have moved since that envelope
 * was produced, so this node's own fresh scan is the authority and the caller's lists only ADD
 * findings a fresh scan cannot mechanically rediscover (chiefly: a PLANNED page that failed to write
 * and left no trace for `validateAppViews` to catch, since there is no nav entry and no file for it).
 */

export const node = {
  id: 'diagnose',
  dependsOn: [],
  output: {
    ok: 'boolean',
    offending: 'array',
    offendingCount: 'number',
    toAuthor: 'array',
    toAuthorCount: 'number',
  },
};

type Await<T> = T | Promise<T>;

interface Ctx {
  buildProjectApp: () => Promise<{
    ok: boolean;
    built: boolean;
    routes: string[];
    errors: Array<{ phase: string; file: string; line?: number; column?: number; message: string }>;
  }>;
  listProjectDir: (dir: string) => Await<{ ok: boolean; entries: string[]; error?: string }>;
  readProjectFile: (path: string) => Await<{ ok: boolean; content: string; error?: string }>;
  validateAppViews?: () => Await<ViewValidationResult>;
  renderSmokeViews?: () => Await<RenderSmokeResult>;
}

interface ViewError {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  endpoint?: string;
}
interface ViewValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  checked: number;
  errors: ViewError[];
}
interface RenderSmokeResult extends ViewValidationResult {
  unavailable: boolean;
  reason?: string;
  rendererMounted: boolean;
}

interface Finding {
  line?: number;
  phase: string;
  message: string;
}

/** One thing referenced but not on disk — the AUTHOR list. */
interface ToAuthor {
  kind: 'endpoint' | 'page' | 'table' | 'automation';
  name: string;
  hint: string;
}

const SHELL_SPEC_PATH = 'shell.view.json';
const VIEW_COMPONENT_PREFIX = 'components/';

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

async function realTables(ctx: Ctx): Promise<string[]> {
  const listed = await ctx.listProjectDir('database');
  return (listed?.entries || [])
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.replace(/\.json$/, ''));
}

async function realPages(ctx: Ctx): Promise<Set<string>> {
  const listed = await ctx.listProjectDir('views');
  return new Set(
    (listed?.entries || [])
      .filter((n) => n.endsWith('.view.json') && !n.startsWith('_'))
      .map((n) => n.replace(/\.view\.json$/, '')),
  );
}

export async function run(ctx: Ctx, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const build = await ctx.buildProjectApp();
  const byFile: Record<string, Finding[]> = {};
  const add = (file: string, f: Finding): void => {
    const list = byFile[file] || [];
    list.push(f);
    byFile[file] = list;
  };
  const toAuthor: ToAuthor[] = [];
  const authored = new Set<string>(); // de-dupe: same endpoint/page named by several findings

  const addToAuthor = (t: ToAuthor): void => {
    const key = `${t.kind}:${t.name}`;
    if (authored.has(key)) return;
    authored.add(key);
    toAuthor.push(t);
  };

  for (const e of build.errors) {
    add(e.file, { line: e.line, phase: e.phase, message: e.message });
  }

  const apiFiles = await endpointFiles(ctx);
  const tables = await realTables(ctx);
  const pages = await realPages(ctx);

  /** Route ONE view-check error to `offending` (a real file to edit) or `toAuthor` (nothing to edit). */
  const routeViewError = (e: ViewError, phase: string): void => {
    if (e.severity !== 'error') return;
    const message = e.path ? `${e.path}: ${e.message}` : e.message;
    const endpointName = String(e.endpoint ?? '');
    if (endpointName) {
      const file = apiFiles.get(endpointName);
      if (file) {
        add(file, { phase, message });
      } else {
        addToAuthor({ kind: 'endpoint', name: endpointName, hint: message });
      }
      return;
    }
    add(e.file || SHELL_SPEC_PATH, { phase, message });
  };

  let viewsValidated = false;
  if (typeof ctx.validateAppViews === 'function') {
    const res = await ctx.validateAppViews();
    viewsValidated = (res?.checked ?? 0) > 0;
    for (const e of res?.errors ?? []) routeViewError(e, 'views');
  }

  if (typeof ctx.renderSmokeViews === 'function') {
    const res = await ctx.renderSmokeViews();
    for (const e of res?.errors ?? []) routeViewError(e, 'render-smoke');
  }

  // The one mechanical scan build_live_project's verify also runs: a handler or hook querying a
  // table that does not exist — builds clean, 500s at runtime.
  for (const path of [...(await walkFiles(ctx, 'api')), ...(await walkFiles(ctx, 'hooks'))]) {
    if (!path.endsWith('.ts')) continue;
    const src = await read(ctx, path);
    const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
    for (let m = ref.exec(src); m; m = ref.exec(src)) {
      if (tables.includes(m[1] as string)) continue;
      add(path, {
        phase: 'gate',
        message: `references table "${m[1]}" which does not exist in database/ (have: ${tables.join(', ') || 'none'})`,
      });
    }
  }

  // Merge in the CALLER's own residual lists (a build_live_project/repair_live_project envelope) —
  // additive only. A `kind:'page'` entry names a page that failed to write and so left no nav entry
  // and no file for a fresh scan to catch on its own.
  const suppliedMissing = Array.isArray(inputs['missing']) ? (inputs['missing'] as Array<Record<string, unknown>>) : [];
  for (const m of suppliedMissing) {
    const kind = String(m['kind'] ?? '');
    if (kind === 'page') {
      const route = String(m['route'] ?? '');
      if (route && !pages.has(route)) {
        addToAuthor({ kind: 'page', name: route, hint: String(m['error'] ?? 'planned page failed to write') });
      }
    } else if (kind === 'table') {
      const name = String(m['name'] ?? '');
      if (name && !tables.includes(name)) {
        addToAuthor({ kind: 'table', name, hint: String(m['error'] ?? 'planned table failed to write') });
      }
    } else if (kind === 'automation') {
      addToAuthor({ kind: 'automation', name: String(m['slug'] ?? ''), hint: String(m['error'] ?? 'planned automation failed to write') });
    }
    // kind 'data' / 'unproven' are neither an edit nor an author job — see automator/instruct.md's
    // `db.insert(table, row)` guidance for seeding; this tasklist does not touch them.
  }
  const suppliedErrors = Array.isArray(inputs['errors']) ? (inputs['errors'] as Array<Record<string, unknown>>) : [];
  for (const e of suppliedErrors) {
    const file = String(e['file'] ?? '');
    if (file && file !== 'gate' && file !== 'api') {
      add(file, { phase: String(e['phase'] ?? 'prior'), message: String(e['message'] ?? '') });
    }
  }

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
    ok: build.ok && offending.length === 0 && toAuthor.length === 0,
    offending,
    offendingCount: offending.length,
    toAuthor,
    toAuthorCount: toAuthor.length,
  };
}
