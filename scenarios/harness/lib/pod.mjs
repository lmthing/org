/**
 * Pod HTTP client — the compute pod IS the app (see sdk/org/libs/cli/src/server/serve.ts).
 *
 * The pod itself does no auth: Envoy validates the gateway JWT at the edge and routes on the
 * `sub` claim to `lmthing.user-<id>.svc`. So every call here just carries the bearer token and
 * talks to the chat origin. Locally (`lmthing serve`) pass base=http://localhost:8080 and no token.
 */

export class Pod {
  constructor({ base, token }) {
    this.base = base;
    this.token = token;
  }

  async req(method, path, body, { raw = false } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* raw text (e.g. an ASCII state tree) */
    }
    if (!res.ok && !raw) {
      const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return raw ? { status: res.status, body: parsed } : parsed;
  }

  // ── projects ────────────────────────────────────────────────────────────
  listProjects = () => this.req('GET', '/api/projects');
  createProject = (name) => this.req('POST', '/api/projects', { name });
  deleteProject = (id) => this.req('DELETE', `/api/projects/${id}`);
  listSpaces = (projectId) => this.req('GET', `/api/projects/${projectId}/spaces`);
  listIntegrations = (projectId) => this.req('GET', `/api/projects/${projectId}/integrations`);
  projectSessions = (projectId) => this.req('GET', `/api/projects/${projectId}/sessions`);

  // ── files (the whole point: assert what the agents actually WROTE) ───────
  fsTree = () => this.req('GET', '/api/fs/tree');
  readFile = (path) => this.req('GET', `/api/fs/read?path=${encodeURIComponent(path)}`);
  writeFile = (path, content) => this.req('PUT', '/api/fs/write', { path, content });

  // ── store ───────────────────────────────────────────────────────────────
  storeSpaces = () => this.req('GET', '/api/store/spaces');
  installSpace = (spaceId, projectId = 'user', force = false) =>
    this.req('POST', '/api/store/spaces/install', { spaceId, projectId, force });
  storeApps = () => this.req('GET', '/api/apps');
  installApp = (appId, projectId, force = false) =>
    this.req('POST', '/api/apps/install', { appId, ...(projectId ? { projectId } : {}), force });

  // ── project-app runtime ─────────────────────────────────────────────────
  appManifest = (projectId) => this.req('GET', `/api/projects/${projectId}/app`);
  appBuild = (projectId) => this.req('POST', `/api/projects/${projectId}/app/build`);
  appData = (projectId, table) => this.req('GET', `/api/projects/${projectId}/app/data/${table}`);
  appPage = (projectId, path = '') =>
    this.req('GET', `/app/${projectId}/${path}`, undefined, { raw: true });

  // ── hooks & events ──────────────────────────────────────────────────────
  /** The one authoritative hook-run path (crond, boot catch-up and Studio all use it).
   *  The slug is a single path segment and may contain `:`/`@` (space hooks are
   *  `<spaceId>:<base>`; emitters are `@emitter:<scope>:<name>`) — encode it. */
  runHook = (projectId, slug) =>
    this.req('POST', `/api/projects/${projectId}/hooks/${encodeURIComponent(slug)}/run`, {});
  /** Run a cron emitter def by its pseudo-slug (`@emitter:<scope>:<name>`). */
  runEmitter = (projectId, scope, name) => this.runHook(projectId, `@emitter:${scope}:${name}`);

  /**
   * Deliver an inbound webhook exactly as an external provider would.
   * `headers` carries the provider's signature headers — the pod verifies BEFORE emit.
   *
   * NOTE the bearer token: in prod the pod is reached through Envoy, which routes on the
   * gateway JWT's `sub` claim — without it the edge answers `401 Jwt is missing` and the
   * request never reaches the pod. The real public path (gateway `/api/inbound/<token>/<path>`)
   * is a 202 fire-and-forget broker that hides the pod's own status code, so a scenario that
   * needs to assert 200/401/404 + `{events:n}` must deliver to the pod directly. The pod
   * itself does no auth: verification is the provider signature, exactly as in production.
   */
  async inbound(path, body, headers = {}) {
    const res = await fetch(`${this.base}/api/inbound/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* raw */
    }
    return { status: res.status, body: parsed };
  }

  // ── env / lifecycle ─────────────────────────────────────────────────────
  getEnv = () => this.req('GET', '/api/env');
  /** Restart the pod process (used by the auto-resume scenario). Pod exits ~100ms later. */
  restart = () => this.req('POST', '/api/restart', {}).catch(() => ({ ok: true }));
}
