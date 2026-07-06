/**
 * Centralised URL constants for the web app.
 *
 * Each constant checks the corresponding VITE_* env-var override first so
 * local dev and CI can point at arbitrary origins; otherwise the origin is
 * resolved from the current host via {@link resolveApiOrigin} (production /
 * `*.test` dev proxy / `pnpm thing` single-port serve all differ).
 */
import { resolveApiOrigin, type Loc } from './origins'

const loc: Loc =
  typeof window !== 'undefined'
    ? { hostname: window.location.hostname, origin: window.location.origin }
    : { hostname: '', origin: '' }

/** Compute pod REST/WS API origin. In production and under `pnpm thing` the pod
 *  is reached same-origin; only the `*.test` proxy stack uses `computer.test`. */
export const COMPUTER_BASE_URL =
  import.meta.env.VITE_COMPUTER_BASE_URL ??
  resolveApiOrigin('computer', loc, import.meta.env.DEV)

/** Cloud gateway origin — auth, billing, compute ensure. */
export const CLOUD_BASE_URL =
  import.meta.env.VITE_CLOUD_BASE_URL ??
  import.meta.env.VITE_CLOUD_URL ??
  resolveApiOrigin('cloud', loc, import.meta.env.DEV)

/**
 * URL path prefix the pod serves installed app pages under, per environment.
 *
 * Production `lmthing.app` serves apps at the ROOT (`lmthing.app/<project>/…`) —
 * Envoy reserves `/api`,`/assets`,`/install` and Exact `/` for the shell and sends
 * the rest of the catch-all to the pod, which registers a bare `/<project>/*` mount.
 * Every other context (localhost single-serve, the `*.test` proxy) is served by ONE
 * origin where the SPA owns the non-`/api` catch-all, so apps stay under the reserved
 * `/app/<project>/…` prefix (hence `localhost/app/blog`). Must match the pod's mount
 * (`serve.ts` `servesUnifiedSpa`) and the injected `<base href>` (`pages-serve.ts`).
 */
export const APP_PATH_PREFIX = loc.hostname === 'lmthing.app' ? '' : '/app'
