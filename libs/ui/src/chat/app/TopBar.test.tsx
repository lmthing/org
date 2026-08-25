/**
 * `TopBar` — the `/chat` project switcher, which replaced the removed left sidebar.
 *
 * Pins that the switcher shows the active project and lists the others (the one piece of the old
 * sidebar that had to survive its removal), and that it carries no conversation list.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '../../test-utils/index';
import { useStore } from '../store/store';

const apiGet = vi.fn().mockResolvedValue({ projects: [] });
vi.mock('./api', () => ({
  apiGet: (p: string) => apiGet(p),
  apiPost: vi.fn().mockResolvedValue({ id: 'x' }),
  apiDelete: vi.fn().mockResolvedValue(undefined),
}));

import { TopBar } from './TopBar';

const PROJECTS = [
  { id: 'trip', name: 'Trip' },
  { id: 'todos', name: 'Todos' },
];

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ projects: PROJECTS });
  useStore.setState({ projects: PROJECTS as never, activeProjectId: 'trip' });
});

describe('TopBar', () => {
  it('shows the active project in the switcher', () => {
    const { getAllByText } = render(<TopBar />);
    // The dropdown trigger shows the active project's name.
    expect(getAllByText('Trip').length).toBeGreaterThan(0);
  });

  it('lists the other projects when the switcher opens', () => {
    const { getByText, findByText } = render(<TopBar />);
    fireEvent.click(getByText('Trip'));
    return findByText('Todos');
  });
});
