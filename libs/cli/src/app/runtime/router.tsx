/**
 * `@app/runtime` — **tiny file-based client router** (browser).
 *
 * The generated page entry hands {@link mountApp} the route table (built from
 * `pages/`), the optional `_app`/`_layout` wrappers, and the endpoint manifest.
 * The router matches `window.location` against the table (`/items/:id` patterns),
 * renders the matched page inside `_layout` inside `_app`, and exposes the matched
 * path params via {@link useParams}. Navigation uses the History API; {@link Link}
 * is an anchor that pushes state instead of full-page-loading.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveAppBase, type EndpointManifest } from './client.js';

/** A page component: default-exported, receives the matched route `params`. */
export type PageComponent = React.ComponentType<{ params: Record<string, string> }>;

/** A wrapper (`_app`/`_layout`): receives `children`. */
export type WrapperComponent = React.ComponentType<{ children: React.ReactNode }>;

/** One entry of the generated route table. */
export interface RouteEntry {
  /** Route pattern with `:param` segments, e.g. `/` or `/items/:id`. */
  routePath: string;
  /** The page component to render for this route. */
  Component: PageComponent;
}

/** Everything the generated entry needs to mount the app. */
export interface MountConfig {
  /** The route table discovered from `pages/`. */
  routes: RouteEntry[];
  /** The `name → { method, routePath }` manifest to inject for `apiCall`. */
  manifest: EndpointManifest;
  /** Optional `_app.tsx` root wrapper (providers / context). */
  app?: WrapperComponent | null;
  /** Optional `_layout.tsx` persistent chrome. */
  layout?: WrapperComponent | null;
  /** DOM id to mount into (default `root`). */
  rootId?: string;
}

// ── Path matching ─────────────────────────────────────────────────────────────

interface RouteMatch {
  entry: RouteEntry;
  params: Record<string, string>;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Match a concrete client path against a route table (`:param` → capture). */
export function matchRoutes(routes: RouteEntry[], clientPath: string): RouteMatch | null {
  const reqSegs = splitPath(clientPath);
  for (const entry of routes) {
    const patSegs = splitPath(entry.routePath);
    if (patSegs.length !== reqSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      const p = patSegs[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(reqSegs[i]);
      else if (p !== reqSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

/** The client route = current pathname minus the resolved `…/app/<project>` base. */
export function clientPath(pathname: string): string {
  const base = resolveAppBase(pathname);
  const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return rest.length > 0 ? rest : '/';
}

// ── Params context + navigation ───────────────────────────────────────────────

const ParamsContext = createContext<Record<string, string>>({});

/** The matched route params for the current page (`{}` outside a route). */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(ParamsContext) as T;
}

/** Custom event the router listens on for in-app (pushState) navigation. */
const NAV_EVENT = 'lmthing:navigate';

/** Programmatic navigation — pushes History state and re-renders the router. */
export function navigate(href: string): void {
  window.history.pushState({}, '', href);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** An anchor that navigates client-side (History API) instead of full-loading. */
export function Link(
  props: { to: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>,
): React.ReactElement {
  const { to, onClick, ...rest } = props;
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

// ── Root component ────────────────────────────────────────────────────────────

/** Wrap `page` in `_layout` in `_app` (each optional). */
function wrap(
  App: WrapperComponent | null | undefined,
  Layout: WrapperComponent | null | undefined,
  page: React.ReactNode,
): React.ReactElement {
  let node: React.ReactNode = page;
  if (Layout) node = <Layout>{node}</Layout>;
  if (App) node = <App>{node}</App>;
  return <>{node}</>;
}

/** The router root — subscribes to History navigation and renders the match. */
export function AppRoot({ routes, app, layout }: MountConfig): React.ReactElement {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onNav);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);

  const match = useMemo(() => matchRoutes(routes, clientPath(path)), [routes, path]);

  const page = match ? (
    <match.entry.Component params={match.params} />
  ) : (
    <NotFound path={clientPath(path)} />
  );

  return (
    <ParamsContext.Provider value={match?.params ?? {}}>
      {wrap(app, layout, page)}
    </ParamsContext.Provider>
  );
}

/** Minimal 404 — design-system tokens only (no raw colors). */
function NotFound({ path }: { path: string }): React.ReactElement {
  return (
    <div className="text-muted-foreground p-4">
      <p>No page for {path}</p>
    </div>
  );
}

/** Inject the endpoint manifest and mount {@link AppRoot} via `createRoot`. */
export function mountApp(config: MountConfig): void {
  (globalThis as { __APP_ENDPOINTS__?: EndpointManifest }).__APP_ENDPOINTS__ = config.manifest;
  const el = document.getElementById(config.rootId ?? 'root');
  if (!el) throw new Error(`[app-runtime] mount target #${config.rootId ?? 'root'} not found`);
  createRoot(el).render(<AppRoot {...config} />);
}
