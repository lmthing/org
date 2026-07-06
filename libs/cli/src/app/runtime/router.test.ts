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

import { toHref, navigate, linkDest, clientPath, matchRoutes, type RouteEntry } from './router.js';

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
