import { useEffect, useState } from 'react'

/**
 * A friendly, animated "waking up" screen shown while the user's compute pod
 * cold-starts (scale-to-zero). Replaces the old dry "Waking your workspace…"
 * text so a ~6s wake feels alive instead of broken. Three orbiting orbs + a
 * soft pulsing core, plus a rotating set of playful status lines that keep the
 * user engaged. Colors are design tokens only (agent/primary/accent).
 *
 * The pod-served installed-app path (lmthing.app page navigations) renders a
 * self-contained HTML twin of this in Envoy Lua — keep the two in visual sync
 * (devops/argocd/envoy/app-policies.yaml).
 */

// Playful, on-brand lines. Cycled while the pod boots — purely cosmetic, the
// gate's real readiness poll is what actually advances the screen.
const WAKING_LINES = [
  'Booting your compute pod…',
  'Warming up the sandbox…',
  'Summoning THING…',
  'Loading your spaces…',
  'Spinning up QuickJS…',
  'Teaching electrons to think…',
  'Brewing fresh tokens…',
  'Almost there…',
]

const UPGRADING_LINES = [
  'Rolling out the new build…',
  'Swapping in fresh code…',
  'Restarting your pod…',
  'Reconnecting your spaces…',
  'Almost back…',
]

export type WakingMode = 'waking' | 'upgrading' | 'signing-in'

const HEADINGS: Record<WakingMode, string> = {
  waking: 'Waking your workspace',
  upgrading: 'Upgrading your workspace',
  'signing-in': 'Signing you in',
}

const LINES: Record<WakingMode, string[]> = {
  waking: WAKING_LINES,
  upgrading: UPGRADING_LINES,
  'signing-in': ['One moment…'],
}

export function WakingScreen({ mode = 'waking' }: { mode?: WakingMode }) {
  const lines = LINES[mode]
  const [i, setI] = useState(0)

  useEffect(() => {
    if (lines.length <= 1) return
    const id = setInterval(() => setI((n) => (n + 1) % lines.length), 2400)
    return () => clearInterval(id)
  }, [lines.length])

  return (
    <div style={styles.root}>
      <style>{KEYFRAMES}</style>
      <div className="lm-wake-orbit" style={styles.orbit} aria-hidden>
        <div className="lm-wake-core" style={styles.core} />
        <span style={{ ...styles.orb, ...styles.orbA }} />
        <span style={{ ...styles.orb, ...styles.orbB }} />
        <span style={{ ...styles.orb, ...styles.orbC }} />
      </div>
      <div style={styles.text}>
        <p style={styles.heading}>{HEADINGS[mode]}</p>
        {/* key on the index so each new line re-triggers the fade-in */}
        <p key={i} style={styles.sub} role="status" aria-live="polite">
          {lines[i]}
        </p>
      </div>
    </div>
  )
}

const KEYFRAMES = `
@keyframes lm-wake-spin { to { transform: rotate(360deg); } }
@keyframes lm-wake-pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.28); opacity: 0.45; }
}
@keyframes lm-wake-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .lm-wake-orbit { animation: none !important; }
  .lm-wake-core { animation: none !important; }
}
`

const ORB_SIZE = 14
const RING = 64

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 32,
    background: 'var(--background)',
  },
  orbit: {
    position: 'relative' as const,
    width: RING * 2,
    height: RING * 2,
    animation: 'lm-wake-spin 2.4s linear infinite',
  },
  core: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    width: 22,
    height: 22,
    marginTop: -11,
    marginLeft: -11,
    borderRadius: '50%',
    background: 'var(--primary)',
    boxShadow: '0 0 24px 4px var(--primary)',
    animation: 'lm-wake-pulse 1.8s ease-in-out infinite',
  },
  orb: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    width: ORB_SIZE,
    height: ORB_SIZE,
    marginTop: -ORB_SIZE / 2,
    marginLeft: -ORB_SIZE / 2,
    borderRadius: '50%',
  },
  orbA: {
    background: 'var(--agent)',
    transform: `rotate(0deg) translateX(${RING}px)`,
  },
  orbB: {
    background: 'var(--accent)',
    transform: `rotate(120deg) translateX(${RING}px)`,
  },
  orbC: {
    background: 'var(--knowledge)',
    transform: `rotate(240deg) translateX(${RING}px)`,
  },
  text: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
    textAlign: 'center' as const,
  },
  heading: {
    margin: 0,
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--foreground)',
  },
  sub: {
    margin: 0,
    fontSize: 14,
    color: 'var(--muted-foreground)',
    animation: 'lm-wake-fade 0.5s ease',
  },
} satisfies Record<string, React.CSSProperties>
