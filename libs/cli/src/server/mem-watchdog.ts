/**
 * In-pod memory watchdog (P3) — turns the only data-losing failure mode
 * (a cgroup OOMKill = SIGKILL, which skips the SIGTERM backup flush) into graceful,
 * recoverable session eviction.
 *
 * Polls cgroup v2 (`memory.current` vs `memory.max`):
 *   - **soft** (≥ softRatio, default 75%): shed the least-recently-active idle
 *     session (persist-first, resumable) — one per tick, gentle.
 *   - **hard** (≥ hardRatio, default 90%): shed AND raise the pressure flag so new
 *     session creation is refused with 503 until memory recovers below soft.
 *
 * Evicts at most one session per tick: eviction's memory is reclaimed
 * asynchronously (dispose runs in the background), so reading `memory.current` in a
 * tight loop would over-evict. The per-VM 64 MB cap + NODE_OPTIONS heap bound keep
 * total usage bounded; this watchdog handles the host-heap + esbuild overshoot.
 *
 * Entirely inert off-container: gated on the cgroup v2 files existing AND
 * `memory.max` being a real numeric limit (a bare host process has neither), so
 * `lmthing serve` on a dev machine never evicts.
 */
import { existsSync, readFileSync } from 'node:fs';

const CUR_PATH = '/sys/fs/cgroup/memory.current';
const MAX_PATH = '/sys/fs/cgroup/memory.max';

export interface MemWatchdogOpts {
  /** Sheds one idle session (persist-first). Returns false when none is evictable. */
  evictOneIdle: () => boolean;
  /** Fraction of the limit that triggers gentle shedding (default 0.75). */
  softRatio?: number;
  /** Fraction that triggers shedding + new-session backpressure (default 0.90). */
  hardRatio?: number;
  /** Poll cadence (default 5s). */
  intervalMs?: number;
}

let underPressure = false;

/** True while the pod is under HARD memory pressure — session creation should 503. */
export function isUnderMemoryPressure(): boolean {
  return underPressure;
}

function readNum(path: string): number {
  try {
    return Number(readFileSync(path, 'utf8').trim());
  } catch {
    return NaN;
  }
}

/**
 * Start the watchdog. Returns the interval handle, or `null` when not running in a
 * memory-limited cgroup v2 container (local dev / no limit) — a harmless no-op there.
 */
export function startMemWatchdog(opts: MemWatchdogOpts): NodeJS.Timeout | null {
  const soft = opts.softRatio ?? 0.75;
  const hard = opts.hardRatio ?? 0.9;
  const intervalMs = opts.intervalMs ?? 5000;

  // Gate: cgroup v2 files present AND memory.max is a finite limit ("max" ⇒ none).
  if (!existsSync(CUR_PATH) || !existsSync(MAX_PATH)) return null;
  const maxProbe = readNum(MAX_PATH);
  if (!Number.isFinite(maxProbe) || maxProbe <= 0) return null;

  const timer = setInterval(() => {
    const cur = readNum(CUR_PATH);
    const max = readNum(MAX_PATH);
    if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) {
      underPressure = false;
      return;
    }
    const ratio = cur / max;
    if (ratio >= hard) {
      underPressure = true;
      const evicted = opts.evictOneIdle();
      console.warn(
        `[mem-watchdog] HARD pressure ${(ratio * 100).toFixed(0)}% — ` +
          (evicted ? 'evicted one idle session' : 'nothing idle to evict') +
          '; refusing new sessions',
      );
    } else if (ratio >= soft) {
      underPressure = false;
      if (opts.evictOneIdle()) {
        console.warn(
          `[mem-watchdog] soft pressure ${(ratio * 100).toFixed(0)}% — evicted one idle session`,
        );
      }
    } else {
      underPressure = false;
    }
  }, intervalMs);
  timer.unref?.();
  console.log('[mem-watchdog] started (cgroup v2 memory pressure eviction)');
  return timer;
}
