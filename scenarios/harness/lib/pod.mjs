/**
 * Pod HTTP client — the compute pod IS the app (see sdk/org/libs/cli/src/server/serve.ts).
 *
 * The pod itself does no auth: Envoy validates the gateway JWT at the edge and routes on the
 * `sub` claim to `lmthing.user-<id>.svc`. So every call here just carries the bearer token and
 * talks to the chat origin. Locally (`lmthing serve`) pass base=http://localhost:8080 and no token.
 */
import { LOCAL, restartLocalServer } from './local.mjs';

/**
 * A pod that is scaling from zero, rolling a new image, or sitting behind a blipping gateway does
 * not always answer with a *response* — the connection itself fails (undici's 10s
 * `ConnectTimeoutError`, `ECONNRESET`, `socket hang up`, a DNS `EAI_AGAIN`). Those surface as a
 * bare `TypeError: fetch failed`, which is NOT an HTTP status and so slipped past every
 * `{waking:true}`/504 retry below — one connect timeout to lmthing.chat killed a multi-hour run
 * with an uncaught exception. Treat a transient transport fault exactly like a `waking` answer:
 * back off and retry. A non-transient error (a bad URL, an aborted body) still throws at once.
 */
const TRANSIENT = /fetch failed|ConnectTimeout|UND_ERR|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|terminated|other side closed/i;

export async function fetchResilient(url, init, { tries = 40, waitMs = 3000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      const msg = `${e?.message ?? e} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
      if (!TRANSIENT.test(msg) || attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export class Pod {
  /**
   * @param {object} o
   * @param {string} o.base      the pod/API origin (prod: https://lmthing.chat)
   * @param {string} [o.token]   gateway JWT (Envoy routes on its `sub` claim)
   * @param {string} [o.appBase] the SERVED-APP origin. In prod the app is NOT reachable under
   *   `<chat>/app/<id>/` — Envoy hands `/app/*` on the chat host to the static web SPA (nginx),
   *   which answers a GET with the SPA *shell* (a 200 `<!doctype>` that is not the app at all —
   *   a scenario asserting only "200 + <!doctype" false-passes) and a POST with **405**. The app
   *   is root-mounted on lmthing.app (`/<project>/`, `/<project>/api/<route>` — serve.ts's
   *   "Project-app ROOT mount"). Locally there is no split host, so apps stay under `/app/<id>/`.
   */
  constructor({ base, token, appBase }) {
    this.base = base;
    this.token = token;
    this.appBase = appBase ?? process.env.LM_APP_BASE ?? (/lmthing\.chat/.test(base) ? 'https://lmthing.app' : base);
    /** true when the app has its own host → root mount (no `/app` prefix). */
    this.appRootMounted = this.appBase !== this.base;
  }

  /** The origin+prefix the SERVED app actually lives at (see `appBase`). */
  appOrigin(projectId) {
    return this.appRootMounted
      ? `${this.appBase}/${projectId}`
      : `${this.base}/app/${projectId}`;
  }

  /** Absolute-URL variant of `req` (the served app is on a different origin than /api/*). */
  async reqAbs(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchResilient(url, {
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
        /* html / raw */
      }
      // The activator MARKS its own response (`{waking:true}`) whatever status it uses (503/504),
      // so key on that marker — never on a bare 503, which for an app route is a real verdict.
      const waking =
        res.status === 504 || (parsed && typeof parsed === 'object' && parsed.waking === true);
      if (waking && attempt < 100) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return { status: res.status, body: parsed };
    }
  }

  async req(method, path, body, { raw = false } = {}) {
    // A scaled-to-zero pod answers with `504 {waking:true}` while the Envoy activator boots
    // it; that is a transient, not the endpoint's verdict. Retry idempotent-ish calls until
    // the pod is warm (bounded), so a read that lands on a cold pod self-heals instead of
    // throwing a spurious failure mid-scenario.
    //
    // The budget is minutes, not seconds. A pod that is ROLLING (a new image) or whose single
    // Node thread is stalled inside a long authoring turn keeps answering `waking` well past a
    // minute — the old 20×3s ≈ 60s gave up and threw `POST /api/sessions → 503 {waking:true}`,
    // killing a multi-hour run over a transient the harness was written to absorb.
    for (let attempt = 0; ; attempt++) {
      const res = await fetchResilient(`${this.base}${path}`, {
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
      // The activator MARKS its own response (`{waking:true}`) whatever status it uses (503/504),
      // so key on that marker — never on a bare 503, which for an app route is a real verdict.
      const waking =
        res.status === 504 || (parsed && typeof parsed === 'object' && parsed.waking === true);
      if (waking && attempt < 100) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (!res.ok && !raw) {
        const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
        err.status = res.status;
        err.body = parsed;
        throw err;
      }
      return raw ? { status: res.status, body: parsed } : parsed;
    }
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

  /** Read one authored file of a project (`<project>/pages/_layout.tsx`, `api/…`) — assert what the agent WROTE. */
  async readProjectFile(projectId, rel) {
    const r = await this.readFile(`${projectId}/${rel}`).catch(() => null);
    return typeof r === 'string' ? r : (r?.content ?? '');
  }

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
  /** GET the SERVED app page — on its real origin (see `appBase`), not the SPA shell. */
  appPage = (projectId, path = '') => this.reqAbs('GET', `${this.appOrigin(projectId)}/${path}`);

  // ── hooks & events ──────────────────────────────────────────────────────
  /** List every loaded hook across projects (`GET /api/hooks`). */
  listHooks = () => this.req('GET', '/api/hooks');
  /**
   * Call an app's OWN API route — the routes its pages actually fetch, on the app's real origin
   * (`<app-host>/<project>/api/<route>`). This is the layer the user sees: a page whose data API
   * returns rows can still render zeros because its own aggregation route 500s.
   */
  appApi = (projectId, route, body, method = 'POST') =>
    this.reqAbs(method, `${this.appOrigin(projectId)}/api/${String(route).replace(/^\//, '')}`, body);
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
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    // A scaled-to-zero pod answers the FIRST hit with `504 {waking:true}` (the Envoy
    // instant-wake activator) while it boots — that is not the def's real verdict. Retry
    // the exact same signed bytes until the woken pod actually runs verify→emit. The body
    // is byte-identical, but inbound dedupe only kicks in AFTER a successful verify, so a
    // retry of a request the pod never processed is not deduped.
    for (let attempt = 0; ; attempt++) {
      const res = await fetchResilient(`${this.base}/api/inbound/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...headers,
        },
        body: payload,
      });
      const text = await res.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* raw */
      }
      const waking = res.status === 504 || (parsed && typeof parsed === 'object' && parsed.waking === true);
      if (!waking || attempt >= 100) return { status: res.status, body: parsed };
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // ── uploads (chat attachments) ──────────────────────────────────────────
  /**
   * The mediaType decides the pod's ROUTE, not just a label: `image/*` goes to system-vision,
   * `audio/*` is transcribed at ingest, everything else goes to system-files. So a `.mp3` sent as
   * `application/octet-stream` is never transcribed, and a scenario asserting "a spoken-only fact
   * reached a row" fails for a reason that has nothing to do with the product. Every fixture type the
   * scenarios actually upload must be in this table.
   */
  static MEDIA_TYPES = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  /**
   * Upload a local file as a chat attachment (the UI's "load a file" action).
   * `POST /api/uploads` takes base64 + mediaType and returns an AttachmentRef
   * (`{id, kind, mediaType, filename?, url}`) that a message then references by id.
   * Pair with `ThingSession.sendWithAttachments()` (WS path — HTTP /message drops attachments).
   *
   * Throws on an unknown extension rather than silently sending `application/octet-stream` — a
   * misrouted attachment turns a real product failure into a green test (see MEDIA_TYPES).
   */
  async upload(filePath, { mediaType, filename } = {}) {
    const { readFileSync } = await import('node:fs');
    const { basename, extname } = await import('node:path');
    const bytes = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const mt = mediaType ?? Pod.MEDIA_TYPES[ext];
    if (!mt) {
      throw new Error(
        `upload(${basename(filePath)}): no mediaType known for "${ext}" — pass { mediaType } explicitly ` +
          `or add it to Pod.MEDIA_TYPES. Guessing octet-stream would misroute it (no vision, no transcription).`,
      );
    }
    const ref = await this.req('POST', '/api/uploads', {
      filename: filename ?? basename(filePath),
      mediaType: mt,
      data: bytes.toString('base64'),
    });
    return ref;
  }

  // ── accounting ──────────────────────────────────────────────────────────
  /** Pod-global token/cost ledger — includes the DELEGATE tree, not just top-level turns. */
  sessionLedger = () => this.req('GET', '/api/session-ledger');
  /** The gateway's spend-window report, as the pod sees it. */
  budget = () => this.req('GET', '/api/budget');

  // ── env / lifecycle ─────────────────────────────────────────────────────
  getEnv = () => this.req('GET', '/api/env');
  /**
   * Restart the pod process (used by the auto-resume scenario). The pod exits ~100ms later.
   *
   * In prod, Kubernetes brings it straight back. LOCALLY, NOTHING DOES — `POST /api/restart` just
   * kills the one shared `lmthing serve` and leaves it dead, hanging this lane AND every sibling
   * lane on the same server (found the hard way: S06's Act XIII took the whole local pod down
   * mid-run). So on the local target we must bring it back up ourselves — which is also the truer
   * reproduction of the edge this Act exists to test: the process really does die and really does
   * come back, and the session must survive it.
   */
  restart = async () => {
    if (!LOCAL) return this.req('POST', '/api/restart', {}).catch(() => ({ ok: true }));
    await this.req('POST', '/api/restart', {}).catch(() => ({ ok: true }));
    await restartLocalServer();
    return { ok: true, local: true };
  };
}
