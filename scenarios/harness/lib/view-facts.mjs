/**
 * view-facts.mjs — the VIEW-SPEC observables a step snapshot was missing.
 *
 * `snapshot()` recorded spaces, `appTables`, `appManifest`, delegates, yields, errors and the reply
 * — and nothing whatsoever about view specs. So every `expect` in the T3 scenarios (`11-clinic`,
 * `12-rentals`) about a `timeline` section, a `prefill` block, a `poll.while`, the generated-wrapper
 * banner or an endpoint count degraded to prose the judge had to take on faith, or go and read off
 * disk itself — which it does inconsistently or not at all.
 *
 * Everything here is DERIVED FROM ARTIFACTS, never from a model's account of them:
 *
 *  - the specs on disk (`pages/**\/*.view.json`, `pages/components/*.view.json`,
 *    `pages/_shell.view.json`) — the layout is `libs/cli/src/app/view-spec/files.ts`'s;
 *  - the generated wrappers (`pages/**\/*.tsx`) — the routes the pages BUILD discovers, per
 *    `libs/cli/src/app/build/pages.ts#walkPages`;
 *  - two literal strings and one numeric bound READ OUT OF THE PRODUCT SOURCE
 *    ({@link productConstants}), never retyped here: a harness that carries its own copy of the
 *    wrapper banner goes quietly green the day the banner is reworded.
 *
 * **Cheap by construction.** This runs at the end of every step, so it is synchronous local-disk
 * reads only: one `readdir` walk of `pages/`, a `JSON.parse` per spec, and the FIRST FEW HUNDRED
 * BYTES of each wrapper `.tsx` (a wrapper inlines the whole spec — reading them whole would be the
 * expensive mistake). A project with no `pages/` dir costs one failed `readdir` and returns null, so
 * scenarios 06–10 pay nothing and their step evidence is byte-identical to before.
 *
 * The pod-side twin (`GET /api/apps/:id/views`, the NATIVE transport) is `nativeViewFacts` — the one
 * asynchronous function here, and the only place the harness reaches the native path at all.
 */
import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SDK_ORG } from './paths.mjs';

// ── constants read out of the product, never retyped ────────────────────────────────────────────

/** Where each borrowed constant lives, and how to find it in that file. */
const CONSTANT_SOURCES = {
  // `renderViewWrapper` opens every generated page with this line. A hand-written page that renders
  // is still a failure — the whole promise is that no page of a viewbuilder app is web-only.
  wrapperBanner: {
    file: 'libs/cli/src/app/view-spec/wrapper.ts',
    // The first occurrence inside the template literal `renderViewWrapper` returns.
    re: /^\s*\*?\s*(AUTO-GENERATED[^\n*]*?)\s*$/m,
  },
  // What `SchemaForm` renders when the endpoint's Input schema derived ZERO fields — the exact
  // Wave-2 "every form in every app" bug, which `appCheck` passes cleanly.
  emptyFormSentinel: {
    file: 'libs/ui/src/view/form.tsx',
    re: /fields\.length === 0[\s\S]{0,400}?>\s*\n\s*([^\n<>{}]+?)\s*\n\s*<\/Prim\.Text>/,
  },
  // Above this many top-level static routes the renderer stops deriving a nav, so an authored shell
  // is FORCED rather than an override — the distinction the layout-override metric needs.
  shellDeriveMaxRoutes: {
    file: 'libs/cli/src/app/view-spec/schema.ts',
    re: /export const SHELL_DERIVE_MAX_ROUTES\s*=\s*(\d+)/,
    number: true,
  },
};

let constantsCache = null;

/**
 * The product's own strings/bounds, extracted from source on first use.
 *
 * A constant that cannot be extracted comes back `null` WITH a `missing` entry — never a guessed
 * default. A check that depends on a null constant reports itself unmeasured (see
 * {@link viewFacts}'s `wrapperBanners: null`), because a banner check that silently passes when it
 * cannot find the banner is worse than no check at all.
 */
export function productConstants({ root = SDK_ORG, fresh = false } = {}) {
  if (constantsCache && !fresh) return constantsCache;
  const out = { missing: [] };
  for (const [key, spec] of Object.entries(CONSTANT_SOURCES)) {
    let value = null;
    try {
      const m = spec.re.exec(readFileSync(join(root, spec.file), 'utf8'));
      if (m) value = spec.number ? Number(m[1]) : m[1];
    } catch {
      /* source not readable from here — recorded as missing below */
    }
    if (value === null || value === undefined || (spec.number && !Number.isFinite(value))) {
      out.missing.push(`${key} (${spec.file})`);
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  constantsCache = out;
  return out;
}

// ── the on-disk walk ───────────────────────────────────────────────────────────────────────────

const VIEW_EXT = '.view.json';
const PAGE_EXT = /\.(tsx|jsx)$/;
/** `files.ts#walkViewFiles` and `pages.ts#walkPages` skip the same dirs — keep them in step. */
const SKIP_DIRS = new Set(['components', 'lib']);

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** Every route-bearing file under `pages/`, by extension test. Mirrors both product walkers. */
function walk(pagesDir, dir, test, out) {
  for (const entry of readdirSafe(dir) ?? []) {
    const abs = join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      walk(pagesDir, abs, test, out);
      continue;
    }
    if (!test(entry.name)) continue;
    if (entry.name.startsWith('_')) continue;
    out.push(abs);
  }
}

/** `<pages>/recipes/[id].view.json` → `recipes/[id]` (the AUTHORING route, as persisted). */
function authoringRoute(pagesDir, abs, ext) {
  const rel = relative(pagesDir, abs);
  return rel.slice(0, rel.length - ext.length).split(sep).join('/');
}

/** `recipes/[id]` → `/recipes/:id`; `index` → `/`. Mirrors `pages.ts#routePathFor`. */
export function servedPath(route) {
  const segs = route.split('/').filter(Boolean);
  if (segs[segs.length - 1] === 'index') segs.pop();
  return '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/');
}

/** Read only the head of a file — a wrapper inlines its whole spec, so never read it all. */
function readHead(abs, bytes = 400) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function parseJsonFile(abs) {
  try {
    return { value: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// ── section digests ────────────────────────────────────────────────────────────────────────────

/** The ONE endpoint a section reads or writes — the view-shaped-endpoint rule, per section. */
function sectionEndpoint(s) {
  return s.query ?? s.mutation ?? null;
}

/**
 * One section, reduced to what an `expect` can be scored against.
 *
 * Deliberately NOT the whole section: the full specs are on disk in the run's own snapshot, and the
 * step evidence has to stay judge-sized. What survives is every fact the two T3 scenarios assert —
 * the kind, its endpoint, and the four sourcing/behaviour blocks (`poll`, `prefill`, `async`,
 * `group`) whose PRESENCE and CONTENTS are the assertion.
 */
function sectionDigest(s) {
  const d = { kind: s.kind ?? null };
  const ep = sectionEndpoint(s);
  if (ep) d.endpoint = ep;
  if (s.title) d.title = String(s.title).slice(0, 80);
  if (s.id) d.id = s.id;
  if (s.kind === 'list' && s.layout) d.listLayout = s.layout;
  if (s.kind === 'chat' && s.agent) d.agent = s.agent;
  if (s.group !== undefined) d.group = typeof s.group === 'string' ? s.group : (s.group?.field ?? true);
  if (s.prefill) {
    d.prefill = { endpoint: s.prefill.endpoint ?? null, from: s.prefill.from ?? null, merge: s.prefill.merge ?? null };
  }
  // A `create` section MAY NOT declare `fields` (schema: `additionalProperties:false`) — the form
  // derives from the mutation's Input contract. Recorded anyway so an `expect` asserting "declares
  // NO fields of its own" is scored on the artifact rather than on the schema's reputation.
  if (s.kind === 'create') d.declaresFields = Object.prototype.hasOwnProperty.call(s, 'fields');
  if (s.async) d.async = { note: s.async.note ?? null, refetchAfter: s.async.refetchAfter ?? null };
  if (s.poll) {
    d.poll = {
      everyMs: s.poll.everyMs ?? null,
      // `while.in` IS the assertion in both scenarios ("a `poll` whose `while` names exactly the
      // non-terminal job statuses"), so it is carried verbatim.
      whileField: s.poll.while?.field ?? null,
      whileIn: s.poll.while?.in ?? null,
    };
  }
  if (Array.isArray(s.reveals) && s.reveals.length) d.reveals = s.reveals;
  if (s.rowAction) d.rowAction = true;
  return d;
}

// ── the facts ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every view-spec fact derivable from one project directory, or `null` when the project has no
 * `pages/` dir at all, OR (see the FIX note below) when that `pages/` dir has not one `.view.json`
 * anywhere in it — a project the view-spec pipeline never touched.
 *
 * Returns the RICH form — the runner stores it in `rec.state` (so it lands in
 * `step-NN.full.json` for drill-down) and `compactViewFacts` reduces it for `step-NN.json`.
 *
 * FIX (found while wiring this into `snapshot()`): the module originally bailed to `null` only on a
 * missing `pages/` dir, and claimed on that basis that "scenarios 06–10 pay nothing". False — every
 * real run under `06-tanzania/07-life-admin/08-small-shop/09-home-renovation/10-family-recipes`
 * DOES have a `pages/` dir (the OLD appbuilder pipeline writes `.tsx` straight into it), so the old
 * code fell through to a full facts object every time, reporting `wrapperBannersOk:false` and every
 * route in `handAuthoredPages` — which reads as "the wrapper-banner regression this module exists to
 * catch" when it is really just a non-viewbuilder app doing exactly what it is supposed to do. Bailing
 * on "zero `.view.json` anywhere" (no page spec, no component, no shell) instead of "no `pages/` dir"
 * restores the "06–10 pay nothing" invariant for real and stops that false signal from ever landing in
 * evidence a judge might read.
 *
 * @param {string} projectRoot  `<dataDir>/.lmthing/<projectId>`
 * @param {{ endpoints?: Array<{name?:string}>|null, sdkRoot?: string }} [opts]
 *   `endpoints` is the app manifest's own endpoint list — already fetched by `snapshot`, so the
 *   endpoint count costs nothing extra.
 */
export function viewFacts(projectRoot, { endpoints = null, sdkRoot = SDK_ORG } = {}) {
  const pagesDir = join(projectRoot, 'pages');
  if (!existsSync(pagesDir)) return null;

  const specFiles = [];
  walk(pagesDir, pagesDir, (n) => n.endsWith(VIEW_EXT), specFiles);
  const componentsDir = join(pagesDir, 'components');
  const componentEntries = (readdirSafe(componentsDir) ?? []).filter((e) => e.isFile() && e.name.endsWith(VIEW_EXT));
  const shellPath = join(pagesDir, `_shell${VIEW_EXT}`);
  const shellExists = existsSync(shellPath);
  // No spec, no component, no shell ⇒ this `pages/` dir was never authored through the view-spec
  // pipeline at all (see the FIX note above) — bail before the pricier wrapper-head reads and the
  // product-source scan, same as the no-`pages/`-dir case.
  if (specFiles.length === 0 && componentEntries.length === 0 && !shellExists) return null;

  const K = productConstants({ root: sdkRoot });

  const wrapperFiles = [];
  walk(pagesDir, pagesDir, (n) => PAGE_EXT.test(n), wrapperFiles);

  const malformed = [];
  const routes = {};
  for (const abs of specFiles.sort()) {
    const route = authoringRoute(pagesDir, abs, VIEW_EXT);
    const { value: spec, error } = parseJsonFile(abs);
    if (error) {
      malformed.push({ file: `pages/${route}${VIEW_EXT}`, message: error });
      continue;
    }
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.sections)) {
      malformed.push({ file: `pages/${route}${VIEW_EXT}`, message: 'not a view spec (needs a `sections` array)' });
      continue;
    }
    routes[route] = {
      // `layout` ABSENT is the healthy case — the renderer predicts the archetype. Present means the
      // model overrode the prediction, which is the plan's layout-override ratchet metric.
      layout: spec.layout ?? null,
      title: spec.title ?? null,
      // The spec's own `route` field is recorded ONLY when it disagrees with the file path: the file
      // path is the route of record everywhere (writer, build, spec-fetch route), so a divergence is
      // a real defect and not a stylistic note.
      ...(spec.route && spec.route !== route ? { routeFieldMismatch: spec.route } : {}),
      sections: spec.sections.map(sectionDigest),
    };
  }

  // ── components + shell ───────────────────────────────────────────────────────────────────────
  // `componentsDir`/`componentEntries`/`shellPath`/`shellExists` were already computed above, for the
  // early-bail check — reused here rather than re-walked.
  const components = [];
  for (const entry of componentEntries) {
    const name = entry.name.slice(0, -VIEW_EXT.length);
    const { value: def, error } = parseJsonFile(join(componentsDir, entry.name));
    if (error || !def || typeof def !== 'object' || def.node === undefined || def.node === null) {
      malformed.push({ file: `pages/components/${entry.name}`, message: error ?? 'not a view component (needs a `node`)' });
      continue;
    }
    components.push({ name, props: Object.keys(def.props ?? {}) });
  }

  // AUTHORED means the file exists. `derivable` says whether the renderer COULD have derived a nav
  // (≤ SHELL_DERIVE_MAX_ROUTES top-level static routes) — which is what separates a real override
  // from a forced one. T1's single shell override was forced (13 routes ≫ 5), and the metric has to
  // be able to say so.
  const topLevelStatic = new Set(
    Object.keys(routes)
      .filter((r) => !r.includes('[') && !r.includes('/'))
      .map((r) => r),
  );
  let shell = { authored: false, derivable: topLevelStatic.size <= (K.shellDeriveMaxRoutes ?? Infinity), topLevelStaticRoutes: topLevelStatic.size };
  if (shellExists) {
    const { value: sh, error } = parseJsonFile(shellPath);
    if (error || !sh || typeof sh !== 'object') {
      malformed.push({ file: `pages/_shell${VIEW_EXT}`, message: error ?? 'not an object' });
    } else {
      const navRoutes = (sh.nav ?? []).map((n) => n.route).filter(Boolean);
      const groups = (sh.groups ?? []).map((g) => ({ label: g.label ?? null, home: g.home ?? null, routes: g.routes ?? [] }));
      shell = {
        ...shell,
        authored: true,
        brand: sh.brand ?? null,
        nav: navRoutes,
        groups,
        subnav: (sh.subnav ?? []).map((s) => s.match).filter(Boolean),
        assistant: sh.assistant?.agent ?? null,
        placement: sh.placement ?? null,
        // Grouped nav is the T0 finding: 4/5 catalogue apps hand-group 13–21 routes into 4–6
        // destinations, so a flat list at this size is an unusable phone tab bar.
        destinationCount: groups.length || navRoutes.length,
      };
    }
  }

  // ── wrappers: the banner, and the routes with no spec ────────────────────────────────────────
  const banner = K.wrapperBanner;
  const wrappers = [];
  for (const abs of wrapperFiles.sort()) {
    const route = authoringRoute(pagesDir, abs, abs.endsWith('.jsx') ? '.jsx' : '.tsx');
    const head = readHead(abs);
    wrappers.push({
      route,
      file: `pages/${relative(pagesDir, abs).split(sep).join('/')}`,
      generated: banner && head != null ? head.includes(banner) : null,
      hasSpec: Object.prototype.hasOwnProperty.call(routes, route),
    });
  }

  const specRoutes = Object.keys(routes).sort();
  const wrapperRoutes = wrappers.map((w) => w.route);
  const offenders = wrappers.filter((w) => w.generated === false).map((w) => w.file);
  const unreadable = wrappers.filter((w) => w.generated === null).map((w) => w.file);

  const kindCounts = {};
  for (const r of Object.values(routes)) for (const s of r.sections) kindCounts[s.kind ?? '?'] = (kindCounts[s.kind ?? '?'] ?? 0) + 1;

  return {
    specRoutes,
    components,
    shell,
    wrappers,
    kindCounts,
    malformed,
    /** A `.tsx` route the pages build serves that has NO spec — the app is web-only THERE. */
    routesWithoutSpec: wrapperRoutes.filter((r) => !Object.prototype.hasOwnProperty.call(routes, r)).sort(),
    /** A spec with no wrapper — the page will not build at all until a view/component/shell write re-emits. */
    specsWithoutWrapper: specRoutes.filter((r) => !wrapperRoutes.includes(r)),
    wrapperBanners:
      banner == null
        ? null // constant unextractable ⇒ UNMEASURED, never a silent pass
        : { banner, total: wrappers.length, ok: wrappers.length - offenders.length - unreadable.length, offenders, unreadable },
    routes,
    endpointCount: Array.isArray(endpoints) ? endpoints.length : null,
    constantsMissing: K.missing.length ? K.missing : undefined,
  };
}

// ── derived shapes the two T3 scenarios assert by NAME ──────────────────────────────────────────

/**
 * The four "REAL SHAPES" the eight-page floor must be met by, plus the boundary facts — computed
 * once, from the specs, so the judge scores a list of routes instead of re-deriving a rule.
 *
 * Every one of these is an `expect` in both `11-clinic` and `12-rentals`, worded almost identically
 * ("a dashboard (a `stats` section over several lists)", "a master-detail pair over the same data",
 * "a `create` section carrying `prefill`", "a `create` section carrying `async`, plus a status
 * surface carrying `poll` whose `while` names the non-terminal statuses").
 */
export function viewShapes(facts) {
  if (!facts) return null;
  const entries = Object.entries(facts.routes);
  const kinds = (r) => r.sections.map((s) => s.kind);
  const has = (r, k) => kinds(r).includes(k);
  const count = (r, k) => kinds(r).filter((x) => x === k).length;

  const dashboards = entries.filter(([, r]) => has(r, 'stats') && count(r, 'list') >= 2).map(([route]) => route);
  const prefillCreates = entries
    .filter(([, r]) => r.sections.some((s) => s.kind === 'create' && s.prefill))
    .map(([route]) => route);
  const asyncCreates = entries.filter(([, r]) => r.sections.some((s) => s.kind === 'create' && s.async)).map(([route]) => route);
  const timelines = entries.filter(([, r]) => has(r, 'timeline')).map(([route]) => route);
  const chats = entries.filter(([, r]) => has(r, 'chat')).map(([route]) => route);
  const polls = [];
  for (const [route, r] of entries) {
    r.sections.forEach((s, i) => {
      if (s.poll) polls.push({ route, section: i, kind: s.kind, ...s.poll });
    });
  }

  // A master-detail PAIR over the same data: a parameterised route carrying a `detail` section whose
  // parent route carries a `list`. Structural, so a "detail page" that is really another list, or a
  // detail page whose list parent does not exist, does not count.
  const masterDetail = [];
  for (const [route, r] of entries) {
    if (!/\[[^\]]+\]/.test(route) || !has(r, 'detail')) continue;
    const parent = route.replace(/\/?\[[^\]]+\]$/, '');
    const parentSpec = facts.routes[parent] ?? facts.routes[`${parent}/index`] ?? (parent === '' ? facts.routes['index'] : undefined);
    if (parentSpec && kinds(parentSpec).includes('list')) masterDetail.push({ list: parent || 'index', detail: route });
  }

  const layoutOverrides = entries.filter(([, r]) => r.layout != null).map(([route, r]) => `${route}:${r.layout}`);

  return {
    dashboards,
    masterDetail,
    prefillCreates,
    asyncCreates,
    timelines,
    chats,
    polls,
    layoutOverrides,
  };
}

/**
 * The judge-sized projection — what `compactStep` writes into `step-NN.json`.
 *
 * Roughly one line per route plus the shape/boundary summary; the per-section digests stay in
 * `step-NN.full.json`. Field order is the byte-compat contract, exactly as in `evidence.mjs`.
 */
export function compactViewFacts(facts, native = null) {
  if (!facts) return native ? { native } : undefined;
  const shapes = viewShapes(facts);
  const wb = facts.wrapperBanners;
  return {
    specCount: facts.specRoutes.length,
    specRoutes: facts.specRoutes,
    componentCount: facts.components.length,
    componentNames: facts.components.map((c) => c.name),
    shellAuthored: facts.shell.authored,
    shellDerivable: facts.shell.derivable,
    shellDestinations: facts.shell.destinationCount ?? null,
    shellGrouped: (facts.shell.groups?.length ?? 0) > 0,
    endpointCount: facts.endpointCount,
    kindCounts: facts.kindCounts,
    // The author's suggested shape, kept verbatim: `{route: [sectionKinds]}` reads at a glance and is
    // what almost every section-level `expect` is scored against.
    sectionKinds: Object.fromEntries(Object.entries(facts.routes).map(([r, v]) => [r, v.sections.map((s) => s.kind)])),
    layoutOverrides: shapes.layoutOverrides,
    dashboards: shapes.dashboards,
    masterDetail: shapes.masterDetail,
    prefillCreates: shapes.prefillCreates,
    asyncCreates: shapes.asyncCreates,
    timelines: shapes.timelines,
    chatRoutes: shapes.chats,
    polls: shapes.polls,
    wrapperBannersOk: wb == null ? null : wb.offenders.length === 0 && wb.unreadable.length === 0 && wb.total > 0,
    wrapperCount: wb?.total ?? facts.wrappers.length,
    handAuthoredPages: wb?.offenders ?? null,
    routesWithoutSpec: facts.routesWithoutSpec,
    specsWithoutWrapper: facts.specsWithoutWrapper,
    malformed: facts.malformed.length ? facts.malformed : [],
    ...(facts.constantsMissing ? { constantsMissing: facts.constantsMissing } : {}),
    ...(native ? { native } : {}),
  };
}

// ── the native transport ───────────────────────────────────────────────────────────────────────

/**
 * `GET /api/apps/:id/views` — the route the mobile host branches on (`views.length > 0 ⇒ native`).
 *
 * Backs the `fetch_views` step verb and rides along in every snapshot of a project that HAS specs.
 * Nothing else in the harness touches the native path, so without this "the app opens in the native
 * path" is unassertable in a `scenario.yaml`; with it, it is `native.wouldRenderNatively`.
 *
 * Never throws: a 404 (older pod), a 500 or junk all resolve to a recorded status, because every one
 * of those is the mobile host falling back to a WebView — which is the fact worth recording.
 */
export async function nativeViewFacts(pod, projectId) {
  try {
    const r = await pod.req('GET', `/api/apps/${projectId}/views`, undefined, { raw: true });
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const views = Array.isArray(b.views) ? b.views : [];
    return {
      status: r.status,
      viewCount: views.length,
      routes: views.map((v) => v.route).filter(Boolean).sort(),
      componentCount: Array.isArray(b.components) ? b.components.length : null,
      shellPresent: b.shell != null,
      endpointCount: b.endpoints && typeof b.endpoints === 'object' ? Object.keys(b.endpoints).length : null,
      // A `create` form on native has NO second source for its fields: without the Input schema in
      // this payload every form on the phone is the Wave-2 "Nothing to fill in." bug by construction.
      endpointsWithInputSchema:
        b.endpoints && typeof b.endpoints === 'object'
          ? Object.values(b.endpoints).filter((e) => e && e.inputSchema != null).length
          : null,
      errors: Array.isArray(b.errors) && b.errors.length ? b.errors : undefined,
      endpointsError: b.endpointsError,
      /** The mobile host's own branch, evaluated here so a step can assert it directly. */
      wouldRenderNatively: r.status === 200 && views.length > 0,
    };
  } catch (e) {
    return { status: null, error: String(e?.message ?? e), wouldRenderNatively: false };
  }
}
