import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '../../test-utils/index';
import { useNewbornToAppCoachMark, CoachMark } from './CoachMark';
import type { AppSurfaceState } from './use-app-pages';

/**
 * The chat→app demotion coach-mark (R3): fires ONCE per project, only on an observed
 * `newborn → app` transition, never on a project that was already an app, honoring a per-project
 * `localStorage` flag.
 */

// A tiny harness that drives the hook through a scripted sequence of (projectId, state) and reports
// how many times the coach-mark became visible.
function Harness({ steps }: { steps: Array<{ projectId: string | null; state: AppSurfaceState }> }) {
  const [i, setI] = React.useState(0);
  const step = steps[Math.min(i, steps.length - 1)]!;
  const { show, dismiss } = useNewbornToAppCoachMark(step.projectId, step.state);
  return (
    <div>
      <span data-testid="shown">{show ? 'yes' : 'no'}</span>
      <button data-testid="next" onClick={() => setI((n) => n + 1)}>
        next
      </button>
      <button data-testid="dismiss" onClick={dismiss}>
        dismiss
      </button>
    </div>
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has storage; guard for safety */
  }
});

describe('useNewbornToAppCoachMark', () => {
  it('fires on a newborn → app transition for a project', () => {
    const { getByTestId } = render(
      <Harness
        steps={[
          { projectId: 'p1', state: 'newborn' },
          { projectId: 'p1', state: 'app' },
        ]}
      />,
    );
    expect(getByTestId('shown').textContent).toBe('no');
    fireEvent.click(getByTestId('next'));
    expect(getByTestId('shown').textContent).toBe('yes');
  });

  it('does NOT fire for a project that is already an app on first observation', () => {
    const { getByTestId } = render(
      <Harness steps={[{ projectId: 'p1', state: 'app' }]} />,
    );
    expect(getByTestId('shown').textContent).toBe('no');
  });

  it('never fires twice for the same project (localStorage flag)', () => {
    // First mount: newborn → app fires and persists the flag.
    const first = render(
      <Harness
        steps={[
          { projectId: 'p1', state: 'newborn' },
          { projectId: 'p1', state: 'app' },
        ]}
      />,
    );
    fireEvent.click(first.getByTestId('next'));
    expect(first.getByTestId('shown').textContent).toBe('yes');
    first.unmount();

    // A fresh mount that re-runs the same transition must stay silent.
    const second = render(
      <Harness
        steps={[
          { projectId: 'p1', state: 'newborn' },
          { projectId: 'p1', state: 'app' },
        ]}
      />,
    );
    fireEvent.click(second.getByTestId('next'));
    expect(second.getByTestId('shown').textContent).toBe('no');
  });

  it('dismiss hides it', () => {
    const { getByTestId } = render(
      <Harness
        steps={[
          { projectId: 'p1', state: 'newborn' },
          { projectId: 'p1', state: 'app' },
        ]}
      />,
    );
    fireEvent.click(getByTestId('next'));
    expect(getByTestId('shown').textContent).toBe('yes');
    fireEvent.click(getByTestId('dismiss'));
    expect(getByTestId('shown').textContent).toBe('no');
  });
});

describe('CoachMark card', () => {
  it('renders the demotion hint and dismisses on tap', () => {
    const onDismiss = vi.fn();
    const { getByText } = render(<CoachMark onDismiss={onDismiss} />);
    expect(getByText('Your assistant lives here now')).toBeTruthy();
    fireEvent.click(getByText('Got it'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
