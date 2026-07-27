/**
 * Boot-sequencing only — not a screen. Mirrors the two things `PodEnsureGate`
 * (apps/web/src/lib/gates.tsx) does before mounting a surface, minus the parts
 * that only make sense on web (sessionStorage upgrade-dismiss tracking, the
 * same-origin relative fetch): wake the pod via the gateway, then confirm its
 * own edge is actually serving before ChatShell's first fetch races it.
 *
 * Native has no origin, so both calls are absolute — the control-plane call
 * against the gateway, the edge probe against the pod's own host
 * (`@lmthing/ui/platform#apiUrl`, same one ChatShell's fetches use).
 */
import { apiUrl } from '@lmthing/ui/platform'

const CLOUD_BASE_URL = 'https://lmthing.cloud'

export async function ensureComputePod(getAccessToken: () => Promise<string>): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${CLOUD_BASE_URL}/api/compute/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
}

/**
 * Poll the pod's own edge until it stops returning Envoy's no-endpoint 503/504
 * (the gateway can report the pod ready before Envoy has finished wiring the
 * freshly-woken endpoint — see `waitForPodEdge` in apps/web/src/lib/gates.tsx
 * for the full story). Throws on timeout.
 *
 * The budget covers a COLD wake, not just endpoint propagation. `/api/compute/ensure`
 * returns as soon as the deployment is scaled up, but a pod that was scaled to zero
 * still has to pull, boot and start serving — measured at well over 25s on a free-tier
 * pod that had been idle, which is why that first budget failed the device run with
 * `last status 503` while the very same pod answered 200 moments later.
 */
export async function waitForPodEdge(
  getAccessToken: () => Promise<string>,
  { timeoutMs = 120_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 0
  while (Date.now() < deadline) {
    try {
      const token = await getAccessToken()
      const res = await fetch(apiUrl('/api/sessions'), {
        headers: { authorization: `Bearer ${token}` },
      })
      lastStatus = res.status
      if (res.status !== 503 && res.status !== 504) return
    } catch {
      // connection refused during endpoint propagation — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`workspace started but isn't serving yet (last status ${lastStatus || 'no response'})`)
}
