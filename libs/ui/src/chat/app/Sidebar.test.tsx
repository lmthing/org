/**
 * Sidebar — the session list. Regression coverage for a touch + native bug: the per-session
 * delete (×) button used `display="none"` revealed only by `$group-hover`, a WEB-only Tamagui
 * affordance with no native fork at all (see `elements/primitives/_native.tsx`) and, even on web,
 * reachable only by a pointer that can hover — never on touch. A phone (or native app) user could
 * not delete a chat session at all.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '../../test-utils/index';
import { useStore } from '../store/store';
import { Sidebar } from './Sidebar';

vi.mock('./api', () => ({
  apiGet: vi.fn(async (path: string) => {
    if (path === '/api/projects') return { projects: [{ id: 'p1', name: 'Project One', createdAt: '2024-01-01T00:00:00.000Z' }] };
    if (path.includes('/sessions')) {
      return {
        sessions: [
          {
            sessionId: 's1',
            projectId: 'p1',
            agentSlug: 'thing',
            spaceDir: '/x',
            title: 'A conversation',
            lastActivity: Date.now(),
            status: 'idle',
          },
        ],
      };
    }
    if (path.includes('/spaces')) return { spaces: [] };
    return {};
  }),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

describe('Sidebar — session delete affordance', () => {
  beforeEach(() => {
    useStore.setState({ activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Project One', createdAt: '2024-01-01T00:00:00.000Z' }] });
  });

  it('renders the delete control without display:none / a hover-only reveal', async () => {
    const { getByLabelText, getByText } = render(<Sidebar />);
    await waitFor(() => expect(getByText('A conversation')).toBeTruthy());

    const deleteBtn = getByLabelText('Delete conversation');
    expect(deleteBtn).toBeTruthy();
    // Was `display="none"` + `$group-hover={{ display: "flex" }}` — a web-only pointer-hover
    // affordance absent on native and unreachable on touch even on web. Neither the element
    // itself nor any ancestor up to the row may carry a `display: none` — its precise absence
    // (not just presence in the DOM) is what "reachable" means here.
    let node: HTMLElement | null = deleteBtn;
    while (node) {
      expect(node.style.display).not.toBe('none');
      expect(node.className).not.toMatch(/_dsp-none\b/);
      node = node.parentElement;
    }
  });
});
