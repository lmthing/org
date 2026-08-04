/**
 * The sidebar's `APP` section — the selected project's application pages, as links.
 *
 * Four things worth pinning, because each fails SILENTLY (a missing section looks exactly like a
 * project that is not an application):
 *  1. a project whose manifest says `hasApp:false` contributes no section at all — most projects
 *     are not applications, and a permanent empty "App" header would be noise in the one place
 *     the reader scans for their conversations;
 *  2. a page whose route has a dynamic segment is not linkable and must not be offered — there
 *     is no id to put in the URL, so the link can only 404;
 *  3. the href is the pod's `/app/<project>/<route>` mount, not a chat-relative path;
 *  4. the rows are real anchors that open in a new tab — the app is another mount, and opening
 *     it must not take the reader's live chat with it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '../../test-utils/index';
import { useStore } from '../store/store';
import { pageLabel } from './use-app-pages';

const manifest = vi.hoisted(() => ({ current: { hasApp: false } as unknown }));

vi.mock('./api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path === '/api/projects') return { projects: [{ id: 'trips', name: 'Trips', createdAt: '2024-01-01T00:00:00.000Z' }] };
    if (/\/api\/projects\/[^/]+\/app$/.test(path)) return manifest.current;
    if (path.includes('/sessions')) return { sessions: [] };
    if (path.includes('/spaces')) return { spaces: [] };
    return {};
  }),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

// Imported AFTER the mock is declared so `Sidebar`'s own `./api` import is the mocked one.
const { Sidebar } = await import('./Sidebar');

const SECTION = '[data-testid="sidebar-app-pages"]';

beforeEach(() => {
  manifest.current = { hasApp: false };
  useStore.setState({
    activeProjectId: 'trips',
    projects: [{ id: 'trips', name: 'Trips', createdAt: '2024-01-01T00:00:00.000Z' }],
  });
});

describe('Sidebar — the app pages section', () => {
  it('renders no section for a project that is not an application', async () => {
    const { container, findByText } = render(<Sidebar />);
    // Wait for a section that IS always there, so the absence below is a settled answer rather
    // than a race with the manifest fetch.
    await findByText('Spaces');
    await waitFor(() => expect(container.querySelector(SECTION)).toBeNull());
  });

  it('lists every static page at the pod app mount, and drops the dynamic ones', async () => {
    manifest.current = {
      hasApp: true,
      pages: [
        { routePath: '/' },
        { routePath: '/trips' },
        { routePath: '/trips/:tripId' },
        { routePath: '/settings/profile' },
      ],
    };
    const { container, findByText } = render(<Sidebar />);

    await findByText('Home');
    const links = Array.from(container.querySelectorAll(`${SECTION} a`));
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
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'Trips', 'Settings / Profile']);
  });

  it('renders no section when the app has pages but none is linkable', async () => {
    manifest.current = { hasApp: true, pages: [{ routePath: '/trips/:tripId' }] };
    const { container, findByText } = render(<Sidebar />);
    await findByText('Spaces');
    await waitFor(() => expect(container.querySelector(SECTION)).toBeNull());
  });

  // The mobile host passes `onOpenAppPage` so a page renders NATIVELY. The rows are then NOT anchors
  // (nothing must navigate the surface away from the live chat) — they call the host with the active
  // project and the tapped route, and the host owns the screen.
  it('calls onOpenAppPage with the active project and route instead of linking, when the host renders natively', async () => {
    manifest.current = { hasApp: true, pages: [{ routePath: '/' }, { routePath: '/trips' }] };
    const onOpenAppPage = vi.fn();
    const { container, findByText } = render(<Sidebar onOpenAppPage={onOpenAppPage} />);

    await findByText('Home');
    // No anchors on this path — the app is rendered in-host, not opened as another mount.
    expect(container.querySelectorAll(`${SECTION} a`).length).toBe(0);

    const trips = container.querySelector(`${SECTION} [data-route="/trips"]`);
    expect(trips).not.toBeNull();
    fireEvent.click(trips!);
    expect(onOpenAppPage).toHaveBeenCalledWith({ id: 'trips', name: 'Trips' }, '/trips');
  });
});

describe('pageLabel', () => {
  it('names the index page and title-cases the FULL path', () => {
    expect(pageLabel('/')).toBe('Home');
    expect(pageLabel('/trips')).toBe('Trips');
    expect(pageLabel('/settings/profile')).toBe('Settings / Profile');
    // Two pages can share a last segment — the label keeps them apart.
    expect(pageLabel('/packing-list')).toBe('Packing List');
    expect(pageLabel('/posts/edit')).toBe('Posts / Edit');
  });
});
