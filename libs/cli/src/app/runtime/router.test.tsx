/**
 * `@app/runtime` router — base-aware navigation.
 *
 * Regression: `navigate`/`Link` used to push the raw app-relative `to`
 * (`/discover`), dropping the `…/app/<project>/` base and sending the browser
 * out of the app (`lmthing.app/discover`). {@link toHref} re-applies the base so
 * a pushed URL stays inside the app, and it round-trips with {@link clientPath}
 * (which strips the base back off for route matching). Pure/browser code — we
 * stub `window` (location/history/dispatchEvent), no jsdom needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  toHref,
  navigate,
  linkDest,
  clientPath,
  matchRoutes,
  stripPagesPrefix,
  PageErrorBoundary,
  type RouteEntry,
} from './router.js';

function setLocation(pathname: string, override?: string): void {
  vi.stubGlobal('window', { location: { pathname } });
  if (override) (globalThis as { __APP_BASE__?: string }).__APP_BASE__ = override;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __APP_BASE__?: unknown }).__APP_BASE__;
});

describe('toHref', () => {
  it('prefixes an app-relative path with the …/app/<project> base', () => {
    setLocation('/app/blog/');
    expect(toHref('/discover')).toBe('/app/blog/discover');
    expect(toHref('/')).toBe('/app/blog/');
  });

  it('prefixes correctly from a deep route (base derived from any depth)', () => {
    setLocation('/app/blog/feed/abc123');
    expect(toHref('/discover')).toBe('/app/blog/discover');
  });

  it('uses the __APP_BASE__ override on the /app-stripped host', () => {
    setLocation('/blog/discover', '/blog');
    expect(toHref('/topics')).toBe('/blog/topics');
  });

  it('never double-prefixes an already-based path', () => {
    setLocation('/app/blog/');
    expect(toHref('/app/blog/discover')).toBe('/app/blog/discover');
    expect(toHref('/app/blog')).toBe('/app/blog');
  });

  it('strips a stray `/pages/` prefix so the pushed URL is the clean route', () => {
    // A page-authored link like `/pages/park-fees` (the on-disk folder is `pages/`)
    // must land on the route `/park-fees`, not `…/app/blog/pages/park-fees`.
    setLocation('/app/blog/');
    expect(toHref('/pages/park-fees')).toBe('/app/blog/park-fees');
    expect(toHref('/pages')).toBe('/app/blog/');
  });

  it('leaves a real `/pages/` INSIDE an already-based path untouched', () => {
    setLocation('/app/blog/');
    expect(toHref('/app/blog/pages/park-fees')).toBe('/app/blog/pages/park-fees');
  });

  it('leaves external, protocol-relative, hash and query links untouched', () => {
    setLocation('/app/blog/');
    expect(toHref('https://example.com')).toBe('https://example.com');
    expect(toHref('//cdn.example.com/x')).toBe('//cdn.example.com/x');
    expect(toHref('#section')).toBe('#section');
    expect(toHref('?q=1')).toBe('?q=1');
  });

  it('is a no-op when there is no resolvable base (relative-to-origin)', () => {
    setLocation('/somewhere/else');
    expect(toHref('/discover')).toBe('/discover');
  });
});

describe('linkDest', () => {
  it('accepts the anchor-style `href` prop (what app-builder pages emit)', () => {
    expect(linkDest({ href: '/discover' })).toBe('/discover');
  });
  it('accepts the router-style `to` prop', () => {
    expect(linkDest({ to: '/topics' })).toBe('/topics');
  });
  it('prefers `to` when both are given', () => {
    expect(linkDest({ to: '/a', href: '/b' })).toBe('/a');
  });
  it('degrades to empty string when neither is given', () => {
    expect(linkDest({})).toBe('');
  });
  it('a `<Link href>` still resolves to a based, in-app URL', () => {
    setLocation('/app/blog/');
    expect(toHref(linkDest({ href: '/discover' }))).toBe('/app/blog/discover');
  });
});

describe('navigate', () => {
  it('pushes the based href, not the raw app-relative path', () => {
    const pushState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/app/blog/' },
      history: { pushState },
      dispatchEvent,
    });

    navigate('/discover');

    expect(pushState).toHaveBeenCalledWith({}, '', '/app/blog/discover');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});

describe('navigate → clientPath round-trip', () => {
  it('the pushed URL strips back to the app-relative route that matches', () => {
    // What navigate() would push for `/discover` under /app/blog/…
    setLocation('/app/blog/');
    const pushed = toHref('/discover'); // '/app/blog/discover'

    // The router derives its client path from the new pathname…
    const routes: RouteEntry[] = [
      { routePath: '/', Component: (() => null) as unknown as RouteEntry['Component'] },
      { routePath: '/discover', Component: (() => null) as unknown as RouteEntry['Component'] },
    ];
    setLocation(pushed);
    const cp = clientPath(pushed);
    expect(cp).toBe('/discover');
    expect(matchRoutes(routes, cp)?.entry.routePath).toBe('/discover');
  });
});

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
  const routes: RouteEntry[] = [
    { routePath: '/', Component: (() => null) as unknown as RouteEntry['Component'] },
    { routePath: '/park-fees', Component: (() => null) as unknown as RouteEntry['Component'] },
    { routePath: '/items/:id', Component: (() => null) as unknown as RouteEntry['Component'] },
  ];

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
  const routes: RouteEntry[] = [
    { routePath: '/', Component: (() => null) as unknown as RouteEntry['Component'] },
    { routePath: '/plants', Component: (() => null) as unknown as RouteEntry['Component'] },
    { routePath: '/plants/:id', Component: (() => null) as unknown as RouteEntry['Component'] },
    { routePath: '/plants/new', Component: (() => null) as unknown as RouteEntry['Component'] },
  ];

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
    const flipped: RouteEntry[] = [routes[3]!, routes[2]!];
    expect(matchRoutes(flipped, '/plants/new')?.entry.routePath).toBe('/plants/new');
    expect(matchRoutes(flipped, '/plants/p1')?.entry.routePath).toBe('/plants/:id');
  });

  it('prefers the FEWER-parameter route when several match', () => {
    const table: RouteEntry[] = [
      { routePath: '/a/:x/:y', Component: (() => null) as unknown as RouteEntry['Component'] },
      { routePath: '/a/:x/fixed', Component: (() => null) as unknown as RouteEntry['Component'] },
    ];
    expect(matchRoutes(table, '/a/1/fixed')?.entry.routePath).toBe('/a/:x/fixed');
    expect(matchRoutes(table, '/a/1/2')?.entry.routePath).toBe('/a/:x/:y');
  });
});

// ── Page error boundary ───────────────────────────────────────────────────────
// Pages are LLM-authored and bound to a live, drifting database, so one will eventually hit a null
// it did not expect. Live (scenario 07): the invoices page did `row.vat_rate.toFixed(2)` on a row
// whose column was NULL — every route 200'd, the data API was fine, and the user got a **blank
// white page for the whole app**, dock included. React unmounts the entire tree on an uncaught
// render error; the boundary contains the damage to the page that threw.
describe('PageErrorBoundary', () => {
  const BOOM = new TypeError("Cannot read properties of null (reading 'toFixed')");

  it('renders its children when nothing throws', () => {
    const b = new PageErrorBoundary({ children: 'the page' });
    expect(b.render()).toBe('the page');
  });

  it('swaps in a fallback that names the failure and keeps the rest of the app usable', () => {
    const b = new PageErrorBoundary({ children: 'the page' });
    b.state = PageErrorBoundary.getDerivedStateFromError(BOOM);
    const html = renderToStaticMarkup(b.render() as React.ReactElement);

    expect(html).not.toContain('the page');
    expect(html).toContain('This page failed to render');
    expect(html).toContain('The rest of the app still works');
    expect(html).toContain("reading &#x27;toFixed&#x27;"); // the real message, escaped
  });

  it('derives error state from any thrown error', () => {
    expect(PageErrorBoundary.getDerivedStateFromError(BOOM)).toEqual({ error: BOOM });
  });
});
