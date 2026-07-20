import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transpileStatement } from '../typecheck/transpile.js';

/**
 * Executes the REAL mechanical build-completeness gate embedded in
 * `12-compile_pass1.md` against a mocked project filesystem — proving the
 * exact statement the model is instructed to write and run, not a
 * reimplementation that could drift from the prompt.
 *
 * Two gaps this file guards (both confirmed live in 06-tanzania run 32):
 *  - step 3: `pages/index.tsx` called `useApi('costs-summary')`, an endpoint
 *    that was never generated — `useApi` short-circuits to an error state
 *    with NO network request, invisible to the compiler.
 *  - step 10: `pages/cash-expenses.tsx`'s `Page()` returned a bare
 *    `{ type, props }` object literal (this system's OWN display()-descriptor
 *    shape) instead of JSX — typechecks clean, throws React error #31 at
 *    runtime.
 *
 * Before the fix, both fixtures resolve `ok: true` with an empty `offending`
 * (the gate has no page/component scan at all) — that is the measured gap.
 * After the fix, both resolve `ok: false` with a `phase: 'gate'` error
 * naming the fault.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_DIR = join(__dirname, '..', '..', 'system-spaces', 'system-appbuilder', 'tasklists', 'build_live_project');

/** Pull the one fenced ```typescript block out of a tasklist node's prose. */
function extractCode(file: string): string {
  const src = readFileSync(join(NODE_DIR, file), 'utf8');
  const m = /```typescript\n([\s\S]*?)```/.exec(src);
  if (!m) throw new Error(`no fenced typescript block found in ${file}`);
  return m[1];
}

type Offending = { path: string; kind: string; errors: Array<{ line?: number; phase: string; message: string }> };
type GateResult = { ok: boolean; built: boolean; routes: string[]; offending: Offending[] };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...fnArgs: unknown[]) => Promise<unknown>;

/**
 * A minimal in-memory project filesystem, shaped exactly like the real
 * `listProjectDir`/`readProjectFile` globals (`sdk/org/libs/cli/src/app/authoring/globals.ts`):
 * `listProjectDir` returns BARE entry names (files and subdirectories) for one
 * directory level — never full paths — derived here from the flat file map so
 * a fixture is just `{ 'pages/index.tsx': '<source>' }`.
 */
function mkFs(files: Record<string, string>) {
  const dirs: Record<string, Set<string>> = {};
  const add = (dir: string, name: string) => {
    (dirs[dir] ??= new Set()).add(name);
  };
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      add(parts.slice(0, i).join('/'), parts[i]);
    }
  }
  const listProjectDir = (dir: string) => {
    const norm = dir.replace(/\/+$/, '');
    const set = dirs[norm];
    return { ok: true, entries: set ? Array.from(set).sort() : [] };
  };
  const readProjectFile = (path: string) => {
    const content = files[path];
    return content === undefined ? { ok: false, content: '', error: `no such file: ${path}` } : { ok: true, content };
  };
  return { listProjectDir, readProjectFile };
}

/** Run the real `12-compile_pass1.md` statement against a fixture filesystem. `buildApp()` is
 *  stubbed clean (`{ ok: true, built: true, routes: [], errors: [] }`) so the assertion isolates
 *  the MECHANICAL scan this gate adds on top of the compiler — not the typecheck/bundle itself. */
async function runCompilePass1(files: Record<string, string>): Promise<GateResult> {
  const { listProjectDir, readProjectFile } = mkFs(files);
  const buildApp = async () => ({ ok: true, built: true, routes: [] as string[], errors: [] as unknown[] });
  let resolved: unknown;
  const currentTask = { resolve: (v: unknown) => { resolved = v; } };
  const code = transpileStatement(extractCode('12-compile_pass1.md'));
  const fn = new AsyncFunction('listProjectDir', 'readProjectFile', 'buildApp', 'currentTask', code);
  await fn(listProjectDir, readProjectFile, buildApp, currentTask);
  return resolved as GateResult;
}

/** A real generated endpoint module — `export const name` is the ONLY thing the gate reads. */
function endpointModule(name: string, table: string): string {
  return [
    `export const name = '${name}';`,
    `export const description = 'reads ${table}';`,
    'export interface Input {}',
    'export interface Output { items: any[] }',
    'export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {',
    `  const items = await ctx.db.query('${table}');`,
    '  return { items };',
    '}',
  ].join('\n');
}

describe('build_live_project gate — 12-compile_pass1.md mechanical scans (real prompt code)', () => {
  const baseFiles = {
    'database/costs.json': '{"columns":[{"name":"id","type":"string"}]}',
    'api/costs-list/GET.ts': endpointModule('costs-list', 'costs'),
  };

  it('FAILS a page that calls useApi() with a name no generated endpoint exports', async () => {
    const files = {
      ...baseFiles,
      'pages/index.tsx': [
        "import { useApi } from '@app/runtime';",
        'export default function Page() {',
        "  const { data } = useApi<{ items: { total: number }[] }>('costs-summary');",
        '  return <div>{data?.items?.[0]?.total}</div>;',
        '}',
      ].join('\n'),
    };
    const r = await runCompilePass1(files);
    expect(r.ok).toBe(false);
    const hit = r.offending.find((o) => o.path === 'pages/index.tsx');
    expect(hit, 'pages/index.tsx must be flagged offending').toBeDefined();
    expect(hit!.errors.some((e) => e.phase === 'gate' && /costs-summary/.test(e.message))).toBe(true);
  });

  it('PASSES a page that calls useApi() with a real generated endpoint name', async () => {
    const files = {
      ...baseFiles,
      'pages/index.tsx': [
        "import { useApi } from '@app/runtime';",
        'export default function Page() {',
        "  const { data } = useApi<{ items: { total: number }[] }>('costs-list');",
        '  return <div>{data?.items?.[0]?.total}</div>;',
        '}',
      ].join('\n'),
    };
    const r = await runCompilePass1(files);
    expect(r.offending.find((o) => o.path === 'pages/index.tsx')).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('FAILS a Page() that returns a bare { type, props } object literal instead of JSX', async () => {
    const files = {
      ...baseFiles,
      'pages/cash-expenses.tsx': [
        "import { useApi } from '@app/runtime';",
        'export default function Page() {',
        "  const { data, isLoading } = useApi('costs-list');",
        "  if (isLoading) return { type: 'div', props: { className: 'p-4', children: 'Loading...' } };",
        '  return {',
        "    type: 'div',",
        "    props: { className: 'p-4', children: 'Cash Expenses' },",
        '  };',
        '}',
      ].join('\n'),
    };
    const r = await runCompilePass1(files);
    expect(r.ok).toBe(false);
    const hit = r.offending.find((o) => o.path === 'pages/cash-expenses.tsx');
    expect(hit, 'pages/cash-expenses.tsx must be flagged offending').toBeDefined();
    expect(hit!.errors.some((e) => e.phase === 'gate' && /type,\s*props|JSX/i.test(e.message))).toBe(true);
  });

  it('PASSES a Page() that returns real JSX', async () => {
    const files = {
      ...baseFiles,
      'pages/cash-expenses.tsx': [
        "import { useApi } from '@app/runtime';",
        'export default function Page() {',
        "  const { data, isLoading } = useApi('costs-list');",
        "  if (isLoading) return <p className=\"p-4\">Loading...</p>;",
        '  return (',
        '    <main className="p-4">',
        '      <h1>Cash Expenses</h1>',
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
    };
    const r = await runCompilePass1(files);
    expect(r.offending.find((o) => o.path === 'pages/cash-expenses.tsx')).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('a component (not just a page) with a bad useApi ref or a descriptor return is also flagged', async () => {
    const files = {
      ...baseFiles,
      'components/CostCard.tsx': [
        "import { useApi } from '@app/runtime';",
        'export default function CostCard() {',
        "  const { data } = useApi('costs-summary');",
        "  return { type: 'div', props: { children: data } };",
        '}',
      ].join('\n'),
    };
    const r = await runCompilePass1(files);
    expect(r.ok).toBe(false);
    const hit = r.offending.find((o) => o.path === 'components/CostCard.tsx');
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe('component');
    // Both faults live in the same file — both must be named, not just the first one found.
    expect(hit!.errors.some((e) => /costs-summary/.test(e.message))).toBe(true);
    expect(hit!.errors.some((e) => /type,\s*props|JSX/i.test(e.message))).toBe(true);
  });
});

describe('build_live_project gate — 14-compile_pass2.md / 16-finalize.md carry the same scans', () => {
  /**
   * 14 and 16 mirror 12's two new scans verbatim (same regexes, same message shape) — proved by
   * fixture in 12 above. Here we only need a SYNTAX sanity check that the mirrored blocks actually
   * transpile to valid JS (a copy-paste slip in either mirror would otherwise ship silently: neither
   * file is ever executed by `tsc`, since a tasklist `.md` is prose, not a compiled source file).
   */
  it('both mirrors transpile clean and contain both new scans', () => {
    for (const file of ['14-compile_pass2.md', '16-finalize.md']) {
      const code = extractCode(file);
      const js = transpileStatement(code);
      expect(() => new AsyncFunction('listProjectDir', 'readProjectFile', 'buildApp', 'currentTask', 'writeProjectPage', 'implement_tables', 'implement_endpoints', 'implement_components', 'implement_pages', js)).not.toThrow();
      // Both scans present verbatim (copy-paste fidelity from the 12-compile_pass1.md original).
      expect(code).toContain("useApi(?:Mutation)?|apiCall)");
      expect(code).toContain("type\\s*:\\s*(?:'[^']*'|\"[^\"]*\"|[A-Za-z_$][\\w$]*)\\s*,\\s*props\\s*:");
    }
  });
});
