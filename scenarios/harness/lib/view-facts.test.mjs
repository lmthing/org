/**
 * view-facts.test.mjs — unit coverage for the view-spec observables `snapshot()` was missing (see
 * this module's own docblock, and the "harness gap" section of PROGRESS.md).
 *
 * Fixtures are built on the fly under a tmpdir (same convention as `local.test.mjs`'s `fakeRun`)
 * rather than pointing at scenario `runs/` dirs — those are gitignored (`scenarios/.gitignore` has a
 * `runs/` glob entry) throwaway run output, not committed fixtures, so a test that hard-depends on one existing would be
 * flaky on a fresh clone or CI box. The REAL on-disk evidence in `scenarios/13-plant-care/runs/` (and
 * a `06-tanzania` run, as the non-viewbuilder control) was used to hand-verify this module while
 * wiring it in — see the last `describe` block below, which exercises those same real runs but SKIPS
 * itself when they are not present rather than failing.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { productConstants, servedPath, viewFacts, viewShapes, compactViewFacts, nativeViewFacts } from './view-facts.mjs';
import { SCENARIOS_DIR } from './paths.mjs';

const tmps = [];
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lmscn-viewfacts-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  // `productConstants` caches at MODULE scope (by design — see its own docblock). Several tests below
  // deliberately poison that cache with a fake `root` + `fresh: true` to prove the missing/malformed
  // path; reset it back to the real product source after every test so later tests (which call
  // `viewFacts()`/`productConstants()` with the default root) see the REAL constants, not a leftover
  // fake one.
  productConstants({ fresh: true });
});

/** Write a `{relPath: content}` map into `root`, creating parent dirs as needed. */
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

/** A hand-authored React page — under v2 there are NO generated wrappers, so any `.tsx` in a spec
 *  app is a web-only page the harness must surface (`handAuthoredPages`). */
function handAuthoredPage(route) {
  return `// hand-written page for ${route}\nexport default function Page() { return <div>hi</div>; }\n`;
}

// ── servedPath ───────────────────────────────────────────────────────────────────────────────────
describe('servedPath', () => {
  it('drops a trailing "index"', () => {
    expect(servedPath('index')).toBe('/');
    expect(servedPath('plants/index')).toBe('/plants');
  });
  it('turns [param] segments into :param', () => {
    expect(servedPath('plants/[id]')).toBe('/plants/:id');
    expect(servedPath('a/[id]/b')).toBe('/a/:id/b');
  });
  it('a bare top-level route', () => {
    expect(servedPath('plants')).toBe('/plants');
  });
});

// ── productConstants ────────────────────────────────────────────────────────────────────────────
describe('productConstants — constants extracted from the product source, never retyped', () => {
  it('extracts all three from the real sdk/org source tree with nothing missing', () => {
    const K = productConstants({ fresh: true });
    expect(typeof K.emptyFormSentinel).toBe('string');
    expect(Number.isFinite(K.shellDeriveMaxRoutes)).toBe(true);
    expect(K.missing).toEqual([]);
  });

  it('a source file that is simply absent comes back null WITH a `missing` entry — never a throw or a guess', () => {
    const root = mkTmp(); // empty — none of the constant files exist under it
    const K = productConstants({ root, fresh: true });
    expect(K.emptyFormSentinel).toBeNull();
    expect(K.shellDeriveMaxRoutes).toBeNull();
    expect(K.missing).toHaveLength(2);
    expect(K.missing.join(' ')).toMatch(/form\.tsx/);
    expect(K.missing.join(' ')).toMatch(/schema\.ts/);
  });

  it('a source file present but whose SHAPE no longer matches the pattern also comes back null+missing, not a stale guess', () => {
    const root = mkTmp();
    writeTree(root, {
      'libs/ui/src/view/form.tsx': '// fields.length === 0 branch removed in a refactor\n',
      'libs/cli/src/app/view-spec/schema.ts': '// SHELL_DERIVE_MAX_ROUTES renamed to something else\n',
    });
    const K = productConstants({ root, fresh: true });
    expect(K.emptyFormSentinel).toBeNull();
    expect(K.shellDeriveMaxRoutes).toBeNull();
    expect(K.missing).toHaveLength(2);
  });

  it('caches until `fresh: true` is passed', () => {
    const rootA = mkTmp();
    writeTree(rootA, { 'libs/cli/src/app/view-spec/schema.ts': 'export const SHELL_DERIVE_MAX_ROUTES = 5;\n' });
    const first = productConstants({ root: rootA, fresh: true });
    expect(first.shellDeriveMaxRoutes).toBe(5);

    const rootB = mkTmp(); // a different root the module has never seen
    writeTree(rootB, { 'libs/cli/src/app/view-spec/schema.ts': 'export const SHELL_DERIVE_MAX_ROUTES = 9;\n' });
    const stale = productConstants({ root: rootB }); // no fresh: true — must return the CACHED value
    expect(stale.shellDeriveMaxRoutes).toBe(5);

    const refreshed = productConstants({ root: rootB, fresh: true });
    expect(refreshed.shellDeriveMaxRoutes).toBe(9);
  });

  it('extracts the exact declared bound, not a hardcoded guess', () => {
    const root = mkTmp();
    writeTree(root, { 'libs/cli/src/app/view-spec/schema.ts': 'export const SHELL_DERIVE_MAX_ROUTES = 42;\n' });
    expect(productConstants({ root, fresh: true }).shellDeriveMaxRoutes).toBe(42);
  });
});

// ── viewFacts — the on-disk walk ────────────────────────────────────────────────────────────────
describe('viewFacts', () => {
  it('returns null when there is no `pages/` dir at all', () => {
    const root = mkTmp();
    expect(viewFacts(root)).toBeNull();
  });

  // An appbuilder-TSX project (06-tanzania, 07-life-admin, 08-small-shop, 09-home-renovation,
  // 10-family-recipes all do this for real) HAS a `pages/` dir full of hand-written `.tsx` and NOT ONE
  // `.view.json` anywhere. That must stay a cheap null — the view-facts pipeline never touched it.
  it('returns null for a pages/ dir with .tsx pages but ZERO .view.json anywhere (appbuilder-TSX, not viewbuilder)', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/index.tsx': handAuthoredPage('index'),
      'pages/contacts.tsx': handAuthoredPage('contacts'),
      'pages/_layout.tsx': 'export default function Layout() { return null; }\n',
    });
    expect(viewFacts(root)).toBeNull();
  });

  it('a minimal v2 spec app (views/): specRoutes, kindCounts, no hand-authored pages', () => {
    const root = mkTmp();
    writeTree(root, {
      'views/index.view.json': { sections: [{ kind: 'stats' }, { kind: 'list', query: 'listThings' }] },
    });
    const facts = viewFacts(root, { endpoints: [{ name: 'listThings' }, { name: 'createThing' }] });
    expect(facts).not.toBeNull();
    expect(facts.specRoutes).toEqual(['index']);
    expect(facts.kindCounts).toEqual({ stats: 1, list: 1 });
    expect(facts.routes.index.sections).toEqual([{ kind: 'stats' }, { kind: 'list', endpoint: 'listThings' }]);
    expect(facts.handAuthoredPages).toEqual([]);
    expect(facts.endpointCount).toBe(2);
    expect(facts.malformed).toEqual([]);
  });

  // The regression the `handAuthoredPages` fact exists to catch: under v2 there are NO generated
  // wrappers, so any `.tsx` living in a spec app is a web-only page — surfaced, not tolerated.
  it('a `.tsx` beside a spec is flagged in handAuthoredPages (a web-only page)', () => {
    const root = mkTmp();
    writeTree(root, {
      'views/index.view.json': { sections: [{ kind: 'list', query: 'listThings' }] },
      'pages/index.tsx': handAuthoredPage('index'),
    });
    const facts = viewFacts(root);
    expect(facts.handAuthoredPages).toEqual(['pages/index.tsx']);
    const compact = compactViewFacts(facts);
    expect(compact.handAuthoredPages).toEqual(['pages/index.tsx']);
  });

  it('malformed spec JSON is recorded, not thrown', () => {
    const root = mkTmp();
    writeTree(root, { 'pages/index.view.json': '{ this is not json' });
    const facts = viewFacts(root);
    expect(facts.malformed).toHaveLength(1);
    expect(facts.malformed[0].file).toBe('pages/index.view.json');
    expect(facts.specRoutes).toEqual([]);
  });

  it('a spec with no `sections` array is malformed, not silently accepted', () => {
    const root = mkTmp();
    writeTree(root, { 'pages/index.view.json': { title: 'Home' } });
    const facts = viewFacts(root);
    expect(facts.malformed).toHaveLength(1);
    expect(facts.malformed[0].message).toMatch(/sections/);
  });

  it('components: a valid one is listed by name+props; a malformed one (no `node`) is recorded', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/index.view.json': { sections: [{ kind: 'list', query: 'x' }] },
      'pages/components/PlantCard.view.json': { node: { type: 'card' }, props: { plant: 'object', onWater: 'action' } },
      'pages/components/Broken.view.json': { props: {} }, // no `node`
    });
    const facts = viewFacts(root);
    expect(facts.components).toEqual([{ name: 'PlantCard', props: ['plant', 'onWater'] }]);
    expect(facts.malformed.some((m) => m.file === 'pages/components/Broken.view.json')).toBe(true);
  });

  it('shell: authored + derivable when routes are within the bound, nav/groups/destinationCount recorded', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/index.view.json': { sections: [{ kind: 'list', query: 'x' }] },
      'pages/settings.view.json': { sections: [{ kind: 'list', query: 'y' }] },
      'pages/_shell.view.json': {
        brand: 'Plant Care',
        nav: [{ route: 'index' }, { route: 'settings' }],
        groups: [{ label: 'Home', home: 'index', routes: ['index'] }],
      },
    });
    const facts = viewFacts(root);
    expect(facts.shell.authored).toBe(true);
    expect(facts.shell.brand).toBe('Plant Care');
    expect(facts.shell.nav).toEqual(['index', 'settings']);
    expect(facts.shell.groups).toEqual([{ label: 'Home', home: 'index', routes: ['index'] }]);
    expect(facts.shell.destinationCount).toBe(1); // groups present ⇒ counted over groups, not raw nav
    expect(facts.shell.derivable).toBe(true); // 2 top-level static routes ≤ SHELL_DERIVE_MAX_ROUTES
  });

  it('shell: not authored ⇒ derivable reported against the actual route count, no shell block claimed', () => {
    const root = mkTmp();
    writeTree(root, { 'pages/index.view.json': { sections: [{ kind: 'list', query: 'x' }] } });
    const facts = viewFacts(root);
    expect(facts.shell.authored).toBe(false);
    expect(facts.shell.topLevelStaticRoutes).toBe(1);
  });

  it('handAuthoredPages lists every .tsx/.jsx across both v2 and v1 dirs, sorted', () => {
    const root = mkTmp();
    writeTree(root, {
      'views/index.view.json': { sections: [{ kind: 'list', query: 'x' }] },
      'pages/legacy.tsx': handAuthoredPage('legacy'),
      'views/stray.jsx': handAuthoredPage('stray'),
    });
    const facts = viewFacts(root);
    expect(facts.handAuthoredPages).toEqual(['pages/legacy.tsx', 'views/stray.jsx']);
  });

  it('endpointCount is null when opts.endpoints is not an array (never a guessed 0)', () => {
    const root = mkTmp();
    writeTree(root, { 'pages/index.view.json': { sections: [{ kind: 'list', query: 'x' }] } });
    expect(viewFacts(root).endpointCount).toBeNull();
    expect(viewFacts(root, { endpoints: null }).endpointCount).toBeNull();
    expect(viewFacts(root, { endpoints: [] }).endpointCount).toBe(0);
  });

  it('a `create` section not declaring its own `fields` is recorded — the Wave-2 empty-form class of fact', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/new.view.json': { sections: [{ kind: 'create', mutation: 'createThing' }] },
    });
    const facts = viewFacts(root);
    expect(facts.routes.new.sections[0].declaresFields).toBe(false);
  });
});

// ── viewShapes — the T3 "real shapes" derived from routes ─────────────────────────────────────────
describe('viewShapes', () => {
  it('null in, null out', () => {
    expect(viewShapes(null)).toBeNull();
  });

  it('detects a dashboard (stats + 2+ lists), a master-detail pair, prefill/async creates, timelines, chats, polls', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/index.view.json': {
        sections: [{ kind: 'stats' }, { kind: 'list', query: 'listA' }, { kind: 'list', query: 'listB' }],
      },
      'pages/plants.view.json': { sections: [{ kind: 'list', query: 'listPlants' }] },
      'pages/plants/[id].view.json': {
        sections: [{ kind: 'detail', query: 'getPlant' }, { kind: 'timeline', query: 'getHistory' }],
      },
      'pages/plants/new.view.json': {
        sections: [{ kind: 'create', mutation: 'createPlant', prefill: { endpoint: 'draftPlant', from: 'query', merge: 'shallow' } }],
      },
      'pages/jobs/new.view.json': {
        sections: [
          { kind: 'create', mutation: 'startJob', async: { note: 'takes a minute', refetchAfter: 'jobStatus' } },
          { kind: 'detail', query: 'jobStatus', poll: { everyMs: 2000, while: { field: 'status', in: ['queued', 'running'] } } },
        ],
      },
      'pages/help.view.json': { sections: [{ kind: 'chat', agent: 'plant-helper' }] },
    });
    const facts = viewFacts(root);
    const shapes = viewShapes(facts);
    expect(shapes.dashboards).toEqual(['index']);
    expect(shapes.masterDetail).toEqual([{ list: 'plants', detail: 'plants/[id]' }]);
    expect(shapes.prefillCreates).toEqual(['plants/new']);
    expect(shapes.asyncCreates).toEqual(['jobs/new']);
    expect(shapes.timelines).toEqual(['plants/[id]']);
    expect(shapes.chats).toEqual(['help']);
    expect(shapes.polls).toEqual([
      { route: 'jobs/new', section: 1, kind: 'detail', everyMs: 2000, whileField: 'status', whileIn: ['queued', 'running'] },
    ]);
  });

  it('a detail page whose parent is NOT a list does not count as master-detail', () => {
    const root = mkTmp();
    writeTree(root, {
      'pages/plants.view.json': { sections: [{ kind: 'stats' }] }, // no `list` kind
      'pages/plants/[id].view.json': { sections: [{ kind: 'detail', query: 'getPlant' }] },
    });
    const shapes = viewShapes(viewFacts(root));
    expect(shapes.masterDetail).toEqual([]);
  });
});

// ── compactViewFacts ────────────────────────────────────────────────────────────────────────────
describe('compactViewFacts', () => {
  it('null facts + no native ⇒ undefined (so the caller adds no key at all)', () => {
    expect(compactViewFacts(null)).toBeUndefined();
    expect(compactViewFacts(undefined)).toBeUndefined();
  });

  it('null facts + a native probe ⇒ just {native}', () => {
    const native = { status: 200, viewCount: 0, wouldRenderNatively: false };
    expect(compactViewFacts(null, native)).toEqual({ native });
  });

  it('projects a full facts object down to the judge-sized shape, with native folded in', () => {
    const root = mkTmp();
    writeTree(root, {
      'views/index.view.json': { sections: [{ kind: 'list', query: 'listThings' }] },
    });
    const facts = viewFacts(root, { endpoints: [{ name: 'listThings' }] });
    const native = { status: 200, viewCount: 1, wouldRenderNatively: true };
    const compact = compactViewFacts(facts, native);
    expect(compact.specCount).toBe(1);
    expect(compact.specRoutes).toEqual(['index']);
    expect(compact.endpointCount).toBe(1);
    expect(compact.sectionKinds).toEqual({ index: ['list'] });
    expect(compact.handAuthoredPages).toEqual([]);
    expect(compact.native).toBe(native);
  });
});

// ── nativeViewFacts — the pod-side twin, never throws ──────────────────────────────────────────
describe('nativeViewFacts', () => {
  it('a healthy 200 payload: counts views/components/endpoints, flags missing input schemas', async () => {
    const pod = {
      req: async () => ({
        status: 200,
        body: {
          views: [{ route: '/index' }, { route: '/plants' }],
          components: [{ name: 'PlantCard' }],
          shell: { brand: 'x' },
          endpoints: { listThings: { inputSchema: null }, createThing: { inputSchema: {} } },
        },
      }),
    };
    const facts = await nativeViewFacts(pod, 'plant-care');
    expect(facts.status).toBe(200);
    expect(facts.viewCount).toBe(2);
    expect(facts.routes).toEqual(['/index', '/plants']);
    expect(facts.componentCount).toBe(1);
    expect(facts.shellPresent).toBe(true);
    expect(facts.endpointCount).toBe(2);
    expect(facts.endpointsWithInputSchema).toBe(1); // only createThing has one
    expect(facts.wouldRenderNatively).toBe(true);
  });

  it('a 404 (older pod / no views route) ⇒ recorded, not thrown, wouldRenderNatively false', async () => {
    const pod = { req: async () => ({ status: 404, body: { error: 'not found' } }) };
    const facts = await nativeViewFacts(pod, 'plant-care');
    expect(facts.status).toBe(404);
    expect(facts.viewCount).toBe(0);
    expect(facts.wouldRenderNatively).toBe(false);
  });

  it('a transport failure is caught and recorded, never propagated', async () => {
    const pod = {
      req: async () => {
        throw new Error('fetch failed');
      },
    };
    const facts = await nativeViewFacts(pod, 'plant-care');
    expect(facts.status).toBeNull();
    expect(facts.error).toMatch(/fetch failed/);
    expect(facts.wouldRenderNatively).toBe(false);
  });
});

// ── live-fixture smoke: the REAL runs on disk, when present ────────────────────────────────────
// `scenarios/*/runs/` is gitignored — these are throwaway local output, not committed fixtures — so
// this whole block SKIPS rather than fails when a run isn't there (fresh clone, CI, a machine that
// never ran the scenario locally). Where it IS there, it is the strongest evidence this module works
// against the real thing rather than only against synthetic trees above.
function realRoot(...segs) {
  return join(SCENARIOS_DIR, ...segs);
}

describe('live fixtures — scenarios/*/runs on disk (skips silently if absent)', () => {
  const plantCare3 = realRoot('13-plant-care', 'runs', '3', 'data', '.lmthing', 'plant-care');
  it.skipIf(!existsSync(plantCare3))('13-plant-care run 3: real view-spec pages come back non-null with the expected route shape', () => {
    const facts = viewFacts(plantCare3);
    expect(facts).not.toBeNull();
    expect(facts.specRoutes).toContain('index');
    expect(facts.malformed).toEqual([]);
    // handAuthoredPages is always an array — a real spec run has no stray React pages.
    expect(Array.isArray(facts.handAuthoredPages)).toBe(true);
  });

  const plantCare1 = realRoot('13-plant-care', 'runs', '1', 'data', '.lmthing', 'plant-care');
  it.skipIf(!existsSync(plantCare1))('13-plant-care run 1 (pre-pages step): null, not a crash', () => {
    expect(viewFacts(plantCare1)).toBeNull();
  });

  // The regression this fix targets: a REAL appbuilder-TSX run (06-tanzania) must be null, proving
  // the "06-10 pay nothing" claim now actually holds against real recorded evidence, not just the
  // synthetic case above.
  for (const [scenario, project] of [
    ['06-tanzania', 'tanzania-trip'],
    ['07-life-admin', 'home-insurance'],
    ['08-small-shop', 'yuki-s-studio'],
  ]) {
    const runsDir = realRoot(scenario, 'runs');
    const latestRunId = existsSync(runsDir)
      ? [...new Set((tryReaddir(runsDir) ?? []).filter((e) => /^\d+$/.test(e)))].map(Number).sort((a, b) => b - a)[0]
      : undefined;
    const root = latestRunId != null ? realRoot(scenario, 'runs', String(latestRunId), 'data', '.lmthing', project) : null;
    it.skipIf(!root || !existsSync(join(root, 'pages')))(`${scenario} (appbuilder-TSX, real run): pages/ exists but viewFacts is null`, () => {
      expect(viewFacts(root)).toBeNull();
    });
  }
});

function tryReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}
