/**
 * Sidebar — the project's APP NAVIGATION, not a conversation list.
 *
 * The chat surface's side menu is now the app nav: it lists the selected project's openable app
 * pages (the `APP` section) plus the project switcher and spaces. The conversation HISTORY moved
 * into the chat block itself (the assistant dock the served app renders), so there is no
 * `Conversations` section and no per-session delete control in the sidebar anymore.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../test-utils/index';
import { useStore } from '../store/store';
import { Sidebar } from './Sidebar';

vi.mock('./api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path === '/api/projects') return { projects: [{ id: 'p1', name: 'Project One', createdAt: '2024-01-01T00:00:00.000Z' }] };
    if (path.includes('/app')) return { hasApp: true, pages: [{ routePath: '/' }, { routePath: '/expenses' }] };
    if (path.includes('/spaces')) return { spaces: [] };
    return {};
  }),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

describe('Sidebar — app navigation, no conversation list', () => {
  beforeEach(() => {
    useStore.setState({ activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Project One', createdAt: '2024-01-01T00:00:00.000Z' }] });
  });

  it('lists the app pages as the nav and shows no conversation list', async () => {
    const { queryByLabelText, findByText } = render(<Sidebar />);
    // The APP section lists the project's openable pages — the nav bar.
    await findByText('Expenses');
    // Conversation history is in the dock now, not the sidebar: no per-session delete control.
    expect(queryByLabelText('Delete conversation')).toBeNull();
  });
});
