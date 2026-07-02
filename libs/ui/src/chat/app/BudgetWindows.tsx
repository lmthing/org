import React from 'react';
import { useStore } from '../store/store.js';
import { authHeaders } from './auth.js';

interface BudgetWindow {
  duration: string;
  label: string;
  remainingPct: number | null;
  resetsAt: string;
}

const POLL_MS = 30_000;

/**
 * A single muted line beneath the composer showing how much of each rolling
 * budget window (Today / Week / Month) is left, as percentages. Data comes from
 * the pod's same-origin `GET /api/budget` (computed from the lmthingcloud key).
 * Renders nothing off lmthingcloud (endpoint 404s) or in replay mode.
 */
export function BudgetWindows(): React.ReactElement | null {
  const mode = useStore((s) => s.mode);
  // Refetch whenever the running session cost changes so the numbers move right
  // after the agent spends.
  const sessionCost = useStore((s) => s.sessionCostUsd);
  const [windows, setWindows] = React.useState<BudgetWindow[] | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/budget', { headers: authHeaders() });
      if (!res.ok) {
        setWindows(null);
        return;
      }
      const data = (await res.json()) as { windows?: BudgetWindow[] };
      setWindows(Array.isArray(data.windows) && data.windows.length > 0 ? data.windows : null);
    } catch {
      setWindows(null);
    }
  }, []);

  React.useEffect(() => {
    if (mode === 'replay') return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [mode, load]);

  React.useEffect(() => {
    if (mode !== 'replay') void load();
  }, [sessionCost, mode, load]);

  if (mode === 'replay' || !windows) return null;

  return (
    <p className="mt-1 text-xs text-muted-foreground text-center" aria-label="Budget remaining">
      <span>Budget</span>
      {windows.map((w) => {
        const pct = w.remainingPct;
        const low = pct != null && pct < 15;
        return (
          <span key={w.duration}>
            {' · '}
            {w.label}{' '}
            <span className={low ? 'text-destructive' : undefined}>
              {pct != null ? `${Math.round(pct)}%` : '—'}
            </span>
          </span>
        );
      })}
      {' left'}
    </p>
  );
}
