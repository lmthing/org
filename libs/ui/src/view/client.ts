/**
 * `createViewClient` — the one parameterised data client, for both targets.
 *
 * A spec names ENDPOINTS, never URLs and never fetch code. The bridge from a name to a
 * request is the endpoint manifest (`name → { method, routePath }`), and the request
 * semantics are exactly `@app/runtime`'s `buildRequest`:
 *
 *  - `:param` segments are filled from `input` and those keys are consumed;
 *  - **GET / DELETE** send the remainder as a query string;
 *  - **POST / PATCH / PUT** send the remainder as a JSON body.
 *
 * Those semantics are re-implemented here rather than imported because `@lmthing/cli`
 * depends on `@lmthing/ui` (importing back would be a package cycle) and because the cli
 * copy reads `window.location` and `window.__APP_ENDPOINTS__`, neither of which exists on
 * a phone. `client.test.ts` asserts this copy against the same cases as
 * `libs/cli/src/app/runtime/client.test.ts`.
 *
 * ## The two configurations, and why nothing here assumes an origin
 *
 * | | web (the prebuilt AppHost) | native (`apps/mobile`) |
 * |---|---|---|
 * | `baseUrl`  | the app base (`…/app/<project>`), often relative | the ABSOLUTE pod URL |
 * | `getToken` | omitted — the pod is same-origin and cookie-authed | the pod token |
 * | `endpoints`| from `GET /api/apps/:id/views` | from `GET /api/apps/:id/views` |
 *
 * This is the `createTeamClient` pattern (`src/team/client.ts`): where the pod is and how
 * a token is obtained are CONFIGURATION, so the same code runs in a browser tab served by
 * the pod and in a native app that has no origin at all. `fetch` is the only platform API
 * used, and React Native has it.
 */

import type { Action, Route } from './types'

/** One endpoint's routing facts, mirroring the generated `EndpointContract`. */
export interface EndpointManifestEntry {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Route pattern with `:param` segments, e.g. `/items/:id`. */
  routePath: string
  /** The mutation's Input JSON Schema — what a `create` section derives its fields from. */
  inputSchema?: Record<string, unknown>
  /** The Output JSON Schema, used to derive a default item shape when none is authored. */
  outputSchema?: Record<string, unknown>
}

/** `name → routing` for every endpoint the app exposes. */
export type EndpointManifest = Record<string, EndpointManifestEntry>

/** The error a failed call throws — one shape for both targets. */
export class ViewHttpError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ViewHttpError'
    this.status = status
    this.details = details
    Object.setPrototypeOf(this, ViewHttpError.prototype)
  }
}

/** What the host router must provide for `{ navigate }` and in-app links to work. */
export interface ViewNavigation {
  /**
   * Go to an authoring route with its `[param]`s already filled (`'trips/abc/expenses'`).
   * Absent ⇒ navigation actions render but do nothing, which is the honest behaviour for
   * a preview host with no router.
   */
  navigate?: (route: Route) => void
  /** Open an external URL (`https:`, `tel:`, `mailto:`). */
  openExternal?: (href: string) => void
}

export interface ViewClientConfig extends ViewNavigation {
  /**
   * Where the pod is. `''` on web (same-origin, relative paths); an absolute origin plus
   * the app base on native. Never assumed — see the table above.
   */
  baseUrl?: string
  /** A bearer token provider. Omitted on web, where the pod is cookie-authed. */
  getToken?: () => string | undefined | Promise<string | undefined>
  /** The endpoint manifest. */
  endpoints: EndpointManifest
  /** Injected for tests, and for a host that wraps `fetch`. */
  fetchImpl?: typeof fetch
  /** Extra headers on every call. */
  headers?: Record<string, string>
  /** `'include'` on web where the pod sets a cookie. Never sent on native. */
  credentials?: RequestCredentials
  /** The project this app is, for the `chat` section's session create. */
  projectId?: string
  /** The IANA zone `$client.timezone` resolves to. Defaults to the platform's. */
  timezone?: string
  /** Copy text to the clipboard — the `{ copy }` action. */
  copyToClipboard?: (text: string) => void | Promise<void>
  /** Print the current view — the `{ print: true }` action. */
  print?: () => void
  /** Save bytes to a file — the `{ download }` action. Defaults to an anchor click on web. */
  saveFile?: (filename: string, body: Blob | string, contentType: string) => void | Promise<void>
  /** Ask the user to confirm a destructive action. Defaults to allowing it. */
  confirm?: (message: string) => boolean | Promise<boolean>
}

/** The data surface the renderer programs against. */
export interface ViewClient extends ViewNavigation {
  /** Call an endpoint by NAME. Resolves the parsed Output; throws {@link ViewHttpError}. */
  call: (name: string, input?: Record<string, unknown>) => Promise<unknown>
  /** Fetch an endpoint's Output as bytes — the `{ download }` action's other half. */
  fetchBlob: (name: string, input?: Record<string, unknown>) => Promise<{ body: Blob | string; contentType: string }>
  endpoints: EndpointManifest
  /** `undefined` when the manifest has no such endpoint. */
  endpoint: (name: string) => EndpointManifestEntry | undefined
  baseUrl: string
  projectId?: string
  timezone: string
  getToken?: () => string | undefined | Promise<string | undefined>
  copyToClipboard?: (text: string) => void | Promise<void>
  print?: () => void
  saveFile?: (filename: string, body: Blob | string, contentType: string) => void | Promise<void>
  confirm: (message: string) => Promise<boolean>
}

// ── request building — the `buildRequest` semantics, verbatim ─────────────────

function fillPath(routePath: string, input: Record<string, unknown>): { path: string; consumed: Set<string> } {
  const consumed = new Set<string>()
  const segs = routePath
    .split('/')
    .filter((s) => s.length > 0)
    .map((seg) => {
      if (seg.startsWith(':')) {
        const key = seg.slice(1)
        consumed.add(key)
        return encodeURIComponent(String(input[key]))
      }
      return seg
    })
  return { path: segs.length > 0 ? '/' + segs.join('/') : '', consumed }
}

function toQuery(input: Record<string, unknown>, consumed: Set<string>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(input)) {
    if (consumed.has(k) || v === undefined || v === null) continue
    params.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return params.toString()
}

/** GET and DELETE carry their remainder in the query string; everything else in a body. */
function isQueryMethod(method: string): boolean {
  return method === 'GET' || method === 'DELETE'
}

/** Assemble `{ method, url, init }` for one endpoint call. Pure and unit-testable. */
/**
 * The POD origin, derived from whatever `baseUrl` this client was given.
 *
 * `baseUrl` is deliberately two different things (see the table above): on web it is the APP base
 * (`…/app/<project>`, often relative), on native the absolute pod URL. Endpoint calls want the app
 * base, but a few routes are POD routes and live outside it — `POST /api/sessions`, which the
 * assistant dock opens, is one.
 *
 * Getting this wrong is invisible on native and fatal on web, which is exactly how it shipped: the
 * dock resolved `…/app/<project>/api/sessions`, the app router had no such route, and every page in
 * the app answered 404 on the one control present in the shell of all of them.
 */
export function podOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const cut = trimmed.replace(/\/app\/[^/]+$/, '')
  return cut === trimmed ? trimmed : cut
}

export function buildViewRequest(
  entry: EndpointManifestEntry,
  input: Record<string, unknown>,
  base: string,
): { method: string; url: string; init: RequestInit } {
  const { path, consumed } = fillPath(entry.routePath, input)
  let url = `${base}/api${path}`
  const init: RequestInit = { method: entry.method }
  if (isQueryMethod(entry.method)) {
    const qs = toQuery(input, consumed)
    if (qs) url += `?${qs}`
  } else {
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) if (!consumed.has(k)) body[k] = v
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return { method: entry.method, url, init }
}

// ── the client ───────────────────────────────────────────────────────────────

// ── host capabilities, and why they have web fallbacks ───────────────────────
//
// `navigate` / `openExternal` / `copyToClipboard` / `print` / `saveFile` / `confirm` are
// things only the HOST can do, so the client takes them as configuration. The native host
// supplies all of them (`Linking`, `expo-clipboard`, `Alert`).
//
// The web side must not be allowed to simply omit them: a `{ copy }` button that works on
// a phone and silently does nothing in a browser is precisely the defect a render-smoke
// gate cannot see — the page renders, the button presses, nothing happens, no error. So
// the browser-shaped ones fall back to the browser's own implementation when a DOM is
// there. Every access is `globalThis.window?.…`, the explicit "may not exist" form, which
// is what keeps this module native-safe (`scripts/lint-dom-globals.mjs`).
//
// `navigate` is deliberately NOT defaulted: routing belongs to the host's router, and
// guessing (a `location.assign`) would break a SPA's history rather than degrade.

const webWindow = () => globalThis.window as (Window & typeof globalThis) | undefined

function webOpenExternal(href: string): void {
  webWindow()?.open?.(href, '_blank', 'noreferrer')
}

async function webCopy(text: string): Promise<void> {
  await webWindow()?.navigator?.clipboard?.writeText?.(text)
}

function webPrint(): void {
  webWindow()?.print?.()
}

function webSaveFile(filename: string, body: Blob | string, contentType: string): void {
  const w = webWindow()
  const doc = w?.document
  if (!w || !doc) return
  const blob = typeof body === 'string' ? new Blob([body], { type: contentType }) : body
  const url = w.URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  doc.body.appendChild(anchor)
  anchor.click()
  doc.body.removeChild(anchor)
  w.URL.revokeObjectURL(url)
}

function webConfirm(message: string): boolean {
  const w = webWindow()
  // No DOM and no host confirm ⇒ allow. A destructive action that cannot be CONFIRMED must
  // not become one that cannot be TAKEN — so only an explicit `false` cancels. (jsdom's
  // `window.confirm` exists and returns `undefined`, which is exactly this case.)
  if (!w?.confirm) return true
  return w.confirm(message) !== false
}

/**
 * Build a {@link ViewClient}.
 *
 * The three documented members are `{ baseUrl, getToken, endpoints }`; everything else is
 * an optional host capability. A supplied one always wins; where the host omits one and a
 * DOM is present, the browser's own implementation is used, so the SAME spec behaves the
 * same on both targets.
 */
export function createViewClient(config: ViewClientConfig): ViewClient {
  const base = (config.baseUrl ?? '').replace(/\/+$/, '')
  const doFetch = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function headers(extra?: HeadersInit): Promise<Record<string, string>> {
    const out: Record<string, string> = { ...(config.headers ?? {}) }
    if (config.getToken) {
      const token = await config.getToken()
      if (token) out.authorization = `Bearer ${token}`
    }
    if (extra) for (const [k, v] of Object.entries(extra as Record<string, string>)) out[k] = v
    return out
  }

  function entryOf(name: string): EndpointManifestEntry {
    const entry = config.endpoints[name]
    if (!entry) throw new ViewHttpError(500, `unknown endpoint "${name}"`)
    return entry
  }

  async function send(name: string, input: Record<string, unknown>): Promise<Response> {
    const entry = entryOf(name)
    const { url, init } = buildViewRequest(entry, input, base)
    return doFetch(url, {
      ...init,
      headers: await headers(init.headers),
      ...(config.credentials ? { credentials: config.credentials } : {}),
    })
  }

  return {
    endpoints: config.endpoints,
    endpoint: (name) => config.endpoints[name],
    baseUrl: base,
    projectId: config.projectId,
    timezone: config.timezone ?? resolveTimezone(),
    getToken: config.getToken,
    // Host-supplied wins; otherwise the browser's own, so a spec behaves identically on
    // both targets rather than silently no-opping on one.
    navigate: config.navigate,
    openExternal: config.openExternal ?? webOpenExternal,
    copyToClipboard: config.copyToClipboard ?? webCopy,
    print: config.print ?? webPrint,
    saveFile: config.saveFile ?? webSaveFile,

    confirm: async (message: string) => {
      if (config.confirm) return await config.confirm(message)
      return webConfirm(message)
    },

    async call(name, input = {}) {
      const res = await send(name, input)
      const body: unknown = await res.json().catch(() => undefined)
      if (!res.ok) {
        const err = (body as { error?: { status?: number; message?: string; details?: unknown } } | undefined)?.error
        throw new ViewHttpError(err?.status ?? res.status, err?.message ?? 'request failed', err?.details)
      }
      return body
    },

    async fetchBlob(name, input = {}) {
      const res = await send(name, input)
      if (!res.ok) throw new ViewHttpError(res.status, `download failed (${res.status})`)
      const contentType = res.headers?.get?.('content-type') ?? 'application/octet-stream'
      // `blob()` exists in both runtimes but a mocked fetch in a test may not have it;
      // text is a correct fallback for every export the corpus produces (OPML, ics, md).
      const body = typeof res.blob === 'function' ? await res.blob() : await res.text()
      return { body, contentType }
    },
  }
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when an action names a mutation — the only kind that invalidates queries. */
export function actionEndpoints(action: Action | undefined): string[] {
  if (!action) return []
  if ('mutate' in action) return [action.mutate, ...(action.invalidates ?? [])]
  if ('download' in action) return [action.download]
  return []
}
