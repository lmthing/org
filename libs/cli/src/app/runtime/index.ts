/**
 * `@app/runtime` — the per-project **client runtime** aliased into every page app
 * by the pages build. Bundled for the browser (React + these hooks) — never
 * imported by node/build code.
 *
 * Surface:
 *   - data — {@link useApi} (query), {@link useApiMutation} (mutation),
 *     {@link apiCall} (bare one-shot), {@link HttpError} (the shared error type).
 *   - routing — {@link useParams}, {@link Link} (History-API navigation).
 *   - mount — {@link mountApp} (used by the generated entry).
 */

export { apiCall, HttpError, resolveAppBase, buildRequest } from './client.js';
export type { EndpointManifest, EndpointManifestEntry, HttpErrorBody } from './client.js';

export { useApi, useApiMutation } from './hooks.js';
export type {
  QueryResult,
  UseApiOptions,
  UseApiMutationOptions,
  MutationResult,
} from './hooks.js';

export { useParams, Link, navigate, mountApp, AppRoot, matchRoutes } from './router.js';
export type {
  MountConfig,
  RouteEntry,
  PageComponent,
  WrapperComponent,
} from './router.js';

// Phase 7: <Chat> — a page-droppable `<Chat agent="space/agent" />` component
// (render-descriptor + @lmthing/ui). Not implemented in this phase.
