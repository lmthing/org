/**
 * view-facts.mjs — the VIEW-SPEC observables a step snapshot was missing.
 *
 * `snapshot()` recorded spaces, `appTables`, `appManifest`, delegates, yields, errors and the reply
 * — and nothing whatsoever about view specs. So every `expect` in the T3 scenarios (`11-clinic`,
 * `12-rentals`) about a `timeline` section, a `prefill` block, a `poll.while`, or an endpoint count
 * degraded to prose the judge had to take on faith, or go and read off disk itself — which it does
 * inconsistently or not at all.
 *
 * Everything here is DERIVED FROM ARTIFACTS, never from a model's account of them:
 *
 *  - v2 specs on disk (`views/**\/*.view.json`, `components/*.view.json`, `shell.view.json`);
 *  - v1 `pages/**\/*.view.json` artifacts, which remain readable for compatibility;
 *  - the numeric shell-navigation bound read from product source, never retyped here.
 *
 * **Cheap by construction.** This runs at the end of every step, so it is synchronous local-disk
 * reads only: a recursive `readdir` walk of the spec directories and a `JSON.parse` per spec. A
 * project with no view artifacts returns null, so legacy TSX apps pay nothing.
 *
 * The pod-side twin (`GET /api/apps/:id/views`) is `nativeViewFacts` — the one asynchronous function
 * here, and the only place the harness reaches the shared renderer's transport at all.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SDK_ORG } from './paths.mjs';

// ── constants read out of the product, never retyped ────────────────────────────────────────────

/** Where each borrowed constant lives, and how to find it in that file. */
const CONSTANT_SOURCES = {
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
 * default. A check that depends on a null constant reports itself unmeasured rather than guessing
 * a product value.
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
/** A hand-authored React page — never emitted by the spec pipeline, so its presence in a spec app
 *  is the "web-only page" regression this fact exists to surface. */
const PAGE_EXT = /\.(tsx|jsx)$/;
/** `files.ts#walkViewFiles` skips component definitions while walking a spec tree. */
const SKIP_DIRS = new Set(['components', 'lib']);

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** Every route-bearing view file under one spec directory. */
function walk(specDir, dir, test, out) {
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
      walk(specDir, abs, test, out);
      continue;
    }
    if (!test(entry.name)) continue;
    if (entry.name.startsWith('_')) continue;
    out.push(abs);
  }
}

/** `<views>/recipes/[id].view.json` → `recipes/[id]` (the AUTHORING route, as persisted). */
function authoringRoute(specDir, abs, ext) {
  const rel = relative(specDir, abs);
  return rel.slice(0, rel.length - ext.length).split(sep).join('/');
}

/** `recipes/[id]` → `/recipes/:id`; `index` → `/`. Mirrors `pages.ts#routePathFor`. */
export function servedPath(route) {
  const segs = route.split('/').filter(Boolean);
  if (segs[segs.length - 1] === 'index') segs.pop();
  return '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/');
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
 * Every view-spec fact derivable from one project directory. V2 locations win on duplicate routes,
 * matching `loadProjectViews`; v1 locations remain visible only for compatibility.
 *
 * @param {string} projectRoot  `<dataDir>/.lmthing/<projectId>`
 * @param {{ endpoints?: Array<{name?:string}>|null, sdkRoot?: string }} [opts]
 */
export function viewFacts(projectRoot, { endpoints = null, sdkRoot = SDK_ORG } = {}) {
  const v2Dir = join(projectRoot, 'views');
  const v1Dir = join(projectRoot, 'pages');
  const sources = [
    { dir: v2Dir, prefix: 'views' },
    { dir: v1Dir, prefix: 'pages' },
  ];
  const malformed = [];
  const routes = {};
  const seen = new Set();

  for (const { dir, prefix } of sources) {
    const specFiles = [];
    walk(dir, dir, (name) => name.endsWith(VIEW_EXT), specFiles);
    for (const abs of specFiles.sort()) {
      const route = authoringRoute(dir, abs, VIEW_EXT);
      if (seen.has(route)) continue;
      const { value: spec, error } = parseJsonFile(abs);
      if (error) {
        malformed.push({ file: `${prefix}/${route}${VIEW_EXT}`, message: error });
        continue;
      }
      if (!spec || typeof spec !== 'object' || !Array.isArray(spec.sections)) {
        malformed.push({ file: `${prefix}/${route}${VIEW_EXT}`, message: 'not a view spec (needs a `sections` array)' });
        continue;
      }
      seen.add(route);
      routes[route] = {
        layout: spec.layout ?? null,
        title: spec.title ?? null,
        ...(spec.route && spec.route !== route ? { routeFieldMismatch: spec.route } : {}),
        sections: spec.sections.map(sectionDigest),
      };
    }
  }

  const componentSources = [
    { dir: join(projectRoot, 'components'), prefix: 'components' },
    { dir: join(v1Dir, 'components'), prefix: 'pages/components' },
  ];
  const components = [];
  const seenComponents = new Set();
  for (const { dir, prefix } of componentSources) {
    for (const entry of readdirSafe(dir) ?? []) {
      if (!entry.isFile() || !entry.name.endsWith(VIEW_EXT)) continue;
      const name = entry.name.slice(0, -VIEW_EXT.length);
      if (seenComponents.has(name)) continue;
      const { value: def, error } = parseJsonFile(join(dir, entry.name));
      if (error || !def || typeof def !== 'object' || def.node === undefined || def.node === null) {
        malformed.push({ file: `${prefix}/${entry.name}`, message: error ?? 'not a view component (needs a `node`)' });
        continue;
      }
      seenComponents.add(name);
      components.push({ name, props: Object.keys(def.props ?? {}) });
    }
  }

  const shellSources = [
    { path: join(projectRoot, `shell${VIEW_EXT}`), file: `shell${VIEW_EXT}` },
    { path: join(v1Dir, `_shell${VIEW_EXT}`), file: `pages/_shell${VIEW_EXT}` },
  ];
  const shellSource = shellSources.find(({ path }) => existsSync(path));
  const K = productConstants({ root: sdkRoot });
  const topLevelStatic = new Set(Object.keys(routes).filter((route) => !route.includes('[') && !route.includes('/')));
  let shell = {
    authored: false,
    derivable: topLevelStatic.size <= (K.shellDeriveMaxRoutes ?? Infinity),
    topLevelStaticRoutes: topLevelStatic.size,
  };
  if (shellSource) {
    const { value: sh, error } = parseJsonFile(shellSource.path);
    if (error || !sh || typeof sh !== 'object') {
      malformed.push({ file: shellSource.file, message: error ?? 'not an object' });
    } else {
      const navRoutes = (sh.nav ?? []).map((nav) => nav.route).filter(Boolean);
      const groups = (sh.groups ?? []).map((group) => ({
        label: group.label ?? null,
        home: group.home ?? null,
        routes: group.routes ?? [],
      }));
      shell = {
        ...shell,
        authored: true,
        brand: sh.brand ?? null,
        nav: navRoutes,
        groups,
        subnav: (sh.subnav ?? []).map((subnav) => subnav.match).filter(Boolean),
        assistant: sh.assistant?.agent ?? null,
        placement: sh.placement ?? null,
        destinationCount: groups.length || navRoutes.length,
      };
    }
  }

  // Bail to null (a non-viewbuilder app) only when NOTHING view-spec-shaped was found. A malformed
  // spec/component still counts as "the pipeline touched this project" — dropping it here would bury
  // exactly the broken artifact the harness exists to surface, reporting the app as never-built.
  if (Object.keys(routes).length === 0 && components.length === 0 && !shellSource && malformed.length === 0) return null;

  const handAuthoredPages = [];
  for (const { dir, prefix } of sources) {
    const files = [];
    walk(dir, dir, (name) => PAGE_EXT.test(name), files);
    handAuthoredPages.push(...files.map((file) => `${prefix}/${relative(dir, file).split(sep).join('/')}`));
  }
  const kindCounts = {};
  for (const route of Object.values(routes)) {
    for (const section of route.sections) kindCounts[section.kind ?? '?'] = (kindCounts[section.kind ?? '?'] ?? 0) + 1;
  }

  return {
    specRoutes: Object.keys(routes).sort(),
    components,
    shell,
    kindCounts,
    malformed,
    handAuthoredPages: handAuthoredPages.sort(),
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
    // A spec app has NO hand-authored React pages — the whole promise is that no page is web-only.
    // A non-empty list here is the "a `.tsx` slipped into a spec app" regression (the successor to
    // the old wrapper-banner check, now that there are no generated wrappers to inspect).
    handAuthoredPages: facts.handAuthoredPages,
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
