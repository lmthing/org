import React from 'react';
import { AppView as EmbeddedAppView } from '../../elements/content/app-view';
import { projectAppUrl } from '../../lib/app-urls';

/**
 * The project's SERVED APP, embedded as the chat surface's main pane.
 *
 * Every project is an app from birth (see `org/docs/format/project/`): a newborn project's app IS a
 * single full-height chat page, and as the builder adds real pages it becomes a full app with the
 * floating THING dock — the chat "embedded and hidden in a modal". So loading the app is the whole of
 * "select a project and it starts as a chat, then grows". This is a thin wrapper over the shared
 * cross-platform {@link EmbeddedAppView} element (an `<iframe>` on web, a `WebView` on native) that
 * maps `projectId` + an optional manifest `routePath` to the pod's own `/app/<project>/` mount — the
 * same same-origin serving path Studio's Preview uses (the app's CSP is `frame-ancestors 'self'`,
 * which permits the same-origin frame and blocks cross-origin ones). The app brings its own nav and
 * its own chat dock, so nothing here re-implements either.
 */
export interface AppFrameProps {
  projectId: string;
  /** A manifest route to open (`/`, `/trips`). Defaults to the app home. */
  routePath?: string;
  /** Accessible title for the frame. */
  title?: string;
}

export function AppFrame({ projectId, routePath = '/', title }: AppFrameProps): React.ReactElement {
  const url = React.useMemo(() => projectAppUrl(projectId, routePath), [projectId, routePath]);
  // `key` on the url so switching project/page REMOUNTS the frame: the app is a client-routed SPA, so
  // pushing a new src into a live frame would strand its in-memory router on the old route.
  return <EmbeddedAppView key={url} url={url} title={title ?? 'App'} />;
}
