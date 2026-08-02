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

// ── /pages/ prefix tolerance + static-beats-param ranking ─────────────────────
// The matcher's pure unit cases (stripPagesPrefix, matchRoutes /pages/ fallback,
// and the static-segment-beats-parameter ranking) moved to the shared module's
// own test at `libs/ui/src/view/router.test.ts` when the matcher was extracted
// out of here — see `libs/ui/src/view/router.ts`. The round-trip case below still
// exercises matchRoutes through this package's clientPath/toHref, proving the
// re-export glues together correctly.

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
