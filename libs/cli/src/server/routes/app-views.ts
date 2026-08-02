/**
 * **The spec-fetch route** — `GET /api/apps/:id/views`.
 *
 * A `system-appbuilder` app's pages are not a bundle: they are **specs**
 * (`sdk/org/libs/cli/src/app/view-spec/schema.ts`), persisted as JSON by the
 * authoring writers and rendered by the shared `ViewRenderer` on both targets.
 * This route is the transport for the **native** target, and it exists because
 * of one asymmetry:
 *
 *  - on **web** the generated wrapper page carries its spec inline and the
 *    endpoint manifest arrives as `window.__APP_ENDPOINTS__`, injected by the
 *    page entry (`../../app/build/pages.ts`, `../../app/runtime/client.ts`);
 *  - on **native** there is no host page to inject anything into, so the
 *    manifest has to travel WITH the specs — which is why `endpoints` is part of
 *    this payload rather than a second request.
 *
 * The pod **transports** specs; it does not interpret them. Validation is the
 * writer's job at save time and the whole-app gate's at verify time
 * (`../../app/view-spec/validate.ts`), so everything here is deliberately
 * shallow: confirm each artifact is structurally what its location claims, and
 * hand it over. One that is not is reported in `errors` rather than failing the
 * request — one unreadable page must not make a whole app unopenable.
 *
 * ## Where the specs come from
 *
 * `../../app/view-spec/files.ts` is the one module that knows the on-disk layout, so
 * the writers, the app-wide validators and this route all agree without importing
 * each other. This module therefore reads NOTHING itself — it calls
 * {@link loadProjectViews} and projects the result onto the wire.
 *
 * A project with **zero** view specs is not an error — it is an appbuilder app,
 * and `{ views: [] }` is precisely the signal the mobile host branches on.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { sendJson } from './utils.js';
import { safeProjectId } from '../projects.js';
import type { AppAdminManager } from './app-admin.js';
import { generateProjectContracts } from '../../app/build/contracts.js';
import type { EndpointContract } from '../../app/build/schema.js';
import { loadProjectViews } from '../../app/view-spec/files.js';
import type { ShellSpec, ViewComponentSpec, ViewLayoutSpec, ViewSpec } from '../../app/view-spec/schema.js';

type AppHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

// ── The payload ───────────────────────────────────────────────────────────────

/** One endpoint, as the renderer's client resolves it.
 *
 *  `method` + `routePath` are the web manifest's two fields verbatim
 *  (`EndpointManifestEntry` in `../../app/runtime/client.ts`) so a spec resolves a
 *  NAME identically on both targets. The two schemas ride along because a
 *  `create` section derives its form fields from the mutation's **Input** schema,
 *  and native has no second place to get them from. */
export interface AppViewEndpoint {
  method: EndpointContract['method'];
  routePath: string;
  inputSchema: unknown;
  outputSchema: unknown;
}

/** A file that could not be served, named so a caller can say WHICH page is missing. */
export interface AppViewReadError {
  /** Path relative to the project root (`pages/recipes/[id].view.json`). */
  file: string;
  message: string;
}

/** The `GET /api/apps/:id/views` body. */
export interface AppViewsPayload {
  project: string;
  /** Every page spec, sorted by route. Empty ⇒ this is not a viewbuilder app. */
  views: ViewSpec[];
  /** Every nested layout, so the native target can compose the same chain the web does. */
  layouts: ViewLayoutSpec[];
  /** Every named component def, sorted by name. */
  components: ViewComponentSpec[];
  /** The app shell, or `null` when the renderer should predict one. */
  shell: ShellSpec | null;
  /** `name → routing` — the native twin of `window.__APP_ENDPOINTS__`. */
  endpoints: Record<string, AppViewEndpoint>;
  /** Present only when a spec file was unreadable or malformed. */
  errors?: AppViewReadError[];
  /** Present only when the endpoint contracts failed to generate — "no endpoints"
   *  and "we could not read your endpoints" are different facts (the same
   *  distinction `handleAppManifest` draws with `endpointsError`). */
  endpointsError?: string;
}

// ── The reader ────────────────────────────────────────────────────────────────

/** What {@link readProjectViewSpecs} found on disk. */
export interface ProjectViewSpecs {
  views: ViewSpec[];
  layouts: ViewLayoutSpec[];
  components: ViewComponentSpec[];
  shell: ShellSpec | null;
  errors: AppViewReadError[];
}

/**
 * A project's persisted view specs, in the shape the wire wants.
 *
 * The layout is NOT re-derived here: `loadProjectViews` owns it, and duplicating
 * the walk would be a second opinion that drifts the first time the writers move a
 * file. What this adds is projection plus one transport-level check —
 *
 *  - the **route of record is the file path**, not the spec's own `route` field, so
 *    a stale `route` after a rename cannot resolve one way on web and another here;
 *  - likewise a component's **name is its filename**;
 *  - a file that parsed but is not shaped like the artifact its location claims is
 *    reported in `errors` rather than shipped. The renderer is contracted to never
 *    validate, so an object with no `sections` reaching it is a blank page. Depth
 *    beyond that belongs to `validateAppViews`, which runs at save time.
 */
export function readProjectViewSpecs(projectRoot: string): ProjectViewSpecs {
  const loaded = loadProjectViews(projectRoot);
  const errors: AppViewReadError[] = loaded.malformed.map((m) => ({ file: m.path, message: m.message }));

  const views: ViewSpec[] = [];
  for (const { route, spec, path } of loaded.views) {
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.sections)) {
      errors.push({ file: path, message: 'not a view spec (needs a `sections` array)' });
      continue;
    }
    views.push({ ...spec, route });
  }

  const layouts: ViewLayoutSpec[] = [];
  for (const { prefix, spec, path } of loaded.layouts) {
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.sections)) {
      errors.push({ file: path, message: 'not a layout (needs a `sections` array)' });
      continue;
    }
    layouts.push({ ...spec, prefix });
  }

  const components: ViewComponentSpec[] = [];
  for (const { name, def, path } of loaded.components) {
    if (!def || typeof def !== 'object' || def.node === undefined || def.node === null) {
      errors.push({ file: path, message: 'not a view component (needs a `node`)' });
      continue;
    }
    components.push({ ...def, name });
  }

  return { views, layouts, components, shell: loaded.shell ?? null, errors };
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/** The endpoint manifest, keyed by name. Prefers the manager's cached contracts
 *  (`getProjectContracts`) and falls back to a guarded generation — the same
 *  two-step `handleAppManifest#loadEndpoints` makes, because generating contracts
 *  is heavy and the pod has already paid for it once per project. */
async function loadEndpointManifest(
  manager: AppAdminManager,
  root: string,
  projectId: string,
  projectRoot: string,
): Promise<{ endpoints: Record<string, AppViewEndpoint>; error?: string }> {
  if (!existsSync(join(projectRoot, 'api'))) return { endpoints: {} };

  let contracts: EndpointContract[] = [];
  let error: string | undefined;
  try {
    const cached = manager.getProjectContracts
      ? await manager.getProjectContracts(root, projectId)
      : null;
    contracts = cached?.endpoints ?? (await generateProjectContracts(projectRoot)).endpoints;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.warn(`[app-views] ${projectId}: endpoint contracts failed to generate — ${error}`);
  }

  const endpoints: Record<string, AppViewEndpoint> = {};
  for (const ep of contracts) {
    endpoints[ep.name] = {
      method: ep.method,
      routePath: ep.routePath,
      inputSchema: ep.inputSchema,
      outputSchema: ep.outputSchema,
    };
  }
  return { endpoints, ...(error ? { error } : {}) };
}

// ── The handler ───────────────────────────────────────────────────────────────

/**
 * `GET /api/apps/:id/views` — serve `{ views, components, endpoints, shell }` for
 * the installed project `:id`.
 *
 * A mountable-handler FACTORY, like every other route in this directory
 * (`(manager, lmthingRoot) => (req, res, params) => Promise<void>`); `serve.ts`
 * mounts it. Authentication is the server's, not this route's: a personal pod is
 * single-tenant and a team pod is gated by `team-guard.ts`'s `guardRequest`
 * before dispatch, which lets a viewer read.
 */
export function handleAppViews(
  manager: AppAdminManager,
  lmthingRoot: string | undefined,
): AppHandler {
  return async (_req, res, params) => {
    const projectId = params['id']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);
    if (!existsSync(projectRoot)) {
      sendJson(res, 404, { error: `project not found: ${projectId}` });
      return;
    }

    const specs = readProjectViewSpecs(projectRoot);
    const api = await loadEndpointManifest(manager, lmthingRoot, projectId, projectRoot);

    const payload: AppViewsPayload = {
      project: projectId,
      views: specs.views,
      layouts: specs.layouts,
      components: specs.components,
      shell: specs.shell,
      endpoints: api.endpoints,
      ...(specs.errors.length > 0 ? { errors: specs.errors } : {}),
      ...(api.error ? { endpointsError: api.error } : {}),
    };
    sendJson(res, 200, payload);
  };
}
