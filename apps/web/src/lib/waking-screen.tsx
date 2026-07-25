import * as Prim from '@lmthing/ui/elements/primitives';
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
  'Untangling the neural spaghetti…',
  'Convincing the GPU to cooperate…',
  'Reticulating splines…',
  'Feeding the hamsters…',
  'Aligning the flux capacitor…',
  'Polishing the pixels…',
  'Almost there…',
]

const UPGRADING_LINES = [
  'Rolling out the new build…',
  'Swapping in fresh code…',
  'Restarting your pod…',
  'Reconnecting your spaces…',
  'Migrating your sessions…',
  'Dusting off the new features…',
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

export function WakingScreen({
  mode = 'waking',
  progress,
}: {
  mode?: WakingMode
  /**
   * Real cold-boot progress 0..1, milestone-based (see gateway getUserPodStatus).
   * When provided the bar is determinate (fills to the milestone); when omitted
   * it falls back to the indeterminate sliding loop.
   */
  progress?: number
}) {
  const lines = LINES[mode]
  const [i, setI] = useState(0)

  const determinate = typeof progress === 'number' && Number.isFinite(progress)
  const pct = determinate ? Math.max(0, Math.min(100, Math.round(progress! * 100))) : null

  useEffect(() => {
    if (lines.length <= 1) return
    const id = setInterval(() => setI((n) => (n + 1) % lines.length), 2400)
    return () => clearInterval(id)
  }, [lines.length])

  return (
    <Prim.Box {...styles.root}>
      <style>{KEYFRAMES}</style>
      <Prim.Box className="lm-wake-orbit" style={styles.orbit} aria-hidden>
        <Prim.Box className="lm-wake-core" style={styles.core} />
        <Prim.Text style={{ ...styles.orb, ...styles.orbA }} />
        <Prim.Text style={{ ...styles.orb, ...styles.orbB }} />
        <Prim.Text style={{ ...styles.orb, ...styles.orbC }} />
      </Prim.Box>
      <Prim.Box {...styles.text}>
        <Prim.Text as="p" {...styles.heading}>{HEADINGS[mode]}</Prim.Text>
        {/* key on the index so each new line re-triggers the fade-in */}
        <Prim.Text as="p" key={i} style={styles.sub} role="status" aria-live="polite">
          {lines[i]}
        </Prim.Text>
      </Prim.Box>
      {/* Progress bar. Determinate when the gate feeds real milestone progress
          (fills to the current boot stage); otherwise an honest indeterminate
          loop — never a fake timed fill. */}
      <Prim.Box
        {...styles.track}
        role="progressbar"
        aria-label="Loading"
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? pct! : undefined}
        aria-valuetext={determinate ? `${pct}%` : lines[i]}
      >
        <Prim.Box
          className={determinate ? undefined : 'lm-wake-bar'}
          style={
            determinate ? { ...styles.bar, ...styles.barFill, width: `${pct}%` } : styles.bar
          }
        />
      </Prim.Box>
    </Prim.Box>
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
@keyframes lm-wake-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
@media (prefers-reduced-motion: reduce) {
  .lm-wake-orbit { animation: none !important; }
  .lm-wake-core { animation: none !important; }
  .lm-wake-bar { animation: none !important; left: 0 !important; width: 100% !important; opacity: 0.5; }
}
`

const ORB_SIZE = 14
const RING = 64

const styles = {
  root: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 32, backgroundColor: "var(--background)" } as const,
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
  text: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" } as const,
  heading: { margin: 0, fontSize: 17, fontWeight: 600, color: "var(--foreground)" } as const,
  sub: {
    margin: 0,
    fontSize: 14,
    color: 'var(--muted-foreground)',
    animation: 'lm-wake-fade 0.5s ease',
  },
  track: { position: "relative", width: 200, height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: "var(--muted)" } as const,
  bar: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    width: '25%',
    borderRadius: 999,
    background: 'var(--primary)',
    animation: 'lm-wake-slide 1.6s ease-in-out infinite',
  },
  // Determinate override: pinned to the left, no slide, eases toward the
  // milestone width so stepped progress feels smooth instead of snapping.
  barFill: {
    animation: 'none',
    transition: 'width 0.6s ease',
  },
} satisfies Record<string, React.CSSProperties>
