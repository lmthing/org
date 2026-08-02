import * as Prim from '@lmthing/ui/elements/primitives';
import { useEffect, useRef, useState } from 'react'
import { useAuth, isPodEmbedded, isLocalRun } from '@lmthing/auth'
import { CLOUD_BASE_URL } from '@/lib/config'
import { WakingScreen } from '@/lib/waking-screen'

export const centerStyles = { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--muted-foreground)", flexDirection: "column", gap: 12 } as const

/**
 * Block rendering until auth has resolved. An unauthenticated web user is sent to
 * lmthing.com to sign in (the SSO bridge) and returns here authenticated — there is
 * no embedded login form on the web product surfaces.
 *
 * `login()` keeps the iframe-embed case working unchanged: when this surface is
 * embedded (e.g. computer inside chat) it asks the parent for its session rather
 * than navigating away.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login } = useAuth()
  useEffect(() => {
    if (!isLoading && !isAuthenticated) login()
  }, [isLoading, isAuthenticated, login])
  if (isLoading || !isAuthenticated) return <WakingScreen mode="signing-in" />
  return <>{children}</>
}

interface PodProgress {
  ready?: boolean
  computeTag?: string
  stage?: string
  progress?: number
}

interface EnsurePodResult {
  pod?: PodProgress
}

/** Live boot progress surfaced to the WakingScreen. Monotonic (never regresses). */
export interface WakeProgress {
  progress?: number
  stage?: string
}

/** Ensure the user's compute pod is running before any pod API call. */
async function ensurePod(
  computeBase: string,
  getAccessToken: () => Promise<string>,
): Promise<EnsurePodResult> {
  const token = await getAccessToken()
  const res = await fetch(`${computeBase}/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
  return res.json() as Promise<EnsurePodResult>
}

/** Latest compute image tag CI has built, per the gateway. `null` if unknown. */
async function fetchLatestTag(): Promise<string | null> {
  try {
    // Always the shared, unauthenticated gateway route — the latest built image
    // tag is a property of CI, not of any one pod.
    const res = await fetch(`${CLOUD_BASE_URL}/api/compute/version`)
    if (!res.ok) return null
    const data = (await res.json()) as { tag?: string | null }
    return data.tag ?? null
  } catch {
    return null
  }
}

async function upgradePod(
  computeBase: string,
  getAccessToken: () => Promise<string>,
): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${computeBase}/upgrade`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/upgrade failed: ${res.status}`)
  }
}

/**
 * Poll pod status until it reports ready, or give up after ~45s. Used on cold
 * wake: the gateway's /ensure returns after a bounded (~9s) wait, so a slower
 * boot can come back not-ready — keep polling here so we never mount children
 * against a not-serving pod (which would hit Envoy "connection refused" 503s).
 */
async function pollUntilReady(
  computeBase: string,
  getAccessToken: () => Promise<string>,
  onProgress?: (p: WakeProgress) => void,
): Promise<void> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const token = await getAccessToken()
      const res = await fetch(`${computeBase}/status`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { pod?: PodProgress }
        if (data.pod) onProgress?.({ progress: data.pod.progress, stage: data.pod.stage })
        if (data.pod?.ready) return
      }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Timed out waiting for your workspace to start')
}

/**
 * Wait until the pod's OWN edge actually serves before mounting children.
 *
 * The gateway reports `ready` on `readyReplicas>0`, which flips the instant the
 * pod's startupProbe (`/api/sessions`) first passes — but the pod has no
 * readinessProbe, and Envoy still needs a beat to register the freshly-woken
 * endpoint. In that window a same-origin pod request (`/api/*` → Envoy → pod)
 * 503s / connection-refuses. Mounting a surface then means its first data fetch
 * (chat's `/api/projects`, studio's project list, computer's session) races the
 * not-yet-wired data path and silently renders empty.
 *
 * So after the gateway says ready, probe the pod's edge directly (relative URL
 * → this domain's `*-api-proxy` → the user's pod) until it responds with
 * anything other than Envoy's no-endpoint 503/504. This is shared by all three
 * surfaces via PodEnsureGate, so the fix lands everywhere at once. Throws on
 * timeout so the gate shows its Retry state rather than an empty shell.
 */
export async function waitForPodEdge(
  getAccessToken: () => Promise<string>,
  { timeoutMs = 25_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 0
  while (Date.now() < deadline) {
    try {
      const token = await getAccessToken()
      // Same-origin (NOT CLOUD_BASE_URL): hits the pod through this domain's
      // Envoy api-proxy, exactly like the surface's own fetches will.
      const res = await fetch('/api/sessions', {
        headers: { authorization: `Bearer ${token}` },
      })
      lastStatus = res.status
      // Envoy's own no-endpoint reply is a locally-generated 503/504; anything
      // else (200, 401, 404, …) means the endpoint is wired and the pod serves.
      if (res.status !== 503 && res.status !== 504) return
    } catch {
      /* connection refused during endpoint propagation — keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `Your workspace started but isn't serving yet (last status ${lastStatus || 'no response'})`,
  )
}

/** Poll pod status until it's ready on `expectedTag`, or give up after ~2 minutes. */
async function pollUntilUpgraded(
  computeBase: string,
  getAccessToken: () => Promise<string>,
  expectedTag: string,
  onProgress?: (p: WakeProgress) => void,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const token = await getAccessToken()
      const res = await fetch(`${computeBase}/status`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { pod?: PodProgress }
        if (data.pod) onProgress?.({ progress: data.pod.progress, stage: data.pod.stage })
        if (data.pod?.ready && data.pod.computeTag === expectedTag) return
      }
    } catch {
      /* still restarting */
    }
  }
  throw new Error('Timed out waiting for the pod to come back up')
}

// Tags the user has already dismissed the upgrade prompt for, this browser
// session — avoids re-nagging on every route (chat/studio/computer each mount
// their own gate) once they've said "not now" for a given build.
const UPGRADE_DISMISSED_KEY = 'lmthing:upgrade-dismissed-tag'

// How often a live surface re-checks for a newer compute image after it's
// booted. The cold-boot check (in `init`) blocks; this one only ever raises a
// non-blocking banner, so a longer interval is fine — it exists so long-lived
// surfaces (studio/computer/app IDE tabs, left open for hours) notice a new
// build without a reload, the same way chat does on its frequent remounts.
const UPGRADE_POLL_MS = 60_000

// How often a VISIBLE surface pings the pod's keep-warm heartbeat so an
// actively-viewed pod doesn't idle out (free tier idles at 15 min) and force a
// cold wake on the user's next click. Comfortably under the idle TTL for margin.
const KEEPALIVE_MS = 5 * 60_000

type PodGateStatus = 'pending' | 'ready' | 'error' | 'upgrade-available' | 'upgrading'

/**
 * Generic pod-readiness gate shared by the studio, computer, and chat surfaces.
 * On an authenticated session it POSTs {CLOUD_BASE_URL}/api/compute/ensure
 * (Bearer JWT), renders a "Starting compute pod…" state (+ Retry on failure),
 * and only renders children once ensure resolves. If the pod's running image
 * tag is older than the latest one CI has built, it shows an "Upgrade
 * available" prompt (rolling-restart via /api/compute/upgrade) instead of
 * silently forcing a restart — the user chooses when to take the pod down.
 * Pod-embedded (iframe) runs skip the fetch and render children immediately.
 */
/**
 * Which compute pod this gate is responsible for.
 *
 * `base` is the gateway route prefix that provisions it, and `getToken` the
 * token those (control-plane) calls carry. `edgeToken` is a different thing: the
 * token used for SAME-ORIGIN probes and keepalives, which go through this
 * domain's Envoy proxy into the pod itself. For a personal surface both are the
 * user's own token; on lmthing.team the control plane still takes the personal
 * token (membership is checked gateway-side) while the edge needs the
 * team-scoped one, because Envoy routes by its `team` claim.
 */
export interface PodTarget {
  base: string
  getToken: () => Promise<string>
  edgeToken: () => Promise<string>
}

interface PodEnsureGateProps {
  children: React.ReactNode
  /** Defaults to the signed-in user's own pod. */
  target?: PodTarget
}

/**
 * The bypass, split into a component that calls NO hooks of its own.
 *
 * Pod-embedded (token injected) or local run (the pod is the server itself): there is no cloud
 * gateway to ensure anything through, so none of the machinery below should run — not the ensure
 * call, not the edge poll, not the upgrade poll.
 *
 * The bypass used to be an early `return` INSIDE the body below, above eleven hook calls, which made
 * the number of hooks the component calls depend on a condition. React matches hook state
 * positionally, so that is either "Rendered fewer hooks than expected" or this component silently
 * reading another hook's state. It has not bitten because `isPodEmbedded()`/`isLocalRun()` read
 * deployment facts that never change within a session — the hook count is stable BY ACCIDENT, not by
 * construction, and the day one of those predicates starts reading something reactive it becomes
 * state corruption in the gate that fronts every surface.
 *
 * Splitting is what keeps the original intent. Moving the `return` below the hooks would fix the
 * ordering and start running every effect in pod-embedded mode — real network calls that exist
 * precisely to be skipped there. Here the inner component either mounts or does not.
 *
 * Found by `react-hooks/rules-of-hooks`, which had never run anywhere in this monorepo: the plugin
 * was a declared dependency of `@lmthing/config` that its flat config never registered.
 */
export function PodEnsureGate(props: PodEnsureGateProps) {
  if (isPodEmbedded() || isLocalRun()) return <>{props.children}</>
  return <PodEnsureGateInner {...props} />
}

function PodEnsureGateInner({ children, target }: PodEnsureGateProps) {
  const { session, getAccessToken } = useAuth()
  const computeBase = target?.base ?? `${CLOUD_BASE_URL}/api/compute`
  const controlToken = target?.getToken ?? getAccessToken
  const edgeToken = target?.edgeToken ?? getAccessToken
  const [status, setStatus] = useState<PodGateStatus>('pending')
  const [error, setError] = useState<string | null>(null)
  // Live cold-boot progress from /api/compute/status, clamped monotonic so the
  // bar never regresses across polls (a rare pod restart would otherwise dip it).
  const [wake, setWake] = useState<WakeProgress>({})
  const reportProgress = (p: WakeProgress) =>
    setWake((prev) => ({
      stage: p.stage ?? prev.stage,
      progress:
        p.progress == null ? prev.progress : Math.max(prev.progress ?? 0, p.progress),
    }))
  const [latestTag, setLatestTag] = useState<string | null>(null)
  // Newer tag detected *after* boot, while the surface is live — surfaced as a
  // non-blocking banner (never the full-screen card) so we don't yank the user
  // out of studio/computer/app mid-task. null = nothing to offer.
  const [bannerTag, setBannerTag] = useState<string | null>(null)
  // The image tag the pod is currently running, per the last ensure/upgrade.
  // Baseline for the live poll below.
  const currentTagRef = useRef<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (!session?.accessToken || initRef.current) return
    initRef.current = true

    let cancelled = false
    async function init() {
      try {
        const [ensureResult, latest] = await Promise.all([
          ensurePod(computeBase, controlToken),
          fetchLatestTag(),
        ])
        if (cancelled) return

        const currentTag = ensureResult.pod?.computeTag
        currentTagRef.current = currentTag ?? null

        // /ensure resolves after a bounded wait; if the freshly-woken pod isn't
        // serving yet, wait for real readiness before mounting children so they
        // never race the cold-boot window and hit Envoy 503s.
        if (ensureResult.pod && ensureResult.pod.ready === false) {
          // Seed the bar with the milestone /ensure already observed.
          reportProgress({ progress: ensureResult.pod.progress, stage: ensureResult.pod.stage })
          await pollUntilReady(computeBase, controlToken, (p) => {
            if (!cancelled) reportProgress(p)
          })
          if (cancelled) return
        }

        // The gateway's `ready` precedes the pod's Envoy edge actually serving
        // (no readinessProbe; EDS propagation lag). Confirm the same-origin pod
        // edge responds before mounting any surface, so children never race a
        // not-yet-wired data path and render empty. Cheap no-op for a warm pod.
        await waitForPodEdge(edgeToken)
        if (cancelled) return

        const dismissed = sessionStorage.getItem(UPGRADE_DISMISSED_KEY)
        if (latest && currentTag && latest !== currentTag && latest !== dismissed) {
          setLatestTag(latest)
          setStatus('upgrade-available')
        } else {
          setStatus('ready')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    }
    void init()
    return () => {
      cancelled = true
    }
    // Depend on the stable token STRING, not the `session` object / `getAccessToken`
    // closure (both change identity on unrelated re-renders). Re-running the effect
    // mid-`ensure` would cancel the in-flight init (cancelled=true) while initRef
    // blocked a re-run, leaving the gate stuck on "Starting compute pod…" forever —
    // far more likely now that scale-to-zero means pods are often cold-starting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken])

  // Live poll: once the surface is up, keep an eye out for a newer build so a
  // long-open studio/computer/app tab offers the upgrade (as a banner) without
  // needing a reload. Only runs in the 'ready' state — never while a blocking
  // card/spinner is showing — and never re-nags a dismissed tag.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const id = setInterval(() => {
      void (async () => {
        const latest = await fetchLatestTag()
        if (cancelled || !latest) return
        const current = currentTagRef.current
        const dismissed = sessionStorage.getItem(UPGRADE_DISMISSED_KEY)
        if (current && latest !== current && latest !== dismissed) {
          setBannerTag(latest)
        }
      })()
    }, UPGRADE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [status])

  // Keep-warm: while this surface's tab is visible, ping the pod's keep-warm
  // heartbeat so a user actively reading/using an open tab doesn't idle the pod
  // out (and eat a cold wake on their next click). A POST bumps the pod's
  // activity clock; a hidden/closed tab stops pinging → normal idle-out resumes.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const ping = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const token = await edgeToken()
        // Same-origin (pod edge, via Envoy), not the gateway.
        await fetch('/api/keepalive', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
      } catch {
        /* best-effort */
      }
    }
    void ping() // close any gap from a just-became-visible tab
    const id = setInterval(() => {
      if (!cancelled) void ping()
    }, KEEPALIVE_MS)
    // Also ping immediately when the tab returns to the foreground.
    const onVis = () => {
      if (document.visibilityState === 'visible') void ping()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const handleRetry = () => {
    initRef.current = false
    setError(null)
    setWake({})
    setStatus('pending')
  }

  const handleUpgrade = async (tag: string | null = latestTag) => {
    if (!tag) return
    setBannerTag(null)
    setWake({})
    setStatus('upgrading')
    try {
      await upgradePod(computeBase, controlToken)
      await pollUntilUpgraded(computeBase, controlToken, tag, reportProgress)
      // Same edge race as cold wake: the restarted pod reports ready before
      // Envoy re-wires it. Wait for the pod edge before returning to the surface.
      await waitForPodEdge(edgeToken)
      currentTagRef.current = tag
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const handleContinueWithoutUpgrading = () => {
    if (latestTag) sessionStorage.setItem(UPGRADE_DISMISSED_KEY, latestTag)
    setStatus('ready')
  }

  const handleDismissBanner = () => {
    if (bannerTag) sessionStorage.setItem(UPGRADE_DISMISSED_KEY, bannerTag)
    setBannerTag(null)
  }

  if (!session) {
    return <WakingScreen mode="signing-in" />
  }

  if (status === 'error') {
    return (
      <Prim.Box {...centerStyles}>
        <Prim.Text as="p" color="var(--destructive)">Failed to start compute pod: {error}</Prim.Text>
        <Prim.Pressable onClick={handleRetry}>Retry</Prim.Pressable>
      </Prim.Box>
    )
  }

  if (status === 'pending') {
    return <WakingScreen mode="waking" progress={wake.progress} />
  }

  if (status === 'upgrading') {
    return <WakingScreen mode="upgrading" progress={wake.progress} />
  }

  if (status === 'upgrade-available') {
    return (
      <Prim.Box {...centerStyles}>
        <Prim.Box {...upgradeCardStyles.card}>
          <Prim.Text as="p" {...upgradeCardStyles.heading}>New version available</Prim.Text>
          <Prim.Text as="p" {...upgradeCardStyles.sub}>
            Your compute pod is running an older version. Upgrade now to get the
            latest features and fixes — this briefly restarts your pod.
          </Prim.Text>
          <Prim.Box {...upgradeCardStyles.actions}>
            <Prim.Pressable onClick={() => { void handleUpgrade() }} {...upgradeCardStyles.btnPrimary}>
              Upgrade
            </Prim.Pressable>
            <Prim.Pressable onClick={handleContinueWithoutUpgrading} {...upgradeCardStyles.btn}>
              Continue without upgrading
            </Prim.Pressable>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    )
  }

  return (
    <>
      {children}
      {bannerTag && (
        <Prim.Box style={upgradeBannerStyles.bar} role="status">
          <Prim.Text style={upgradeBannerStyles.text}>
            A new version of your compute pod is available.
          </Prim.Text>
          <Prim.Box style={upgradeBannerStyles.actions}>
            <Prim.Pressable
              onClick={() => { void handleUpgrade(bannerTag) }}
              style={upgradeBannerStyles.btnPrimary}
            >
              Upgrade
            </Prim.Pressable>
            <Prim.Pressable onClick={handleDismissBanner} style={upgradeBannerStyles.btn}>
              Dismiss
            </Prim.Pressable>
          </Prim.Box>
        </Prim.Box>
      )}
    </>
  )
}

const upgradeBannerStyles = {
  bar: {
    position: 'fixed' as const,
    left: '50%',
    bottom: 24,
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '10px 16px',
    borderRadius: 10,
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    maxWidth: 'calc(100vw - 32px)',
  },
  text: {
    fontSize: 14,
    color: 'var(--color-foreground)',
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexShrink: 0,
  },
  btn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-foreground)',
    cursor: 'pointer',
    fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-primary)',
    color: 'var(--color-primary-foreground)',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
} satisfies Record<string, React.CSSProperties>

const upgradeCardStyles = {
  card: { backgroundColor: "var(--color-card)", borderWidth: "1px", borderStyle: "solid", borderColor: "var(--color-border)", borderRadius: 12, paddingVertical: "32px", paddingHorizontal: "40px", maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", gap: 12 } as const,
  heading: { fontSize: 18, fontWeight: 600, color: "var(--color-foreground)", margin: 0 } as const,
  sub: { fontSize: 14, color: "var(--color-muted-foreground)", margin: 0, lineHeight: 1.5 } as const,
  actions: { display: "flex", gap: 8, justifyContent: "center", marginTop: 8 } as const,
  btn: { paddingVertical: "8px", paddingHorizontal: "16px", borderRadius: 8, borderWidth: "1px", borderStyle: "solid", borderColor: "var(--color-border)", backgroundColor: "transparent", color: "var(--color-foreground)", cursor: "pointer" } as const,
  btnPrimary: { paddingVertical: "8px", paddingHorizontal: "16px", borderRadius: 8, borderWidth: 0, backgroundColor: "var(--color-primary)", color: "var(--color-primary-foreground)", cursor: "pointer", fontWeight: 600 } as const,
}
