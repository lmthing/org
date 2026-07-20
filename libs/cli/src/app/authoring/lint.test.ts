/**
 * Unit tests for the write-time artifact lint ({@link ./lint.ts}) — each validator in isolation,
 * with explicit FALSE-REJECT guards (valid real-world source shapes must pass) so the lint never
 * blocks a legal write.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LintError,
  apiCallSiteError,
  apiCallSites,
  discoverApiEndpoints,
  absentGlobalUse,
  displayDescriptorReturn,
  existingApiNames,
  invisibleTextToken,
  lintApiHandler,
  lintComponentSource,
  lintHookSource,
  lintPageSource,
} from './lint.js';

describe('lintApiHandler', () => {
  const named = "export const name = 'itemsList';\nexport default async (req, ctx) => ({ ok: true });";

  it('rejects a handler with no `export const name` (the round-1 failure)', () => {
    expect(lintApiHandler('export default async () => ({});')).toMatch(/export const name/);
  });
  it('rejects a named module with no default/handler export', () => {
    expect(lintApiHandler("export const name = 'x';")).toMatch(/handler/i);
  });
  it('accepts a named endpoint with a default export', () => {
    expect(lintApiHandler(named)).toBeNull();
  });
  it('accepts `export function handler` instead of a default export', () => {
    expect(lintApiHandler("export const name = 'x';\nexport function handler() {}")).toBeNull();
  });
  it('rejects a name already claimed by a DIFFERENT endpoint file', () => {
    const existing = new Map([['itemsList', 'api/other/GET.ts']]);
    expect(lintApiHandler(named, { existingNames: existing })).toMatch(/already used by api\/other\/GET\.ts/);
  });
  it('allows a name that belongs to no other file', () => {
    expect(lintApiHandler(named, { existingNames: new Map() })).toBeNull();
  });
});

describe('lintPageSource / lintComponentSource', () => {
  it('rejects a page with no default export', () => {
    expect(lintPageSource('export const x = 1;')).toMatch(/default export/);
  });
  it('rejects a component with no default export', () => {
    expect(lintComponentSource('export function Card() { return null; }')).toMatch(/default export/);
  });
  it('accepts `export default function`', () => {
    expect(lintPageSource('export default function Page() { return null; }')).toBeNull();
  });
  it('accepts an arrow default export', () => {
    expect(lintComponentSource('export default () => null;')).toBeNull();
  });
  it('accepts `export { X as default }` (no false-reject)', () => {
    expect(lintPageSource('function Page() { return null; }\nexport { Page as default };')).toBeNull();
    expect(lintComponentSource('const C = () => null;\nexport { C as default };')).toBeNull();
  });
});

describe('lintHookSource', () => {
  const file = join(tmpdir(), 'x', 'hooks', 'h.ts');

  it('rejects a default export that is a function, not an object', () => {
    expect(lintHookSource('export default async function () {}', 'h', file)).toMatch(/must be a hook OBJECT/);
  });
  it('rejects an object with a missing or unknown type', () => {
    expect(lintHookSource('export default {};', 'h', file)).toMatch(/type/);
    expect(lintHookSource("export default { type: 'nope' };", 'h', file)).toMatch(/cron/);
  });
  it('accepts a valid cron / event / webhook hook object', () => {
    expect(lintHookSource("export default { type: 'cron', every: '1d', handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'event', on: { event: 'x/y' }, handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'webhook', path: 'incoming', trigger: 'x' };", 'h', file)).toBeNull();
  });
  it('rejects source that fails to evaluate', () => {
    expect(lintHookSource("throw new Error('boom'); export default { type: 'cron' };", 'h', file)).toMatch(/failed to evaluate/);
  });
});

describe('existingApiNames', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-lint-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each endpoint name to its file and EXCLUDES the target being written', () => {
    mkdirSync(join(root, 'api', 'items'), { recursive: true });
    writeFileSync(join(root, 'api', 'items', 'GET.ts'), "export const name = 'itemsList';\nexport default () => ({});");
    mkdirSync(join(root, 'api', 'items', 'x'), { recursive: true });
    const target = join(root, 'api', 'items', 'x', 'POST.ts');
    writeFileSync(target, "export const name = 'itemsCreate';\nexport default () => ({});");

    const names = existingApiNames(root, target);
    expect(names.get('itemsList')).toBe(join('api', 'items', 'GET.ts'));
    expect(names.has('itemsCreate')).toBe(false); // the target file is excluded from its own scan
  });

  it('returns an empty map when there is no api/ dir', () => {
    expect(existingApiNames(root, join(root, 'api', 'x', 'GET.ts')).size).toBe(0);
  });
});

describe('LintError', () => {
  it('is an Error subclass named LintError', () => {
    const e = new LintError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LintError');
  });
});

// ── Save-time cross-artifact checks (plan Part C) ─────────────────────────────

describe('apiCallSites', () => {
  it('extracts the fn, the literal name, and the input keys of every call site', () => {
    const src = `
      const a = useApi('tripsList');
      const b = useApi<{ items: Row[] }>('tripsDetail', { id, tab: 'x' });
      const c = useApiMutation('tripsCreate', { invalidates: ['tripsList'] });
      await apiCall('costsSummary', {});
    `;
    const sites = apiCallSites(src);
    expect(sites.map((s) => [s.fn, s.name, s.hasInput])).toEqual([
      ['useApi', 'tripsList', false],
      ['useApi', 'tripsDetail', true],
      ['useApiMutation', 'tripsCreate', true],
      ['apiCall', 'costsSummary', true],
    ]);
    expect(sites[1].inputKeys).toEqual(['id', 'tab']);
    expect(sites[3].inputKeys).toEqual([]);
  });

  it('reports inputKeys as null when a spread hides the real keys', () => {
    expect(apiCallSites("useApi('x', { ...filters, id })")[0].inputKeys).toBeNull();
  });

  it('reports inputKeys as null when the input is a variable, not a literal', () => {
    expect(apiCallSites("useApi('x', params)")[0].inputKeys).toBeNull();
  });

  it('ignores a non-literal endpoint name (nothing statically knowable)', () => {
    expect(apiCallSites('useApi(endpointName, { id })')).toEqual([]);
  });
});

describe('discoverApiEndpoints', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-eps-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(root, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(root, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }

  it('collects names and derives paramNames from [id] segments', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    endpoint(['trips', '[id]'], 'GET', 'tripsDetail');
    endpoint(['trips', '[id]', 'legs', '[legId]'], 'GET', 'legDetail');
    const eps = discoverApiEndpoints(root);
    expect([...eps.keys()].sort()).toEqual(['legDetail', 'tripsDetail', 'tripsList']);
    expect(eps.get('tripsList')!.paramNames).toEqual([]);
    expect(eps.get('tripsDetail')!.paramNames).toEqual(['id']);
    expect(eps.get('legDetail')!.paramNames).toEqual(['id', 'legId']);
  });

  it('is fail-soft: a name-less sibling is skipped, not thrown', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    mkdirSync(join(root, 'api', 'broken'), { recursive: true });
    writeFileSync(join(root, 'api', 'broken', 'GET.ts'), 'export default () => ({});');
    expect([...discoverApiEndpoints(root).keys()]).toEqual(['tripsList']);
  });

  it('returns an empty map with no api/ dir', () => {
    expect(discoverApiEndpoints(root).size).toBe(0);
  });
});

describe('apiCallSiteError — endpoint name exists (check 1)', () => {
  const eps = new Map([
    ['tripsList', { name: 'tripsList', paramNames: [], dir: 'api/trips' }],
    ['costsBreakdown', { name: 'costsBreakdown', paramNames: [], dir: 'api/costs-breakdown' }],
  ]);

  it('rejects a name no endpoint exports, naming it and listing the real ones', () => {
    // The exact run-32 defect: plan_pages invented `costs-summary`; no handler ever exported it.
    const err = apiCallSiteError("useApi('costs-summary')", 'page', eps);
    expect(err).toMatch(/no endpoint named "costs-summary"/);
    expect(err).toMatch(/costsBreakdown, tripsList/);
  });

  it('suggests a near-match name when there is one', () => {
    expect(apiCallSiteError("useApi('trips')", 'page', eps)).toMatch(/did you mean "tripsList"\?/);
  });

  it('accepts every name that IS exported (no false reject)', () => {
    expect(apiCallSiteError("useApi('tripsList'); apiCall('costsBreakdown', {})", 'page', eps)).toBeNull();
  });

  it('stays silent when the project has no endpoints yet (UI shell authored first)', () => {
    expect(apiCallSiteError("useApi('anything')", 'page', new Map())).toBeNull();
  });
});

describe('apiCallSiteError — parameterized route arity (check 2)', () => {
  const eps = new Map([
    ['tripsDetail', { name: 'tripsDetail', paramNames: ['id'], dir: 'api/trips/[id]' }],
    ['tripsList', { name: 'tripsList', paramNames: [], dir: 'api/trips' }],
  ]);

  it('rejects a parameterized endpoint called with NO input', () => {
    // run-32: trip-detail.tsx called useApi('trips-detail') → /api/trips/undefined → 200, wrong row.
    const err = apiCallSiteError("useApi('tripsDetail')", 'page', eps);
    expect(err).toMatch(/passes no input/);
    expect(err).toMatch(/needs "id"/);
    expect(err).toMatch(/"undefined"/);
  });

  it('rejects an input object literal that omits a required param', () => {
    const err = apiCallSiteError("useApi('tripsDetail', { tab: 'costs' })", 'page', eps);
    expect(err).toMatch(/missing the route param "id"/);
    expect(err).toMatch(/supplies "tab"/);
  });

  it('names every missing param when the route has several', () => {
    const multi = new Map([
      ['legDetail', { name: 'legDetail', paramNames: ['id', 'legId'], dir: 'api/trips/[id]/legs/[legId]' }],
    ]);
    expect(apiCallSiteError("useApi('legDetail', { q: 1 })", 'page', multi)).toMatch(/"id", "legId"/);
  });

  it('accepts a parameterized endpoint whose input supplies the param', () => {
    expect(apiCallSiteError("useApi('tripsDetail', { id })", 'page', eps)).toBeNull();
    expect(apiCallSiteError("useApi('tripsDetail', { id: tripId, tab })", 'page', eps)).toBeNull();
  });

  it('accepts a NON-parameterized endpoint called with no input', () => {
    expect(apiCallSiteError("useApi('tripsList')", 'page', eps)).toBeNull();
  });

  it('stays silent when the input is not an object literal (keys unknowable)', () => {
    expect(apiCallSiteError("useApi('tripsDetail', params)", 'page', eps)).toBeNull();
    expect(apiCallSiteError("useApi('tripsDetail', { ...route })", 'page', eps)).toBeNull();
  });

  it("does NOT arity-check useApiMutation — its 2nd arg is options, params come from mutate()", () => {
    const m = new Map([
      ['tripUpdate', { name: 'tripUpdate', paramNames: ['id'], dir: 'api/trips/[id]' }],
    ]);
    expect(apiCallSiteError("useApiMutation('tripUpdate', { invalidates: ['x'] })", 'page', m)).toBeNull();
  });
});

describe('displayDescriptorReturn (check 3)', () => {
  it('rejects a component returning a { type, props } display descriptor', () => {
    const src = "export default function Card() { return { type: 'div', props: { children: 'hi' } }; }";
    const err = displayDescriptorReturn(src, 'component');
    expect(err).toMatch(/display\(\) DESCRIPTOR shape/);
    expect(err).toMatch(/React error #31/);
    expect(err).toMatch(/Return JSX instead/);
  });

  it('rejects the { type, props, children } variant too', () => {
    expect(
      displayDescriptorReturn("return { type: 'ul', props: {}, children: rows };", 'page'),
    ).toMatch(/React error #31/);
  });

  it('accepts a component that returns JSX (no false reject)', () => {
    const src = 'export default function Card() { return <div className="p-4">{name}</div>; }';
    expect(displayDescriptorReturn(src, 'component')).toBeNull();
  });

  it('accepts a returned object that merely HAS a type/props key among others', () => {
    // A config/hook result is not a descriptor — the key set must be a descriptor subset.
    expect(displayDescriptorReturn('return { type: t, props: p, data, isLoading };', 'page')).toBeNull();
    expect(displayDescriptorReturn("return { type: 'trip', label, id };", 'page')).toBeNull();
  });

  it('accepts a returned object with only one of the two descriptor keys', () => {
    expect(displayDescriptorReturn("return { type: 'a' };", 'page')).toBeNull();
    expect(displayDescriptorReturn('return { props: p };', 'page')).toBeNull();
  });
});

describe('invisibleTextToken (check 4)', () => {
  it('rejects text-muted and points at text-muted-foreground', () => {
    // The real bug: 149 uses of text-muted at contrast 1.08 (WCAG AA needs 4.5).
    const err = invisibleTextToken('<p className="text-sm text-muted">hi</p>', 'page');
    expect(err).toMatch(/`text-muted` sets the TEXT colour to `--muted`/);
    expect(err).toMatch(/invisible/);
    expect(err).toMatch(/Use `text-muted-foreground`/);
  });

  it('rejects other surface tokens used as text', () => {
    for (const t of ['text-card', 'text-background', 'text-accent', 'text-border', 'text-secondary']) {
      expect(invisibleTextToken(`<div className="${t}" />`, 'page')).toMatch(/SURFACE \(background\) token/);
    }
  });

  it('rejects a variant-prefixed form (hover:text-muted)', () => {
    expect(invisibleTextToken('<a className="hover:text-muted" />', 'page')).toMatch(/invisible/);
  });

  it('does NOT reject the correct -foreground text tokens', () => {
    const ok = 'text-muted-foreground text-card-foreground text-accent-foreground text-foreground text-secondary-foreground';
    expect(invisibleTextToken(`<p className="${ok}" />`, 'page')).toBeNull();
  });

  it('does NOT reject bg-/border- uses of the same surface tokens', () => {
    expect(invisibleTextToken('<div className="bg-muted border-border rounded" />', 'page')).toBeNull();
  });

  it('does NOT reject the saturated functional colours that ARE legible as text', () => {
    // text-primary/destructive/success/warning/agent are used hundreds of times across the
    // shipped store apps; they are below AA but legible — a design-review call, not a save-time error.
    const used = 'text-destructive text-primary text-success text-warning text-agent';
    expect(invisibleTextToken(`<p className="${used}" />`, 'page')).toBeNull();
  });

  it('does NOT reject Tailwind size/alignment utilities that start with text-', () => {
    expect(invisibleTextToken('<p className="text-sm text-xs text-center text-left" />', 'page')).toBeNull();
  });
});

describe('absentGlobalUse (check 5) — write-time, not a late gate', () => {
  // Rejection is only defensible where the author has somewhere else to go. Globals that WORK at
  // runtime are declared in the ambient instead (build/typecheck.ts), so they neither error nor
  // reject — measured against the 5 shipped store apps, which use every one of them legitimately.
  it('does NOT reject globals that are now declared in the ambient', () => {
    expect(absentGlobalUse("const r = await fetch('https://geocode.example/q');", 'page')).toBeNull();
    expect(absentGlobalUse('const id = crypto.randomUUID();', 'page')).toBeNull();
    expect(absentGlobalUse('const t = setInterval(tick, 1000); clearInterval(t);', 'component')).toBeNull();
    expect(absentGlobalUse('setTimeout(fn, 100); console.log(1);', 'page')).toBeNull();
  });

  it('still rejects the DOM proper in a page', () => {
    const msg = absentGlobalUse('document.getElementById("x")', 'page');
    expect(msg).toContain('`document` is not declared');
    expect(msg).toContain('JSX and React state'); // must name the replacement — the retry's whole input
  });

  it('names the kind it was given', () => {
    expect(absentGlobalUse('window.scrollTo(0, 0)', 'component')).toContain('component rejected (not saved)');
  });

  // FALSE-REJECT GUARDS — a lint that blocks legal source is worse than one that misses a fault.
  it('does not flag a property access or a longer identifier', () => {
    expect(absentGlobalUse('const a = ctx.document; const b = documentId; subdocument();', 'page')).toBeNull();
  });

  it('does not flag a name the module binds itself', () => {
    expect(absentGlobalUse('const document = useApi("doc"); document.x;', 'page')).toBeNull();
    expect(absentGlobalUse('import { document } from "@app/runtime";\ndocument();', 'page')).toBeNull();
  });

  it('does not flag the word inside a comment or a string', () => {
    expect(absentGlobalUse('// never touch document here\nconst s = "use document";', 'page')).toBeNull();
  });

  it('passes a clean page', () => {
    expect(
      absentGlobalUse("const { data } = useApi('costs-list');\nreturn <div>{data.items.length}</div>;", 'page'),
    ).toBeNull();
  });
});
