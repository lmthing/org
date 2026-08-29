import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';
import { resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYS = join(__dirname, '..', '..', 'system-spaces');
const REPAIR_DIR = join(SYS, 'system-appbuilder', 'tasklists', 'repair_live_project');

/**
 * `repair_live_project` — the fix for a live incident, not a hypothetical: THING re-delegated the
 * ENTIRE `build_live_project` pipeline twice in one live run (read_sources, every planner, every
 * implement step) to patch a bad field reference, seed placeholder data, and recover from a page
 * that failed only because an endpoint it needed never landed. This tasklist is the alternative:
 * diagnose fresh from the live app's own disk/build state (the SAME three ground truths
 * `build_live_project/16-verify.ts` uses — `buildProjectApp`, `validateAppViews`,
 * `renderSmokeViews`), then fix what's broken or author what's missing, without touching anything
 * else. See `01-diagnose.ts`'s own header comment for why "broken" and "missing" cannot be the same
 * repair: `17-fix.md`'s whole prompt assumes `readProjectFile(item.path)` returns real content to
 * EDIT — pointed at nothing, it edits an empty string.
 */

type ToAuthor = { kind: string; name: string; hint: string };
type Offending = { path: string; kind: string; errors: Array<{ line?: number; phase: string; message: string }> };
type DiagnoseResult = {
  ok: boolean;
  offending: Offending[];
  offendingCount: number;
  toAuthor: ToAuthor[];
  toAuthorCount: number;
};

let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<DiagnoseResult>;
beforeAll(async () => {
  const mod = (await import(
    new URL(
      '../../system-spaces/system-appbuilder/tasklists/repair_live_project/01-diagnose.ts',
      import.meta.url,
    ).href
  )) as { run: typeof run };
  run = mod.run;
});

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
  warningCount: 0,
  checked,
  errors,
});
const smokeResult = (errors: ViewError[]) => ({ ...viewResult(errors), unavailable: false, rendererMounted: true });

/** Same shape as `build-live-project-gate.test.ts`'s `ctxFor` — a flat `path -> contents` project. */
function ctxFor(files: Record<string, string>, build?: Record<string, unknown>, views?: { validate?: unknown; smoke?: unknown }) {
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

/** The ctx the node ACTUALLY gets in production: every authoring global proxied as an async RPC stub. */
function asyncCtxFor(files: Record<string, string>, build?: Record<string, unknown>, views?: { validate?: unknown; smoke?: unknown }) {
  const sync = ctxFor(files, build, views) as Record<string, (...a: never[]) => unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(sync)) out[k] = async (...a: never[]) => fn(...a);
  return out;
}

const LIST_ENDPOINT = `export const name = 'students-list';
export interface Output { items: any[] }
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('students') }; }
`;
const CLEAN = {
  'database/students.json': '{}',
  'api/students-list/GET.ts': LIST_ENDPOINT,
  'views/index.view.json': '{"route":"index","sections":[]}',
  'shell.view.json': '{"nav":[]}',
};

describe('repair_live_project — diagnose (01-diagnose.ts)', () => {
  it('reports a clean project as ok with nothing to fix or author', async () => {
    const r = await run(ctxFor(CLEAN), {});
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.toAuthor).toEqual([]);
  });

  it('LOAD-BEARING: the scans still run when ctx is ASYNC — the real worker shape', async () => {
    const r = await run(asyncCtxFor(CLEAN), {});
    expect(r.ok).toBe(true);
  });

  it('routes an existing artifact\'s error to offending, not toAuthor', async () => {
    const r = await run(
      ctxFor(CLEAN, {
        ok: false,
        errors: [{ phase: 'typecheck', file: 'api/students-list/GET.ts', message: 'boom' }],
      }),
      {},
    );
    expect(r.offending).toEqual([{ path: 'api/students-list/GET.ts', kind: 'api', errors: [{ phase: 'typecheck', message: 'boom', line: undefined }] }]);
    expect(r.toAuthor).toEqual([]);
  });

  it('routes an endpoint referenced but never written to toAuthor, not offending — the live incident', async () => {
    // No `api/sessions-list/GET.ts` on disk — the view-check error names an endpoint that does not exist.
    const r = await run(
      ctxFor(CLEAN, {}, {
        smoke: smokeResult([
          { code: 'X', path: 'index', message: 'no api module exports the name "sessions-list"', severity: 'error', endpoint: 'sessions-list' },
        ]),
      }),
      {},
    );
    expect(r.toAuthor).toEqual([{ kind: 'endpoint', name: 'sessions-list', hint: expect.stringContaining('sessions-list') }]);
    expect(r.offending).toEqual([]);
  });

  it('merges a caller-supplied `missing` page entry (a planned page that failed to write) into toAuthor', async () => {
    const r = await run(ctxFor(CLEAN), {
      missing: [{ kind: 'page', route: 'sessions', error: 'sessions-list is not an endpoint' }],
    });
    expect(r.toAuthor).toEqual([{ kind: 'page', name: 'sessions', hint: 'sessions-list is not an endpoint' }]);
  });

  it('does NOT re-add a caller-supplied missing page that already exists on disk (live has moved on)', async () => {
    const r = await run(ctxFor(CLEAN), {
      missing: [{ kind: 'page', route: 'index', error: 'stale — this landed since' }],
    });
    expect(r.toAuthor).toEqual([]);
  });

  it('ignores caller-supplied data/unproven entries — neither an edit nor an author job', async () => {
    const r = await run(ctxFor(CLEAN), {
      missing: [{ kind: 'data', detail: 'backing data is short' }, { kind: 'unproven', detail: 'could not evaluate' }],
    });
    expect(r.toAuthor).toEqual([]);
    expect(r.offending).toEqual([]);
  });

  it('flags a handler referencing a table that does not exist', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/students-list/GET.ts': `export const name='students-list';\nexport default async function h(i:any,ctx:any){return {items: await ctx.db.query('ghost_table')};}`,
      }),
      {},
    );
    expect(r.offending[0]?.path).toBe('api/students-list/GET.ts');
    expect(r.offending[0]?.errors[0]?.message).toContain('ghost_table');
  });
});

describe('repair_live_project — tasklist shape', () => {
  it('registers as a second automator action, alongside build_live_project, never replacing it', async () => {
    const space = await loadSpace(resolve(SYS, 'system-appbuilder'), { requireAgents: false });
    expect(Object.keys(space.tasklists).sort()).toEqual(['build_live_project', 'repair_live_project']);
    expect(space.tasklists['repair_live_project']!.input).toEqual({ missing: 'array?', errors: 'array?', note: 'string?' });

    const repair = await loadTasklistFromSpace(space, 'repair_live_project');
    // diagnose has no upstream dependency — it reads the live project fresh, like
    // resolve_flagged_figure/01-diagnose.md and add_area/01-assess.md do.
    expect(repair['diagnose']!.dependsOn).toEqual([]);
    expect(repair['fix_broken']!.dependsOn).toEqual(['diagnose']);
    expect(repair['fix_broken']!.forEach).toBe('diagnose.offending');
    expect(repair['author_missing']!.dependsOn).toEqual(['diagnose', 'fix_broken']);
    expect(repair['author_missing']!.forEach).toBe('diagnose.toAuthor');
    expect(repair['report']!.goal).toBe(true);
  });

  it('never re-invokes build_live_project — the whole point of this tasklist existing', () => {
    for (const file of ['02-fix_broken.md', '03-author_missing.md', '04-report.md']) {
      const src = readFileSync(join(REPAIR_DIR, file), 'utf8');
      expect(src, `${file} must never call the full pipeline it exists to avoid`).not.toMatch(/tasklist\(\s*['"]build_live_project['"]/);
    }
  });

  it('author_missing declares LOCAL Input/Output interfaces, never the ambient <Name>Input/<Name>Output globals', () => {
    // Those globals only exist when emit_types ran as part of a fresh build_live_project plan — an
    // endpoint authored here was never in that contract, so referencing the ambient name is
    // `Cannot find name`, not a convenience.
    const src = readFileSync(join(REPAIR_DIR, '03-author_missing.md'), 'utf8');
    expect(src).toMatch(/interface Input/);
    expect(src).toMatch(/interface Output/);
    expect(src).toMatch(/do NOT reference an ambient/i);
  });
});
