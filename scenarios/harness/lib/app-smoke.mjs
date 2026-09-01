/**
 * Does the built app actually WORK? — the gate the build pipeline does not have.
 *
 * Everything in `build_live_project` is static or in-process. `08-validate_contract` and
 * `11-reconcile_tables` read files. `13-smoke_endpoints` and `13a-check_acceptance` DO call
 * endpoints, but through `ctx.callProjectApi` — an in-process `callByName`, not a request; there is
 * no server and no socket. And `renderSmokeViews` mounts every view against live endpoint data, but
 * with `renderToStaticMarkup`: no DOM, no CSS, no layout engine. Its own docblock says the quiet part
 * out loud — "`emptyRender` … does NOT and cannot mean 'the user would see something'. Reading it as
 * the latter is how a blank app ships green."
 *
 * Three defects found by hand in a build scored at 84 `[error]` lines, each invisible to all of the
 * above, and each the reason for one step below:
 *
 *  1. `GET api/recipes/list` returned **500 on first paint** — a handler declaring one parameter
 *     (`handler(ctx)`) when the runtime calls `handler(input, ctx)`, so `ctx.db` was undefined. No
 *     render sees this; only a request does.                                    → `probeEndpoints`
 *  2. A list rendered **one blank row over two real records** — the endpoint wrapped its collection
 *     as `items: [{ ingredients: [...] }]`, so the section iterated ONE element (the wrapper) and
 *     bound `$.name` against an array. `emptyRender` never fires: the section is not empty, it has a
 *     row. "One blank row" is not "empty", and that is the hole.                 → `renderCheck`
 *  3. An edit form that **could never populate**.                                → `renderCheck`
 *
 * Honesty contract, inherited from `render-rig.mjs`: anything not measured reports `measured: false`
 * with a reason and a `null` verdict — never `0`, never `false`, and never silently a pass. A missing
 * browser makes the render half `unavailable`; it does not make the app good.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderCheck } from './render-rig.mjs';

/**
 * Find the project the app was actually built INTO.
 *
 * The harness creates `parallel-build-<n>` and hands it to THING, but THING creates a DEDICATED
 * project for the app (`recipe-box`) — building into the shared default is explicitly forbidden by
 * its own instructions. Pointing at the harness project finds an empty scaffold, and a gate that
 * measures nothing must never report a pass: this exact mistake made run 13 report `ok: true` with
 * `measured: 0` over a build that emitted 118 errors.
 *
 * `user` and `system` are never app projects.
 */
export function findAppProject(runtimeRoot) {
  if (!existsSync(runtimeRoot)) return null;
  const candidates = [];
  for (const entry of readdirSync(runtimeRoot)) {
    if (entry === 'user' || entry === 'system') continue;
    const dir = join(runtimeRoot, entry);
    if (!statSync(dir).isDirectory()) continue;
    const api = existsSync(join(dir, 'api')) ? readdirSync(join(dir, 'api')).length : 0;
    const views = existsSync(join(dir, 'views')) ? readdirSync(join(dir, 'views')).length : 0;
    if (api + views > 0) candidates.push({ id: entry, dir, weight: api + views });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0] ?? null;
}

/** Every `*.view.json` under `<projectRoot>/views`, as `{ route, file }`. */
export function readViewRoutes(projectRoot) {
  const root = join(projectRoot, 'views');
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.view.json')) continue;
      try {
        const spec = JSON.parse(readFileSync(full, 'utf8'));
        if (typeof spec?.route === 'string') out.push({ route: spec.route, file: relative(projectRoot, full) });
      } catch { /* a malformed spec is the writer's problem; it fails its own gate */ }
    }
  };
  walk(root);
  return out;
}

/** Every endpoint under `<projectRoot>/api`, as `{ name, method, routePath }`. */
export function readEndpoints(projectRoot) {
  const root = join(projectRoot, 'api');
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const m = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/.exec(entry);
      if (!m) continue;
      const routePath = relative(root, dir).split(/[\\/]/).join('/');
      const src = readFileSync(full, 'utf8');
      const named = /export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/.exec(src);
      out.push({ name: named?.[1] ?? routePath, method: m[1], routePath });
    }
  };
  walk(root);
  return out;
}

/** `recipes/[id]` → `recipes/:id`, the form `render-rig` expects. */
const toColonRoute = (route) => String(route).replace(/\[([A-Za-z0-9_]+)\]/g, ':$1');
const hasParam = (s) => /\[[A-Za-z0-9_]+\]|:[A-Za-z0-9_]+/.test(String(s));

/**
 * Request every parameter-free read endpoint over HTTP.
 *
 * A non-2xx is a finding, full stop: an endpoint the app's own page calls on mount, answering 500,
 * is a broken app no matter how clean its spec is.
 *
 * Parameter-free GETs run first so their rows can supply real ids for the parameterised ones, which
 * are then probed too. A parameterised endpoint with no honest id available is reported UNMEASURED —
 * never guessed at with `/recipes/undefined`, which would invent a failure, and never counted as a
 * pass, which would hide one.
 */
export async function probeEndpoints({ base, projectId, endpoints, timeoutMs = 15000 }) {
  const findings = [];
  const responses = {};
  let measured = 0, skipped = 0;
  // Parameter-free GETs first, so their rows can supply ids for the parameterised ones. Without this
  // second pass the gate skipped 10 of 12 endpoints and would have MISSED the very defect that
  // motivated it: `recipes-detail` answering 400 on mount was caught only because that endpoint had
  // been written at a flat route, hence accidentally parameter-free. A correctly dynamic detail
  // endpoint — the majority — went unprobed.
  const ordered = [...endpoints].sort((a, b) => Number(hasParam(a.routePath)) - Number(hasParam(b.routePath)));
  for (const ep of ordered) {
    if (ep.method !== 'GET') { skipped++; continue; }
    let routePath = ep.routePath;
    if (hasParam(routePath)) {
      const filled = fillRouteParams(routePath, responses);
      // No real id to use is UNMEASURED, not a pass: probing `/recipes/undefined` would invent a
      // failure, and probing nothing at all must not read as success.
      if (!filled) { skipped++; continue; }
      routePath = filled;
    }
    const url = `${base}/app/${projectId}/api/${routePath}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      measured++;
      if (!res.ok) {
        findings.push({ code: 'endpointStatus', route: ep.routePath, severity: 'error',
          message: `GET ${ep.routePath} answered ${res.status} — a page calling this on mount renders an error, not content.` });
        continue;
      }
      try {
        const body = await res.json();
        responses[ep.name] = body;
        const wrapped = wrapperEnvelopeFinding(ep.name, body);
        if (wrapped) findings.push(wrapped);
      } catch { /* a non-JSON body is the writer's gate, not this one */ }
    } catch (e) {
      measured++;
      findings.push({ code: 'endpointUnreachable', route: ep.routePath, severity: 'error',
        message: `GET ${ep.routePath} did not answer: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { findings, responses, measured, skipped, ok: findings.length === 0 };
}

/**
 * The wrapper-envelope signature — the one defect the render rig provably does NOT catch.
 *
 * Verified, not assumed: with `{ items: [{ recipes: [...3 records] }] }` in place, the rig returned
 * `ok: true`. It is right to. The endpoint answers 200, the page has nav, a heading and a row area,
 * so `blankPage` does not fire — the page is not blank, it renders ONE EMPTY ROW where three records
 * should be. "One blank row" is not "empty", which is exactly why `emptyRender` misses it too.
 *
 * So it needs its own check, at the only layer where the fault is unambiguous: the response shape.
 * The signature is precise — `items` of length 1, whose single element has exactly ONE key, whose
 * value is an array of objects. That is a collection wrapped as one item. A genuine aggregate or
 * dashboard has SEVERAL fields, so it does not match; and a list of one real record has that record's
 * own columns, not a single array-valued key.
 */
export function wrapperEnvelopeFinding(name, body) {
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length !== 1) return null;
  const only = items[0];
  if (!only || typeof only !== 'object' || Array.isArray(only)) return null;
  const keys = Object.keys(only);
  if (keys.length !== 1) return null;
  const inner = only[keys[0]];
  if (!Array.isArray(inner) || !inner.length) return null;
  if (!inner.every((row) => row && typeof row === 'object' && !Array.isArray(row))) return null;
  return { code: 'wrapperEnvelope', route: name, severity: 'error',
    message: `${name} returned its collection WRAPPED as one item — items[0].${keys[0]} holds ${inner.length} records. `
      + `A list section iterates \`items\`, so it sees ONE element and renders ONE blank row over ${inner.length} real records. `
      + `Return one item PER RECORD: { items: [ {...}, {...} ] }.` };
}

/**
 * Substitute a real id into an endpoint's `[param]` segments, using rows an earlier probe returned.
 *
 * Scoped exactly like `paramsForRoute`: the id comes only from a response whose endpoint name shares
 * the route's own collection segment, never a global pool. Returns null when no honest id exists, so
 * the caller reports the endpoint UNMEASURED rather than probing a made-up value.
 */
export function fillRouteParams(routePath, responses) {
  const segs = String(routePath).split('/');
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const m = /^\[([A-Za-z0-9_]+)\]$/.exec(seg);
    if (!m) { out.push(seg); continue; }
    const collection = (segs[i - 1] ?? '').toLowerCase();
    if (!collection) return null;
    let id = null;
    for (const [name, body] of Object.entries(responses)) {
      if (!name.toLowerCase().includes(collection)) continue;
      const items = Array.isArray(body?.items) ? body.items : null;
      const first = items && items.length ? items[0] : null;
      const v = first && typeof first === 'object' ? first.id ?? first.uuid ?? first.slug : null;
      if (v !== undefined && v !== null && v !== '') { id = String(v); break; }
    }
    if (!id) return null;
    out.push(encodeURIComponent(id));
  }
  return out.join('/');
}

/**
 * Fill a route's `[param]` from a real id in an endpoint response.
 *
 * Scoped the way `render-gate.mjs` scopes it, and for the same reason: the id is drawn only from a
 * response whose endpoint name shares the route's own collection segment. A global id pool put a
 * plausible-looking wrong id on the wrong page once already.
 */
export function paramsForRoute(route, responses) {
  const names = [...String(route).matchAll(/\[([A-Za-z0-9_]+)\]/g)].map((m) => m[1]);
  if (names.length !== 1) return {};
  const segs = String(route).split('/').filter(Boolean);
  const i = segs.findIndex((s) => s.startsWith('['));
  const collection = i > 0 ? segs[i - 1].toLowerCase() : '';
  if (!collection) return {};
  for (const [name, body] of Object.entries(responses)) {
    if (!name.toLowerCase().includes(collection)) continue;
    const items = Array.isArray(body?.items) ? body.items : null;
    const first = items && items.length ? items[0] : null;
    const id = first && typeof first === 'object' ? first.id ?? first.uuid ?? first.slug : null;
    if (id !== undefined && id !== null && id !== '') return { [names[0]]: String(id) };
  }
  return {};
}

/**
 * Boot-to-pixels check for one built app.
 *
 * @returns {{ok: boolean|null, endpoints: object, render: object|null, findings: Array}}
 *   `ok: null` means UNMEASURED, not passing.
 */
export async function appSmoke({ base, runtimeRoot, projectId: hintedId, projectRoot: hintedRoot, interact = false, screenshotDir = null, sdkRoot = undefined }) {
  // Prefer discovery over the caller's id: the harness knows the project it CREATED, not the one
  // THING built the app into.
  const found = runtimeRoot ? findAppProject(runtimeRoot) : null;
  const projectId = found?.id ?? hintedId;
  const projectRoot = found?.dir ?? hintedRoot;
  if (!projectRoot || !projectId) {
    return { ok: null, unavailable: true, reason: 'no project with api/ or views/ under the runtime root — the build produced no app to check',
      projectId: null, endpoints: null, render: null, findings: [] };
  }

  const endpoints = readEndpoints(projectRoot);
  const viewRoutes = readViewRoutes(projectRoot);
  if (!endpoints.length && !viewRoutes.length) {
    return { ok: null, unavailable: true, reason: `project "${projectId}" has no api/ or views/ — nothing to check`,
      projectId, endpoints: null, render: null, findings: [] };
  }

  const probe = await probeEndpoints({ base, projectId, endpoints });

  const routes = viewRoutes.map(({ route, file }) => ({
    route: `/${toColonRoute(route).replace(/^\/+/, '')}`,
    file,
    params: Object.fromEntries(Object.entries(paramsForRoute(route, probe.responses))),
  }));

  let render = null;
  try {
    render = await renderCheck({ baseUrl: `${base}/app/${projectId}`, routes, screenshotDir, interact, sdkRoot });
  } catch (e) {
    render = { ok: null, unavailable: true, reason: `render rig failed to run: ${e instanceof Error ? e.message : String(e)}`, findings: [] };
  }

  const findings = [...probe.findings, ...(render?.findings ?? [])];
  // `ok` is TRUE only when both halves actually MEASURED something and came back clean.
  //
  // "Nothing went wrong" is not "it works": run 13 reported ok:true having probed ZERO endpoints,
  // because it was pointed at an empty scaffold — a clean verdict over an app it never found. An
  // empty measurement is now `null` (UNMEASURED), which does not pass and is not a failure either.
  const measuredAnything = probe.measured > 0 || (render?.counts?.measured ?? 0) > 0;
  const ok = !probe.ok ? false
    : render?.ok === false ? false
    : !measuredAnything ? null
    : render?.unavailable ? null
    : render?.ok === true ? true
    : null;
  return { ok, projectId,
    endpoints: { ok: probe.ok, measured: probe.measured, skipped: probe.skipped, findingCount: probe.findings.length },
    render: render?.unavailable ? { ok: null, unavailable: true, reason: render.reason }
      : { ok: render?.ok ?? null, counts: render?.counts ?? null, errorCount: render?.errorCount ?? null },
    findings: findings.slice(0, 20).map((f) => ({ code: f.code, route: f.route, viewport: f.viewport, message: f.message })) };
}
