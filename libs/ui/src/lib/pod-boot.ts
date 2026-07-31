/**
 * Boot-sequencing for a hosted compute pod — not a screen.
 *
 * Two things must be true before any surface makes its first pod fetch: the pod is scaled up, and
 * its own edge is actually serving. Getting the second one wrong is not a slow start, it is a
 * failed one — `/api/compute/ensure` returns as soon as the deployment scales, but Envoy may not
 * have finished wiring the freshly-woken endpoint, so the surface's first request races it and
 * loses.
 *
 * This lives here rather than in an app because it had already been written TWICE — once in
 * `apps/web/src/lib/gates.tsx` (`PodEnsureGate`/`waitForPodEdge`) and once in
 * `apps/mobile/src/ensure-pod.ts` — and the desktop shell would have been the third. Three copies
 * of a 120-second timeout is three places for it to quietly stop agreeing.
 *
 * The web copy keeps the parts that are genuinely web-only (its `sessionStorage` upgrade-dismiss
 * tracking, the build-tag poll); this is the half all three targets need identically.
 */
import { dataPlaneOrigin } from './app-urls'
import { apiUrl } from '../platform/api-base'

export interface PodBootOptions {
  /**
   * Override the gateway origin. Defaults to `dataPlaneOrigin('cloud')`, which already resolves
   * correctly on all three targets — same-origin/derived on web, `EXPO_PUBLIC_CLOUD_BASE` on
   * native, the injected bridge on desktop. Present for tests, not for hosts: a host that needs a
   * different gateway should say so through its own seam, so the two halves of a build cannot
   * disagree about which gateway they are talking to.
   */
  cloudBase?: string
}

/** Wake (or scale up) the caller's compute pod. Throws on a non-OK gateway response. */
export async function ensureComputePod(
  getAccessToken: () => Promise<string>,
  { cloudBase }: PodBootOptions = {},
): Promise<void> {
  const base = cloudBase ?? dataPlaneOrigin('cloud')
  const token = await getAccessToken()
  const res = await fetch(`${base}/api/compute/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
}

export interface PodEdgeOptions {
  timeoutMs?: number
  intervalMs?: number
}

/**
 * Poll the pod's own edge until it stops returning Envoy's no-endpoint 503/504. Throws on timeout.
 *
 * The budget covers a COLD wake, not just endpoint propagation: a pod that was scaled to zero still
 * has to pull, boot and start serving, measured at well over 25s on an idle free-tier pod. That is
 * why an earlier, shorter budget failed a device run with `last status 503` while the very same pod
 * answered 200 moments later — the timeout was reporting on itself, not on the pod.
 *
 * A thrown connection error is NOT a failure here. During endpoint propagation the connection is
 * refused outright, which is the same condition as the 503 and must keep polling rather than
 * abandon a pod that is seconds from ready.
 */
export async function waitForPodEdge(
  getAccessToken: () => Promise<string>,
  { timeoutMs = 120_000, intervalMs = 1_000 }: PodEdgeOptions = {},
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
  throw new Error(
    `workspace started but isn't serving yet (last status ${lastStatus || 'no response'})`,
  )
}
