import * as Prim from '../../elements/primitives/index';
import React from 'react';
import {
  ViewRenderer,
  ViewNotFound,
  createViewClient,
  resolveRoute,
  initialRoute,
  normalizeAppViews,
  LoadingState,
  ErrorState,
  type AppViews,
} from '../../view';
import type { ShellSpec } from '../../view';
import { apiGet } from './api';
import { getAccessToken } from './auth';
import { projectAppUrl } from '../../lib/app-urls';

/**
 * A project's app, rendered **in-process** inside `/chat` — the main pane when a project is selected
 * and no specific conversation is open.
 *
 * This replaces the former `<iframe src="lmthing.app/<project>/…">`: the served app sends
 * `Content-Security-Policy: frame-ancestors 'self'`, so `lmthing.chat` could not frame `lmthing.app`
 * ("refused to connect"). Rendering the same view specs with the shared `ViewRenderer` sidesteps the
 * CSP entirely and needs no server change — the whole app (its pages, its own sidebar nav, its
 * assistant dock) is drawn here on `Prim.*`, exactly as `apps/app-shell` (web bundle) and
 * `apps/mobile` (native) draw it.
 *
 * Routing is **local state**, not the browser URL — the `/chat` surface owns the URL (TanStack
 * Router), so an in-app page change is a `setPath`, never a `history.pushState`. This mirrors the
 * native host (`apps/mobile/src/AppScreen.tsx#NativeApp`); the shared route lookups live in
 * `@lmthing/ui/view` (`view/app-views.ts`).
 *
 * The app always renders with a **sidebar**: `shell.placement` is coerced to `'sidebar'` so a grown
 * app's nav is a left rail (never a top-bar row), per the chat-first shell. A newborn project whose
 * only page is the chat index has no nav destinations, so no rail shows — it is just the full-height
 * chat, which is the point of "in the beginning it's only the chat".
 */
export function AppInline({ projectId }: { projectId: string }): React.ReactElement {
  const [app, setApp] = React.useState<AppViews | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The page on screen. `null` until the payload arrives (then the app's landing route); an in-app
  // `navigate` owns it from then on.
  const [path, setPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setApp(null);
    setError(null);
    setPath(null);
    void (async () => {
      try {
        const body = await apiGet<Partial<AppViews>>(`/api/apps/${encodeURIComponent(projectId)}/views`);
        if (cancelled) return;
        const normalized = normalizeAppViews(body, projectId);
        setApp(normalized);
        setPath(initialRoute(normalized.views, normalized.shell));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // The APP base (`…/app/<project>`), not the pod root: `buildViewRequest` appends `/api<routePath>`,
  // and a project's handlers are served under `/app/<project>/api/*`. `podOrigin(baseUrl)` inside the
  // client recovers the pod root for the dock's `POST /api/sessions`. Bearer-authed from the `/chat`
  // session (no same-origin cookie assumption); `credentials:'include'` also rides along so the
  // pod-session cookie the chat route drops keeps app-page sub-requests routed to the right pod.
  const client = React.useMemo(
    () =>
      createViewClient({
        baseUrl: projectAppUrl(projectId, '').replace(/\/+$/, ''),
        endpoints: app?.endpoints ?? {},
        projectId,
        getToken: () => getAccessToken(),
        credentials: 'include',
        navigate: setPath,
      }),
    [projectId, app?.endpoints],
  );

  if (error) {
    return (
      <Prim.Box flex={1} minHeight={0} padding="$4" backgroundColor="$background">
        <ErrorState title="Couldn’t load this app" message={error} />
      </Prim.Box>
    );
  }
  if (!app || path === null) {
    return (
      <Prim.Box flex={1} minHeight={0} padding="$4" backgroundColor="$background">
        <LoadingState shape="block" />
      </Prim.Box>
    );
  }

  const resolved = resolveRoute(app.views, path);
  if (!resolved) {
    // Only reachable if a `{ navigate }` names a route no spec owns — `validateAppViews` rejects that
    // at save time. The renderer's own not-found beats a blank screen if one slips through.
    return <ViewNotFound route={path ?? undefined} />;
  }

  // A GROWN app (a real page beyond the chat index) always renders its nav as a LEFT SIDEBAR — the
  // chat-first shell wants a rail, never a top-bar row. A NEWBORN app (its only page is the `index`
  // chat) keeps its shell as-is (`assistant:false` from the scaffold) so it is just the full-height
  // chat — "in the beginning it's only the chat", no chrome. `undefined` lets the renderer predict a
  // shell for the rare app that ships none.
  const grown = app.views.some((v) => v.route !== 'index');
  const shell: ShellSpec | undefined = grown
    ? { ...(app.shell ?? {}), placement: 'sidebar' }
    : (app.shell ?? undefined);

  return (
    <Prim.Box flex={1} minHeight={0} backgroundColor="$background">
      <PageErrorBoundary route={path}>
        <ViewRenderer
          spec={resolved.spec}
          components={app.components}
          shell={shell}
          layouts={app.layouts}
          client={client}
          route={{ path, params: resolved.params }}
          routes={app.views.map((v) => v.route)}
        />
      </PageErrorBoundary>
    </Prim.Box>
  );
}

/**
 * Contains a single page's render crash to that page. LLM-authored pages meet a null they did not
 * expect eventually, and React unmounts the whole tree on an uncaught render error — without this a
 * bad page would blank the entire `/chat` surface. Keyed by route so navigating away clears it.
 */
class PageErrorBoundary extends React.Component<
  { route: string; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { route: string; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidUpdate(prev: { route: string }): void {
    if (prev.route !== this.props.route && this.state.failed) this.setState({ failed: false });
  }
  override render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <Prim.Box flex={1} minHeight={0} padding="$4" backgroundColor="$background">
          <ErrorState title="This page hit an error" message="Navigate to another page to continue." />
        </Prim.Box>
      );
    }
    return this.props.children;
  }
}
