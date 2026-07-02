/**
 * Origin resolution for the data-plane APIs (the compute pod + the cloud gateway).
 *
 * There are THREE ways the web app gets served, and they need different origins:
 *  - **Production** — each surface has its own `lmthing.<app>` host; the pod is
 *    reached same-origin (Envoy proxies /api/* to the user's pod) and the gateway
 *    is the canonical `https://lmthing.cloud`.
 *  - **`*.test` nginx dev proxy** (the `make` local stack) — each service has a
 *    `<role>.test` vhost, so the pod is `computer.test` and the gateway `cloud.test`.
 *  - **`pnpm thing` single-port serve** — the CLI serves the web app, /api and the
 *    agent WS on ONE localhost origin, so every data-plane call is same-origin.
 *
 * The first two used to be told apart by `import.meta.env.DEV`, but that is `true`
 * for BOTH `.test` and `pnpm thing` (the latter runs an in-process Vite dev server),
 * which made `pnpm thing` wrongly target `computer.test` / `cloud.test`. So we key
 * off the current hostname instead — only the `.test` proxy stack is on a `.test`
 * host; `pnpm thing` is on `localhost` (or an IP) and stays same-origin.
 */
export type ApiRole = 'computer' | 'cloud'

export interface Loc {
  hostname: string
  origin: string
}

export function resolveApiOrigin(role: ApiRole, loc: Loc, isDev: boolean): string {
  if (!isDev) {
    // Production: pod is same-origin; gateway is its own canonical domain.
    return role === 'cloud' ? 'https://lmthing.cloud' : loc.origin
  }
  if (loc.hostname.endsWith('.test')) {
    // The `*.test` nginx dev proxy stack — per-service vhost.
    return role === 'cloud' ? 'https://cloud.test' : 'https://computer.test'
  }
  // `pnpm thing` (localhost single-port) — everything is same-origin.
  return loc.origin
}
