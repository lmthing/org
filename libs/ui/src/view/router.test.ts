import { describe, expect, it } from 'vitest';

import { matchRoutes, stripPagesPrefix, type RoutePattern } from './router';

/**
 * The pure client-route matcher, in the home it shares with every consumer.
 *
 * These cases moved here from `libs/cli/src/app/runtime/router.test.tsx` when the
 * matcher was extracted out of the per-project router into this shared module
 * (`libs/ui/src/view/router.ts`). The behaviour is unchanged; what changed is
 * that the entries no longer need a React `Component` — the matcher is generic
 * over `T extends RoutePattern`, so a plain `{ routePath }` is enough. That is the
 * whole point of the extraction: a future app-shell can match routes without
 * React.
 *
 * The DOM/base-aware navigation cases (`toHref`, `navigate`, `clientPath`
 * round-trip, `PageErrorBoundary`) stayed behind in the cli runtime's test — they
 * touch `window`/`history` and the `…/app/<project>` base, which is a
 * browser-runtime concern.
 */

// Plain entries — no React `Component`, proving the matcher is reusable as-is.
function table(...routePaths: string[]): RoutePattern[] {
  return routePaths.map((routePath) => ({ routePath }));
}

// ── /pages/ prefix tolerance ──────────────────────────────────────────────────
// Routes are derived RELATIVE to the project's `pages/` dir, so no real route is
// ever mounted under `/pages/…`. But the folder is literally `pages/`, so an
// LLM-authored page routinely links to a sibling as `/pages/park-fees` instead of
// the route `/park-fees` (live: scenario 06 index page → "No page for
// /pages/park-fees"). The router tolerates the stray prefix as a fallback.
describe('stripPagesPrefix', () => {
  it('drops a leading /pages segment', () => {
    expect(stripPagesPrefix('/pages/park-fees')).toBe('/park-fees');
    expect(stripPagesPrefix('/pages/items/abc')).toBe('/items/abc');
  });
  it('collapses a bare /pages to /', () => {
    expect(stripPagesPrefix('/pages')).toBe('/');
  });
  it('leaves non-/pages paths untouched', () => {
    expect(stripPagesPrefix('/park-fees')).toBe('/park-fees');
    expect(stripPagesPrefix('/')).toBe('/');
    expect(stripPagesPrefix('/pagesx/y')).toBe('/pagesx/y'); // not the `pages` segment
  });
});

describe('matchRoutes /pages/ tolerance', () => {
  const routes = table('/', '/park-fees', '/items/:id');

  it('resolves a stray /pages/ prefix to the real route', () => {
    expect(matchRoutes(routes, '/pages/park-fees')?.entry.routePath).toBe('/park-fees');
  });
  it('resolves a stray /pages/ prefix on a dynamic route (params intact)', () => {
    const m = matchRoutes(routes, '/pages/items/abc');
    expect(m?.entry.routePath).toBe('/items/:id');
    expect(m?.params).toEqual({ id: 'abc' });
  });
  it('a literal route still wins over the fallback', () => {
    expect(matchRoutes(routes, '/park-fees')?.entry.routePath).toBe('/park-fees');
  });
  it('still returns null for a genuinely unknown path', () => {
    expect(matchRoutes(routes, '/pages/nope')).toBeNull();
    expect(matchRoutes(routes, '/nope')).toBeNull();
  });
});

describe('matchRoutes — a static segment beats a parameter, whatever the order', () => {
  /** The order the `pages/` walk actually produces: `[id]` before `new`. */
  const routes = table('/', '/plants', '/plants/:id', '/plants/new');

  it('does not let /plants/:id swallow /plants/new — the create page was UNREACHABLE', () => {
    // Found by the render rig: `/plants/new` rendered the DETAIL page, byte-identical screenshot,
    // even though `plants/new.view.json` is a correct `create` section.
    const m = matchRoutes(routes, '/plants/new');
    expect(m?.entry.routePath).toBe('/plants/new');
    expect(m?.params).toEqual({});
  });

  it('still matches a real id through the parameter', () => {
    const m = matchRoutes(routes, '/plants/p1');
    expect(m?.entry.routePath).toBe('/plants/:id');
    expect(m?.params).toEqual({ id: 'p1' });
  });

  it('holds when the static route is declared FIRST too — order must not matter either way', () => {
    const flipped = table('/plants/new', '/plants/:id');
    expect(matchRoutes(flipped, '/plants/new')?.entry.routePath).toBe('/plants/new');
    expect(matchRoutes(flipped, '/plants/p1')?.entry.routePath).toBe('/plants/:id');
  });

  it('prefers the FEWER-parameter route when several match', () => {
    const t = table('/a/:x/:y', '/a/:x/fixed');
    expect(matchRoutes(t, '/a/1/fixed')?.entry.routePath).toBe('/a/:x/fixed');
    expect(matchRoutes(t, '/a/1/2')?.entry.routePath).toBe('/a/:x/:y');
  });
});

describe('matchRoutes — generic over the entry shape', () => {
  // The matcher must not strip the caller's richer fields: a React `Component`,
  // a view spec, a handler — whatever the consumer put on the entry comes back
  // out on `match.entry`. This is what lets the same matcher serve both
  // `@app/runtime`'s React-typed `RouteEntry` and a future app-shell entry
  // without either wrapping or losing data.
  it('returns the SAME entry object the caller supplied (richer fields preserved)', () => {
    interface RichEntry extends RoutePattern {
      tag: string;
    }
    const routes: RichEntry[] = [
      { routePath: '/items/:id', tag: 'detail' },
      { routePath: '/items/new', tag: 'create' },
    ];
    const m = matchRoutes(routes, '/items/new');
    expect(m?.entry.routePath).toBe('/items/new');
    expect(m?.entry.tag).toBe('create'); // the richer field survived, not stripped to RoutePattern
  });
});
