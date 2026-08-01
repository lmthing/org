/**
 * `AppPages` — the selected project's app pages, as links above the composer.
 *
 * Three things worth pinning, because each fails SILENTLY (an empty row looks exactly like a
 * project with no app):
 *  1. a project whose manifest says `hasApp:false` contributes nothing at all;
 *  2. a page whose route has a dynamic segment is not linkable and must not be offered — there
 *     is no id to put in the URL, so the link can only 404;
 *  3. the href is the pod's `/app/<project>/<route>` mount, not a chat-relative path.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '../../test-utils/index';
import { AppPages, pageLabel } from './AppPages';

function mockManifest(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

beforeEach(() => {
  mockManifest({ hasApp: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppPages', () => {
  it('renders nothing without a selected project', () => {
    const { container } = render(<AppPages projectId={null} />);
    expect(container.querySelector('[data-testid="app-pages"]')).toBeNull();
  });

  it('renders nothing for a spaces-only project (hasApp:false)', async () => {
    const { container } = render(<AppPages projectId="system" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="app-pages"]')).toBeNull();
  });

  it('links every static page at the pod app mount, and drops the dynamic ones', async () => {
    mockManifest({
      hasApp: true,
      pages: [
        { routePath: '/' },
        { routePath: '/trips' },
        { routePath: '/trips/:tripId' },
        { routePath: '/settings/profile' },
      ],
    });
    const { container, findByText } = render(<AppPages projectId="trips" />);

    await findByText('Home');
    const links = Array.from(container.querySelectorAll('[data-testid="app-pages"] a'));
    expect(links.map((a) => a.getAttribute('data-route'))).toEqual([
      '/',
      '/trips',
      '/settings/profile',
    ]);
    // Same-origin on web (`apiBase()` is ''), under the reserved `/app/` prefix.
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/app/trips/',
      '/app/trips/trips',
      '/app/trips/settings/profile',
    ]);
    expect(links.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
  });

  it('collapses a long list behind "+N more"', async () => {
    mockManifest({
      hasApp: true,
      pages: ['/', '/a', '/b', '/c', '/d', '/e'].map((routePath) => ({ routePath })),
    });
    const { container, findByText } = render(<AppPages projectId="big" />);

    await findByText('+2 more');
    expect(container.querySelectorAll('[data-testid="app-pages"] a')).toHaveLength(4);
  });

  it('says nothing when the pod cannot answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { container } = render(<AppPages projectId="trips" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="app-pages"]')).toBeNull();
  });
});

describe('pageLabel', () => {
  it('names the index page and title-cases the full path', () => {
    expect(pageLabel('/')).toBe('Home');
    expect(pageLabel('/trips')).toBe('Trips');
    // The FULL path, so two pages with the same last segment stay distinguishable.
    expect(pageLabel('/settings/profile')).toBe('Settings / Profile');
    expect(pageLabel('/meal-plan')).toBe('Meal Plan');
  });
});
