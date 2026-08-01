import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import { authHeaders } from './auth';
import { apiUrl } from '../../platform/api-base';
import { projectAppUrl } from '../../lib/app-urls';

/**
 * The selected project's app pages, as links, directly above the composer.
 *
 * A project in this runtime is not only a conversation's workspace — it can also BE an
 * application (`pages/`, `api/`, `database/`, `hooks/`; see `org/docs/app/`). When it is, the
 * thing the reader most often wants after asking THING to build something is to *look at it*,
 * and until now the only routes to it were Studio or typing the `/app/<project>/…` URL by hand.
 * The chat already knows which project is selected, so it can just say.
 *
 * Only pages that can be opened are listed: a route with a dynamic segment (`/trips/:tripId`)
 * has no id to put in the URL, and a link to the pattern would 404 or render an empty record.
 * They are filtered out rather than shown disabled — an app is usually reached through its index
 * page anyway, and a row of dead chips is worse than a short one.
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
const DYNAMIC_SEGMENT = /(^|\/):[^/]+/;

/** How many chips before the row collapses behind "+N more". */
const MAX_VISIBLE = 4;

/** `/` → `Home`; `/settings/profile` → `Settings / Profile`. The FULL path, not just the last
 *  segment, because two pages can share one (`/posts/edit` and `/pages/edit`) and a chip that
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
function useAppPages(projectId: string | null): string[] {
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
    fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/app`), { headers: authHeaders() })
      .then((r) => (r.ok ? (r.json() as Promise<AppManifest>) : null))
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

interface AppPagesProps {
  projectId?: string | null;
}

export function AppPages({ projectId }: AppPagesProps): React.ReactElement | null {
  const pages = useAppPages(projectId ?? null);
  const [expanded, setExpanded] = React.useState(false);

  // A different project is a different app — a row left expanded from a five-page one should not
  // greet the next project already open.
  React.useEffect(() => setExpanded(false), [projectId]);

  if (!projectId || pages.length === 0) return null;

  const visible = expanded ? pages : pages.slice(0, MAX_VISIBLE);
  const hidden = pages.length - visible.length;

  return (
    <Prim.Row
      data-testid="app-pages"
      paddingHorizontal="$4"
      paddingTop="$2"
      flexWrap="wrap"
      alignItems="center"
      gap="$1.5"
      aria-label="app pages"
    >
      <Prim.Text fontSize="$xs" color="$muted-foreground" flexShrink={0}>
        App
      </Prim.Text>
      {visible.map((routePath) => (
        <Prim.Link
          key={routePath}
          href={projectAppUrl(projectId, routePath)}
          target="_blank"
          rel="noreferrer"
          data-route={routePath}
          display="inline-flex"
          alignItems="center"
          gap="$1"
          maxWidth="180px"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          paddingHorizontal="$2"
          paddingVertical="$0.5"
          borderRadius="$radius-full"
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$card"
          color="$muted-foreground"
          fontSize="$xs"
          textDecorationLine="none"
          transition="quick"
          hoverStyle={{ color: '$foreground', borderColor: '$primary' }}
          title={`Open ${routePath}`}
        >
          {pageLabel(routePath)}
        </Prim.Link>
      ))}
      {hidden > 0 && (
        <Prim.Pressable
          onClick={() => setExpanded(true)}
          fontSize="$xs"
          color="$muted-foreground"
          paddingHorizontal="$2"
          paddingVertical="$0.5"
          borderRadius="$radius-full"
          borderWidth={1}
          borderColor="$border"
          hoverStyle={{ color: '$foreground' }}
        >
          +{hidden} more
        </Prim.Pressable>
      )}
    </Prim.Row>
  );
}
