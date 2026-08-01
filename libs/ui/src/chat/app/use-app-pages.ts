import React from 'react';
import { useStore } from '../store/store';
import { apiGet } from './api';

/**
 * The openable pages of the selected project's application.
 *
 * A project in this runtime is not only a conversation's workspace — it can also BE an
 * application (`pages/`, `api/`, `database/`, `hooks/`; see `org/docs/app/`). When it is, the
 * thing the reader most often wants after asking THING to build something is to *look at it*,
 * and the only routes to it were otherwise Studio or typing the `/app/<project>/…` URL by hand.
 * The chat already knows which project is selected, so it can just say — in the sidebar, beside
 * that project's spaces and conversations.
 *
 * Only pages that can be OPENED are listed: a route with a dynamic segment (`/trips/:tripId`)
 * has no id to put in the URL, and a link to the pattern would 404 or render an empty record.
 * They are filtered out rather than shown disabled — an app is usually reached through its index
 * page anyway, and a list of dead rows is worse than a short one.
 */

/** One page of the app manifest — `GET /api/projects/:projectId/app`. */
interface ManifestPage {
  routePath: string;
}
interface AppManifest {
  hasApp: boolean;
  pages?: ManifestPage[];
}

/** A route pattern with a parameter segment — `/trips/:tripId`, `/posts/:slug/edit`. */
export const DYNAMIC_SEGMENT = /(^|\/):[^/]+/;

/** `/` → `Home`; `/settings/profile` → `Settings / Profile`. The FULL path, not just the last
 *  segment, because two pages can share one (`/posts/edit` and `/pages/edit`) and a row that
 *  cannot be told from its neighbour is not a link, it is a guess. */
export function pageLabel(routePath: string): string {
  const segs = routePath.split('/').filter(Boolean);
  if (segs.length === 0) return 'Home';
  return segs
    .map((s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' / ');
}

/**
 * The openable page routes of `projectId`'s app, or `[]` when it has none (a spaces-only
 * project, an app with no `pages/`, or a pod that cannot answer).
 *
 * Refetched when a turn FINISHES, because writing a page is something a turn does — an app the
 * agent has just built appears without a reload. Deliberately NOT on every `done` flip: `done`
 * also goes false on send, and the manifest is not a free read (it discovers routes and resolves
 * endpoint contracts host-side).
 */
export function useAppPages(projectId: string | null): string[] {
  const done = useStore((s) => s.done);
  const [pages, setPages] = React.useState<string[]>([]);
  const [reloads, setReloads] = React.useState(0);
  const wasDone = React.useRef(done);

  React.useEffect(() => {
    if (done && !wasDone.current) setReloads((n) => n + 1);
    wasDone.current = done;
  }, [done]);

  React.useEffect(() => {
    if (!projectId) {
      setPages([]);
      return;
    }
    let cancelled = false;
    apiGet<AppManifest>(`/api/projects/${encodeURIComponent(projectId)}/app`)
      .then((manifest) => {
        if (cancelled) return;
        setPages(
          manifest?.hasApp
            ? (manifest.pages ?? [])
                .map((p) => p.routePath)
                .filter((routePath) => !DYNAMIC_SEGMENT.test(routePath))
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloads]);

  return pages;
}
