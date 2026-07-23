import * as Prim from '../../elements/primitives/index.js';
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
  const setBudgetBlocked = useStore((s) => s.setBudgetBlocked);
  const [windows, setWindows] = React.useState<BudgetWindow[] | null>(null);

  // A window at exactly 0% left is exhausted — LiteLLM 429s any send. Mirror that
  // in the store so the composer can block the send pre-emptively.
  React.useEffect(() => {
    const blocked = !!windows?.some((w) => w.remainingPct === 0);
    setBudgetBlocked(blocked);
    return () => setBudgetBlocked(false);
  }, [windows, setBudgetBlocked]);

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
    <Prim.Text as="p" className="mt-1 text-xs text-muted-foreground text-center" aria-label="Budget remaining">
      <Prim.Text>Budget</Prim.Text>
      {windows.map((w) => {
        const pct = w.remainingPct;
        const low = pct != null && pct < 15;
        return (
          <Prim.Text key={w.duration}>
            {' · '}
            {w.label}{' '}
            <Prim.Text className={low ? 'text-destructive' : undefined}>
              {pct == null ? '—' : pct === 0 ? '0%' : `${Math.max(1, Math.round(pct))}%`}
            </Prim.Text>
          </Prim.Text>
        );
      })}
      {' left'}
    </Prim.Text>
  );
}
