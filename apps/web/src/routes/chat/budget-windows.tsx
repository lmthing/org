import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { CLOUD_BASE_URL } from '@/lib/config'
import { remainingPct, type BudgetWindow, type Usage } from './budget-math'

const POLL_MS = 30_000

/** Fetches the authenticated user's budget windows from the cloud gateway,
 *  polling periodically and on tab refocus so the bars track spend over time. */
function useBudgetWindows(enabled: boolean): Usage | null {
  const { authFetch, isAuthenticated } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !isAuthenticated) return
    try {
      const res = await authFetch(`${CLOUD_BASE_URL}/api/billing/usage`)
      if (!res.ok) return
      const data = (await res.json()) as Usage
      if (Array.isArray(data.budgets) && data.budgets.length > 0) setUsage(data)
    } catch {
      // Gateway unreachable — leave the last known value (or null); footer hides.
    }
  }, [enabled, isAuthenticated, authFetch])

  useEffect(() => {
    if (!enabled || !isAuthenticated) return
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, isAuthenticated, load])

  return usage
}

function WindowBar({ w }: { w: BudgetWindow }) {
  const pct = remainingPct(w)
  const low = pct != null && pct < 15
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{w.duration}</span>
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
        {pct != null && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${low ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
        {pct != null ? `${Math.round(pct)}%` : '—'}
      </span>
    </div>
  )
}

/**
 * Budget-window indicator rendered beneath the chat composer. Shows the
 * percentage of each rolling spend window (5h / 7d / 30d) still available.
 *
 * On production the platform always runs on the lmthingcloud provider, so the
 * windows always apply there; in local dev (no cloud gateway) it renders nothing.
 */
export function BudgetWindows() {
  const prod = import.meta.env.PROD
  const usage = useBudgetWindows(prod)

  if (!prod || !usage || usage.budgets.length === 0) return null

  return (
    <div
      className="mx-auto mt-2 flex max-w-xs flex-col gap-1 text-xs"
      aria-label="Budget remaining"
    >
      {usage.budgets.map((w) => (
        <WindowBar key={w.duration} w={w} />
      ))}
    </div>
  )
}
