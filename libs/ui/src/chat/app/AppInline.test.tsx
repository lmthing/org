/**
 * `AppInline` — the project's app rendered IN-PROCESS in the `/chat` main pane.
 *
 * The regression this pins: the pane used to be an `<iframe src="lmthing.app/…">`, which the served
 * app's CSP (`frame-ancestors 'self'`) refused to frame from `lmthing.chat`. `AppInline` renders the
 * same specs with `ViewRenderer` instead — so the load-bearing facts are (1) NO iframe, (2) it fetches
 * the render payload from `GET /api/apps/:id/views`, (3) it mounts `ViewRenderer` on the landing route
 * with the shell coerced to a left `sidebar`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../test-utils/index';

// Keep the real payload/route helpers + states; stub the heavy renderer and the data client so the
// test asserts AppInline's wiring, not section rendering.
vi.mock('../../view', async (importActual) => {
  const actual = await importActual<typeof import('../../view')>();
  return {
    ...actual,
    createViewClient: vi.fn(() => ({}) as unknown),
    ViewRenderer: (props: { shell?: { placement?: string }; route?: { path?: string } }) => (
      <div data-testid="view-renderer" data-placement={props.shell?.placement} data-route={props.route?.path}>
        rendered
      </div>
    ),
  };
});

const apiGet = vi.fn();
vi.mock('./api', () => ({ apiGet: (path: string) => apiGet(path) }));

const GROWN = {
  project: 'trip',
  views: [
    { route: 'index', title: 'Overview', sections: [] },
    { route: 'expenses', title: 'Expenses', sections: [] },
  ],
  layouts: [],
  components: [],
  shell: { assistant: { agent: 'thing' } },
  endpoints: {},
};

import { AppInline } from './AppInline';

beforeEach(() => {
  apiGet.mockReset();
});

describe('AppInline', () => {
  it('renders the app IN-PROCESS (no iframe) once the views payload loads', async () => {
    apiGet.mockResolvedValue(GROWN);
    const { container, getByTestId } = render(<AppInline projectId="trip" />);
    await waitFor(() => getByTestId('view-renderer'));
    expect(container.querySelector('iframe')).toBeNull();
    // Fetched the render payload (specs), not the sidebar manifest.
    expect(apiGet).toHaveBeenCalledWith('/api/apps/trip/views');
  });

  it('lands on the app’s initial route and coerces the shell to a left sidebar', async () => {
    apiGet.mockResolvedValue(GROWN);
    const { getByTestId } = render(<AppInline projectId="trip" />);
    const vr = await waitFor(() => getByTestId('view-renderer'));
    expect(vr.getAttribute('data-route')).toBe('index');
    expect(vr.getAttribute('data-placement')).toBe('sidebar');
  });

  it('shows an error state when the payload cannot be fetched', async () => {
    apiGet.mockRejectedValue(new Error('nope'));
    const { findByText, container } = render(<AppInline projectId="trip" />);
    await findByText(/Couldn’t load this app/i);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
