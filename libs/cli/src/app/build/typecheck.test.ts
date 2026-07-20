/**
 * {@link typecheckProjectApp} — the project-app programmatic typecheck — plus
 * {@link runProjectAppCheck}'s aggregation of it with the esbuild bundle.
 *
 * TEST 1 (positive, non-negotiable): a KNOWN-GOOD app must typecheck with ZERO
 * errors, and `runProjectAppCheck` must report `{ ok:true, built:true }`. If this
 * ever goes red, first decide WHICH it is: a false positive on correct code means the
 * ambient in `./typecheck.ts` is wrong and the fixture must not be touched; a TRUE
 * positive means the fixture was never actually good. (It has been the latter once —
 * the page called `useApi('listItems')` while the project's only endpoint was `ping`,
 * which went unnoticed while `name` was typed as a bare `string`.)
 *
 * TEST 2 (negative, revert-proven): three classes of real author mistakes must
 * each produce a typecheck error naming the offending file, AND we prove the
 * typecheck phase — not esbuild — is what catches them: esbuild alone (bundling
 * the SAME broken pages via `buildProjectPagesChecked`, skipping `typecheckProjectApp`
 * entirely) reports a CLEAN build, because none of these mistakes are things esbuild's
 * type-stripping transpile can see. That's the load-bearing proof: without the
 * typecheck phase this task adds, `runProjectAppCheck` would have shipped all three.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { typecheckProjectApp } from './typecheck.js';
import { runProjectAppCheck } from './check.js';
import { buildProjectPagesChecked } from './pages.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** The shared "correct app" component: typed props, tokens-only styling, no `import React`. */
const GOOD_COST_CARD = `export interface CostCardProps {
  title: string;
  amount: number;
}

export default function CostCard({ title, amount }: CostCardProps) {
  return (
    <div className="border-border rounded border p-4">
      <p className="text-muted-foreground text-sm">{title}</p>
      <p className="text-foreground text-lg font-semibold">{amount.toFixed(2)}</p>
    </div>
  );
}
`;

/** The shared "correct app" page: relative import, \`useApi\`, null-guards, tokens, \`<Link to>\`. */
const GOOD_INDEX_PAGE = `import { useApi, Link } from '@app/runtime';
import CostCard from '../components/CostCard';

interface ItemsResponse {
  items: { id: string; title: string; amount: number }[];
}

export default function Home() {
  const { data, isLoading, error } = useApi<ItemsResponse>('listItems', {});

  if (isLoading) {
    return <div className="text-muted-foreground p-4">Loading…</div>;
  }
  if (error) {
    return <div className="text-destructive p-4">{error.message}</div>;
  }

  const items = data?.items ?? [];

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-foreground text-xl font-bold">Items</h1>
      {items.map((item) => (
        <CostCard key={item.id} title={item.title} amount={item.amount} />
      ))}
      <Link to="/about" className="text-primary underline">
        About
      </Link>
    </main>
  );
}
`;

/** The endpoint \`GOOD_INDEX_PAGE\` reads. The page names it verbatim; since the client
 *  data hooks are typed from the project's OWN endpoints, a page may only name an endpoint
 *  that actually exists — so the good fixture has to ship it. */
const GOOD_LIST_ITEMS_HANDLER = `export const name = 'listItems';

export interface Output { items: { id: string; title: string; amount: number }[] }

export default async function handler(): Promise<Output> {
  return { items: [] };
}
`;

const GOOD_PING_HANDLER = `export const name = 'ping';

export interface Output { pong: boolean }

export default async function handler(): Promise<Output> {
  return { pong: true };
}
`;

/** A known-good project: component + page + api handler, nothing else. */
async function goodProject(): Promise<string> {
  const root = await scratch('lm-typecheck-good-');
  await mkdir(join(root, 'pages'), { recursive: true });
  await mkdir(join(root, 'components'), { recursive: true });
  await mkdir(join(root, 'api', 'ping'), { recursive: true });
  await mkdir(join(root, 'api', 'listItems'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'good-scratch', version: '0.0.0' }));
  await writeFile(join(root, 'components', 'CostCard.tsx'), GOOD_COST_CARD, 'utf8');
  await writeFile(join(root, 'pages', 'index.tsx'), GOOD_INDEX_PAGE, 'utf8');
  await writeFile(join(root, 'api', 'ping', 'GET.ts'), GOOD_PING_HANDLER, 'utf8');
  await writeFile(join(root, 'api', 'listItems', 'GET.ts'), GOOD_LIST_ITEMS_HANDLER, 'utf8');
  return root;
}

describe('typecheckProjectApp — positive', () => {
  it('a known-good app (typed component, relative import, useApi, Link, null-guards, tokens, no `import React`) typechecks CLEAN', async () => {
    const root = await goodProject();
    const errors = await typecheckProjectApp(root);
    expect(errors).toEqual([]);
  }, 30_000);

  it('runProjectAppCheck reports ok:true, built:true for the same known-good app', async () => {
    const root = await goodProject();
    const result = await runProjectAppCheck(root);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.built).toBe(true);
    expect(result.routes).toContain('/');
  }, 30_000);

  it('an api/db-only project (no pages/components/api dirs at all) has nothing to typecheck', async () => {
    const root = await scratch('lm-typecheck-empty-');
    const errors = await typecheckProjectApp(root);
    expect(errors).toEqual([]);
  });
});

// ── Negative fixtures ───────────────────────────────────────────────────────────

/**
 * (a) reaches for the DOM instead of the typed `@app/runtime` surface. `document` is undeclared
 * BY DESIGN — the ambient is NO-DOM so a page expresses itself as JSX and React state. (This
 * fixture used `console` until `console`/`fetch`/`crypto`/the timers were added to the ambient:
 * they exist at runtime and rejecting them blocked working code in every shipped store app.)
 */
const BAD_CONSOLE_PAGE = `export default function BadConsole() {
  document.getElementById('root');
  return <div className="p-4">bad</div>;
}
`;

/** (b) passes a prop \`CostCardProps\` never declared. */
const BAD_PROP_PAGE = `import CostCard from '../components/CostCard';

export default function BadProp() {
  return <CostCard title="x" amount={1} foo={1} />;
}
`;

/** (c) imports a module that doesn't exist in this project (nor is it ambiently declared). */
const BAD_IMPORT_PAGE = `import { Link } from 'react-router';

export default function BadImport() {
  return <Link to="/x">go</Link>;
}
`;

/** A project carrying all three mistakes (a)+(b)+(c), alongside the good component. */
async function allBadProject(): Promise<string> {
  const root = await scratch('lm-typecheck-bad-');
  await mkdir(join(root, 'pages'), { recursive: true });
  await mkdir(join(root, 'components'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bad-scratch', version: '0.0.0' }));
  await writeFile(join(root, 'components', 'CostCard.tsx'), GOOD_COST_CARD, 'utf8');
  await writeFile(join(root, 'pages', 'bad-console.tsx'), BAD_CONSOLE_PAGE, 'utf8');
  await writeFile(join(root, 'pages', 'bad-prop.tsx'), BAD_PROP_PAGE, 'utf8');
  await writeFile(join(root, 'pages', 'bad-import.tsx'), BAD_IMPORT_PAGE, 'utf8');
  return root;
}

/** Same as {@link allBadProject} MINUS (c) — esbuild itself refuses an import it
 *  cannot resolve on disk, which would muddy the "esbuild doesn't catch this"
 *  proof for (a)/(b). This fixture isolates the two mistakes esbuild's
 *  type-stripping transpile is genuinely blind to. */
async function esbuildBlindBadProject(): Promise<string> {
  const root = await scratch('lm-typecheck-bad-esbuild-blind-');
  await mkdir(join(root, 'pages'), { recursive: true });
  await mkdir(join(root, 'components'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bad-blind-scratch', version: '0.0.0' }));
  await writeFile(join(root, 'components', 'CostCard.tsx'), GOOD_COST_CARD, 'utf8');
  await writeFile(join(root, 'pages', 'bad-console.tsx'), BAD_CONSOLE_PAGE, 'utf8');
  await writeFile(join(root, 'pages', 'bad-prop.tsx'), BAD_PROP_PAGE, 'utf8');
  return root;
}

describe('typecheckProjectApp — negative', () => {
  it('(a) document.getElementById(...) → a typecheck error mentioning `document`, naming the file', async () => {
    const root = await allBadProject();
    const errors = await typecheckProjectApp(root);
    const hit = errors.find((e) => e.file === 'pages/bad-console.tsx' && /document/.test(e.message));
    expect(hit).toBeDefined();
    expect(hit?.phase).toBe('typecheck');
  }, 30_000);

  it('(b) a prop the component does not declare → a typecheck error, naming the file', async () => {
    const root = await allBadProject();
    const errors = await typecheckProjectApp(root);
    const hit = errors.find((e) => e.file === 'pages/bad-prop.tsx');
    expect(hit).toBeDefined();
    expect(hit?.message).toMatch(/foo/);
  }, 30_000);

  it('(c) importing a module that does not exist → a module-not-found error, naming the file', async () => {
    const root = await allBadProject();
    const errors = await typecheckProjectApp(root);
    const hit = errors.find((e) => e.file === 'pages/bad-import.tsx');
    expect(hit).toBeDefined();
    expect(hit?.message).toMatch(/Cannot find module ['"]react-router['"]/);
  }, 30_000);

  it('runProjectAppCheck on the all-bad project is ok:false and names every offending file — never bundles broken code', async () => {
    const root = await allBadProject();
    const result = await runProjectAppCheck(root);
    expect(result.ok).toBe(false);
    expect(result.built).toBe(false);
    const files = new Set(result.errors.map((e) => e.file));
    expect(files).toContain('pages/bad-console.tsx');
    expect(files).toContain('pages/bad-prop.tsx');
    expect(files).toContain('pages/bad-import.tsx');
    // Short-circuit: every reported error is phase:'typecheck' — the esbuild phase
    // never ran (build-broken diagnostics, if any had leaked through, would say 'build').
    expect(result.errors.every((e) => e.phase === 'typecheck')).toBe(true);
  }, 30_000);

  // LOAD-BEARING PROOF: esbuild alone (bypassing typecheckProjectApp entirely, exactly
  // as `buildProjectPages`/`runBuild` behaved before this change — no typecheck existed
  // at all) does NOT catch (a) or (b). Both are pure type-level mistakes: `document` is a
  // perfectly valid browser global esbuild happily bundles, and an excess JSX prop is
  // just an extra object property at runtime. This is the concrete, executed
  // (not just asserted) demonstration that `typecheckProjectApp` — not esbuild — is
  // what makes `runProjectAppCheck` catch these classes of bugs.
  it('LOAD-BEARING: esbuild alone (no typecheck) reports a CLEAN build for the same (a)+(b) mistakes', async () => {
    const root = await esbuildBlindBadProject();

    // Sanity: the typecheck phase DOES flag both on this exact fixture.
    const tcErrors = await typecheckProjectApp(root);
    expect(tcErrors.length).toBeGreaterThanOrEqual(2);

    // But esbuild alone — i.e. `runProjectAppCheck` with its typecheck short-circuit
    // removed — sees nothing wrong: it type-strips and bundles both broken pages fine.
    const esbuildOnly = await buildProjectPagesChecked(root, { minify: false });
    expect(esbuildOnly.errors).toEqual([]);
    expect(esbuildOnly.built).toBe(true);
  }, 30_000);
});

/**
 * TEST 3 (endpoint wiring): the two ways a page can name an endpoint wrongly and still
 * build clean today. Both are invisible to esbuild AND to an HTTP-status probe:
 * `apiCall` rejects an unknown name BEFORE issuing any request, and a `[id]` route
 * called without its param stringifies `undefined` into the URL, which still matches on
 * segment count and returns a plausible 200. Typing the client hooks from the project's
 * own routes turns both into typecheck errors.
 *
 * Drawn from a real build: run 32 of the 06-tanzania scenario shipped `useApi('costs-summary')`
 * on three pages (no such endpoint — the Costs page rendered "Could not load cost data."),
 * `useApi('trips-detail')` with no id, and several names carrying the HTTP method or a
 * query string (`'trips-list/GET'`, `'contacts-list/GET?trip_id=…'`).
 */
describe('typecheckProjectApp — endpoint wiring', () => {
  /** A project whose single endpoint is `listItems`, plus one page of the caller's choosing. */
  async function projectCalling(pageSource: string, extraApi?: { dir: string; source: string }) {
    const root = await scratch('lm-typecheck-wiring-');
    await mkdir(join(root, 'pages'), { recursive: true });
    await mkdir(join(root, 'api', 'listItems'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'wiring-scratch', version: '0.0.0' }));
    await writeFile(join(root, 'api', 'listItems', 'GET.ts'), GOOD_LIST_ITEMS_HANDLER, 'utf8');
    if (extraApi) {
      await mkdir(join(root, 'api', extraApi.dir), { recursive: true });
      await writeFile(join(root, 'api', extraApi.dir, 'GET.ts'), extraApi.source, 'utf8');
    }
    await writeFile(join(root, 'pages', 'index.tsx'), pageSource, 'utf8');
    return root;
  }

  const pageReading = (call: string) => `import { useApi } from '@app/runtime';

export default function Home() {
  const { data } = ${call};
  return <main>{JSON.stringify(data)}</main>;
}
`;

  it('rejects a page naming an endpoint that does not exist', async () => {
    const root = await projectCalling(pageReading(`useApi<{ items: unknown[] }>('costs-summary')`));
    const errors = await typecheckProjectApp(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe('pages/index.tsx');
    expect(errors[0]!.message).toContain('costs-summary');
  }, 30_000);

  it('rejects an endpoint name carrying its HTTP method or a query string', async () => {
    const root = await projectCalling(pageReading(`useApi<{ items: unknown[] }>('listItems/GET')`));
    const errors = await typecheckProjectApp(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('listItems/GET');
  }, 30_000);

  it('rejects a [id] route called without its param', async () => {
    // The bug this prevents: the client stringifies the missing value, so the request
    // goes to `/api/trips/undefined`, matches, passes ajv, and 200s with the wrong row.
    const detail = `export const name = 'trips-detail';

export interface Output { id: string }

export default async function handler(): Promise<Output> {
  return { id: '' };
}
`;
    const root = await projectCalling(pageReading(`useApi<{ id: string }>('trips-detail')`), {
      dir: 'trips/[id]',
      source: detail,
    });
    const errors = await typecheckProjectApp(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe('pages/index.tsx');
  }, 30_000);

  it('ACCEPTS the same [id] route once its param is supplied', async () => {
    const detail = `export const name = 'trips-detail';

export interface Output { id: string }

export default async function handler(): Promise<Output> {
  return { id: '' };
}
`;
    const root = await projectCalling(pageReading(`useApi<{ id: string }>('trips-detail', { id: 'abc' })`), {
      dir: 'trips/[id]',
      source: detail,
    });
    expect(await typecheckProjectApp(root)).toEqual([]);
  }, 30_000);

  it('still accepts a page that passes its own generic — the T parameter is preserved', async () => {
    // 140 call sites across the shipped store apps author `useApi<Alert[]>('name')`.
    // Narrowing the NAME must never cost them the generic.
    const root = await projectCalling(pageReading(`useApi<{ items: { id: string }[] }>('listItems', {})`));
    expect(await typecheckProjectApp(root)).toEqual([]);
  }, 30_000);

  it('loads types/contract.d.ts as a GLOBAL ambient — a page uses its types with NO import', async () => {
    // The appbuilder's emit_types writes a global (no-export) contract.d.ts. It must be a program
    // ROOT so the author writes `useApi<ListItemsOutput>(...)` with no import, no relative-depth math,
    // and no "Cannot find module" to panic over (which made 06-tanzania run 36 abandon the contract).
    const root = await projectCalling(pageReading(`useApi<ListItemsOutput>('listItems')`));
    await mkdir(join(root, 'types'), { recursive: true });
    await writeFile(
      join(root, 'types', 'contract.d.ts'),
      `interface ListItemsItem { id: string }\ninterface ListItemsOutput { items: ListItemsItem[] }\n`,
      'utf8',
    );
    expect(await typecheckProjectApp(root)).toEqual([]);
  }, 30_000);

  it('a diagnostic INSIDE contract.d.ts is dropped — build-generated, not author-fixable', async () => {
    const root = await projectCalling(pageReading(`useApi<{ x: number }>('listItems')`));
    await mkdir(join(root, 'types'), { recursive: true });
    // A self-referential garbage type: an error the author of a PAGE cannot fix.
    await writeFile(join(root, 'types', 'contract.d.ts'), `type Broken = Broken['nope'];\n`, 'utf8');
    const errs = await typecheckProjectApp(root);
    expect(errs.every((e) => !e.file.includes('contract.d.ts'))).toBe(true);
  }, 30_000);

  it('keeps the generic signatures for a project with no api/ dir at all', async () => {
    // An app mid-authoring (pages before endpoints) must still compile.
    const root = await scratch('lm-typecheck-noapi-');
    await mkdir(join(root, 'pages'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'noapi', version: '0.0.0' }));
    await writeFile(join(root, 'pages', 'index.tsx'), pageReading(`useApi<{ x: number }>('anything')`), 'utf8');
    expect(await typecheckProjectApp(root)).toEqual([]);
  }, 30_000);
});
