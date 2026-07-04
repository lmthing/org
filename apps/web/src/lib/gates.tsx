import { useEffect, useRef, useState } from 'react'
import { useAuth, isPodEmbedded, isLocalRun } from '@lmthing/auth'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { CLOUD_BASE_URL } from '@/lib/config'

export const centerStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  color: 'var(--muted-foreground)',
  flexDirection: 'column',
  gap: 12,
}

/** Block rendering until auth has resolved; show login when not authenticated. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <LoginScreen />
  return <>{children}</>
}

interface EnsurePodResult {
  pod?: { computeTag?: string; ready?: boolean }
}

/** Ensure the user's compute pod is running before any pod API call. */
async function ensurePod(
  cloudBaseUrl: string,
  getAccessToken: () => Promise<string>,
): Promise<EnsurePodResult> {
  const token = await getAccessToken()
  const res = await fetch(`${cloudBaseUrl}/api/compute/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
  return res.json() as Promise<EnsurePodResult>
}

/** Latest compute image tag CI has built, per the gateway. `null` if unknown. */
async function fetchLatestTag(cloudBaseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${cloudBaseUrl}/api/compute/version`)
    if (!res.ok) return null
    const data = (await res.json()) as { tag?: string | null }
    return data.tag ?? null
  } catch {
    return null
  }
}

async function upgradePod(
  cloudBaseUrl: string,
  getAccessToken: () => Promise<string>,
): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${cloudBaseUrl}/api/compute/upgrade`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/upgrade failed: ${res.status}`)
  }
}

/** Poll pod status until it's ready on `expectedTag`, or give up after ~2 minutes. */
async function pollUntilUpgraded(
  cloudBaseUrl: string,
  getAccessToken: () => Promise<string>,
  expectedTag: string,
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const token = await getAccessToken()
      const res = await fetch(`${cloudBaseUrl}/api/compute/status`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { pod?: { ready?: boolean; computeTag?: string } }
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
export function PodEnsureGate({ children }: { children: React.ReactNode }) {
  // Pod-embedded (token injected) or local run (the pod is the server itself):
  // no need to ensure the pod via the cloud gateway.
  if (isPodEmbedded() || isLocalRun()) return <>{children}</>
  const { session, getAccessToken } = useAuth()
  const [status, setStatus] = useState<PodGateStatus>('pending')
  const [error, setError] = useState<string | null>(null)
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
          ensurePod(CLOUD_BASE_URL, getAccessToken),
          fetchLatestTag(CLOUD_BASE_URL),
        ])
        if (cancelled) return

        const currentTag = ensureResult.pod?.computeTag
        currentTagRef.current = currentTag ?? null
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
  }, [session, getAccessToken])

  // Live poll: once the surface is up, keep an eye out for a newer build so a
  // long-open studio/computer/app tab offers the upgrade (as a banner) without
  // needing a reload. Only runs in the 'ready' state — never while a blocking
  // card/spinner is showing — and never re-nags a dismissed tag.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const id = setInterval(() => {
      void (async () => {
        const latest = await fetchLatestTag(CLOUD_BASE_URL)
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

  const handleRetry = () => {
    initRef.current = false
    setError(null)
    setStatus('pending')
  }

  const handleUpgrade = async (tag: string | null = latestTag) => {
    if (!tag) return
    setBannerTag(null)
    setStatus('upgrading')
    try {
      await upgradePod(CLOUD_BASE_URL, getAccessToken)
      await pollUntilUpgraded(CLOUD_BASE_URL, getAccessToken, tag)
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
    return <div style={centerStyles}>Signing in…</div>
  }

  if (status === 'error') {
    return (
      <div style={centerStyles}>
        <p style={{ color: 'var(--destructive)' }}>Failed to start compute pod: {error}</p>
        <button onClick={handleRetry}>Retry</button>
      </div>
    )
  }

  if (status === 'pending') {
    return <div style={centerStyles}>Starting compute pod…</div>
  }

  if (status === 'upgrading') {
    return <div style={centerStyles}>Upgrading your compute pod…</div>
  }

  if (status === 'upgrade-available') {
    return (
      <div style={centerStyles}>
        <div style={upgradeCardStyles.card}>
          <p style={upgradeCardStyles.heading}>New version available</p>
          <p style={upgradeCardStyles.sub}>
            Your compute pod is running an older version. Upgrade now to get the
            latest features and fixes — this briefly restarts your pod.
          </p>
          <div style={upgradeCardStyles.actions}>
            <button onClick={() => { void handleUpgrade() }} style={upgradeCardStyles.btnPrimary}>
              Upgrade
            </button>
            <button onClick={handleContinueWithoutUpgrading} style={upgradeCardStyles.btn}>
              Continue without upgrading
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {children}
      {bannerTag && (
        <div style={upgradeBannerStyles.bar} role="status">
          <span style={upgradeBannerStyles.text}>
            A new version of your compute pod is available.
          </span>
          <div style={upgradeBannerStyles.actions}>
            <button
              onClick={() => { void handleUpgrade(bannerTag) }}
              style={upgradeBannerStyles.btnPrimary}
            >
              Upgrade
            </button>
            <button onClick={handleDismissBanner} style={upgradeBannerStyles.btn}>
              Dismiss
            </button>
          </div>
        </div>
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
  card: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '32px 40px',
    maxWidth: 420,
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--color-foreground)',
    margin: 0,
  },
  sub: {
    fontSize: 14,
    color: 'var(--color-muted-foreground)',
    margin: 0,
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  btn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-foreground)',
    cursor: 'pointer',
  },
  btnPrimary: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-primary)',
    color: 'var(--color-primary-foreground)',
    cursor: 'pointer',
    fontWeight: 600,
  },
} satisfies Record<string, React.CSSProperties>
