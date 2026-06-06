/**
 * Verifier-gated escalation ladder.
 *
 * `solve` runs a task and, *only while a `verify` check keeps failing*, climbs a
 * fixed ladder of increasingly expensive strategies:
 *
 *     single attempt → retry-with-feedback → race-N → STOP (budget)
 *
 * The "complexity factor" is observed, not declared: it is how far up the ladder
 * we had to climb, and we only climb when `verify` rejects the previous rung. Two
 * consequences make "spend only when needed" true *by construction*:
 *
 *   - No `verify` provided ⇒ the ladder is unreachable ⇒ exactly one attempt.
 *   - `verify` passes on the first try ⇒ rung 0, no extra forks, no extra cost.
 *
 * This module is the pure engine: it takes a `fork`-like function by dependency
 * injection so the ladder logic is fully unit-testable without a VM or a model.
 * The escalation hard-stops at race-N; it never reaches for shared state or
 * evolutionary search (which would break the fork context firewall).
 */

export type VerifyResult = { ok: boolean; feedback?: string };

/** A rung of the escalation ladder. `retry` = one sequential re-run carrying
 *  feedback; `race${n}` = spawn n attempts in parallel, take the first that
 *  passes verify. */
export type SolveRung = 'retry' | `race${number}`;

/** The task handed to each attempt. Mirrors the shape of `ForkOpts`/`ForkTask`
 *  so a caller can pass the same object they would give `fork()`. `instruction`
 *  is the only field the engine itself reads (to inject feedback). */
export interface SolveTask {
  instruction: string;
  [key: string]: unknown;
}

export interface SolveOpts<T> {
  task: SolveTask;
  /** Acceptance check. Absent ⇒ no escalation (single attempt). */
  verify?: (out: T) => VerifyResult | Promise<VerifyResult>;
  /** Ladder rungs, climbed in order. Default: ['retry', 'race3']. */
  ladder?: SolveRung[];
  /** Hard cap on total attempts (forks). Default: 6. The budget guardrail is the
   *  real ceiling; this just bounds the ladder locally. */
  maxAttempts?: number;
}

export interface SolveResult<T> {
  /** The accepted output, or the last attempt's output if none passed verify. */
  value: T;
  /** 0 if solved on the first try (or no verify); otherwise the 1-based index of
   *  the ladder rung that produced the result (or the last rung attempted). */
  rung: number;
  /** Total attempts (forks) spawned. */
  attempts: number;
  /** Whether the returned value passed verify. False when no verify was given. */
  verified: boolean;
}

const DEFAULT_LADDER: SolveRung[] = ['retry', 'race3'];
const DEFAULT_MAX_ATTEMPTS = 6;

/** Parse the parallelism of a `race${n}` rung; non-race rungs return 0. */
function raceWidth(rung: SolveRung): number {
  const m = /^race(\d+)$/.exec(rung);
  return m ? Math.max(1, parseInt(m[1]!, 10)) : 0;
}

/** Append verifier feedback to a task instruction so the next attempt sees why
 *  the previous one was rejected (the paper's "lessons learned" carried forward). */
function withFeedback(task: SolveTask, feedback: string | undefined): SolveTask {
  if (!feedback) return task;
  return {
    ...task,
    instruction:
      `${task.instruction}\n\n` +
      `# Feedback from the previous attempt (it did NOT pass verification)\n${feedback}\n` +
      `Address this specifically.`,
  };
}

/**
 * Run the escalation ladder.
 *
 * @param forkFn  spawns one attempt and resolves its output (e.g. `(t) => forkEngine.fork(t)`).
 * @param opts    the task, optional verify, ladder, and attempt cap.
 */
export async function solve<T>(
  forkFn: (task: SolveTask) => Promise<T>,
  opts: SolveOpts<T>,
): Promise<SolveResult<T>> {
  const ladder = opts.ladder ?? DEFAULT_LADDER;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const verify = opts.verify;

  // Rung 0: a single attempt.
  let attempts = 1;
  let value = await forkFn(opts.task);

  // No verifier ⇒ the ladder is unreachable. Spend nothing more.
  if (!verify) {
    return { value, rung: 0, attempts, verified: false };
  }

  let check = await verify(value);
  if (check.ok) {
    return { value, rung: 0, attempts, verified: true };
  }

  // Climb the ladder while verify keeps failing and budget remains.
  let lastRung = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (attempts >= maxAttempts) break;
    const rung = ladder[i]!;
    lastRung = i + 1;

    if (rung === 'retry') {
      value = await forkFn(withFeedback(opts.task, check.feedback));
      attempts++;
      check = await verify(value);
      if (check.ok) {
        return { value, rung: lastRung, attempts, verified: true };
      }
      continue;
    }

    const width = raceWidth(rung);
    if (width > 0) {
      const room = maxAttempts - attempts;
      const n = Math.min(width, room);
      if (n <= 0) break;
      const task = withFeedback(opts.task, check.feedback);
      const candidates = await Promise.all(
        Array.from({ length: n }, () => forkFn(task)),
      );
      attempts += n;
      // Take the first candidate that passes verify.
      let lastChecked = check;
      let winner: { value: T } | undefined;
      for (const c of candidates) {
        const r = await verify(c);
        lastChecked = r;
        if (r.ok) {
          winner = { value: c };
          break;
        }
      }
      if (winner) {
        return { value: winner.value, rung: lastRung, attempts, verified: true };
      }
      // None passed — keep the last candidate as the working value and its feedback.
      value = candidates[candidates.length - 1]!;
      check = lastChecked;
      continue;
    }
    // Unknown rung label — skip it without spending an attempt.
    lastRung = i; // do not count an unrecognized rung as reached
  }

  // Ladder exhausted (or budget hit) without passing verify.
  return { value, rung: lastRung, attempts, verified: false };
}

/**
 * Options the `solve` global accepts from VM code. Unlike `SolveOpts`, the
 * `verify` is expressed as serializable specs (a shell command or a
 * condition-DSL string) because a JS closure cannot cross the QuickJS boundary
 * to the host that orchestrates the forks.
 */
export interface SolveYieldOpts {
  instruction: string;
  output?: Record<string, string>;
  seed?: Record<string, unknown>;
  role?: 'explore' | 'plan' | 'general';
  /** Shell command run by the host after each attempt (cwd = space dir). Exit 0
   *  ⇒ pass; non-zero ⇒ fail, with stdout/stderr fed back as feedback. The real
   *  oracle for the coding/verifier zone (run tests / a type-check). */
  verifyCommand?: string;
  /** Condition-DSL string evaluated over the attempt's output object. Cheap
   *  structural post-condition (no string methods — see condition-dsl). */
  verifyCondition?: string;
  ladder?: SolveRung[];
  maxAttempts?: number;
}

export interface SolveYieldDeps {
  /** Spawn one attempt (e.g. `(t) => forkEngine.fork(t)`). */
  fork: (task: SolveTask) => Promise<unknown>;
  /** Run a shell command host-side; ok = exit 0, output = combined stdout/stderr. */
  execCommand?: (cmd: string) => { ok: boolean; output: string };
  /** Evaluate a condition-DSL string over an output object. */
  evaluateCondition?: (expr: string, output: Record<string, unknown>) => boolean;
}

/**
 * Host-side resolver for a `solve` yield. Builds a host-executable `verify` from
 * the serializable spec, then runs the escalation engine over the fork engine.
 * When neither verify spec is given, the ladder is unreachable (single attempt).
 */
export async function runSolveYield(
  opts: SolveYieldOpts,
  deps: SolveYieldDeps,
): Promise<SolveResult<unknown>> {
  const task: SolveTask = {
    instruction: opts.instruction,
    output: opts.output ?? {},
    ...(opts.seed ? { seed: opts.seed } : {}),
    ...(opts.role ? { role: opts.role } : {}),
  };

  let verify: ((out: unknown) => VerifyResult) | undefined;
  if (opts.verifyCommand) {
    const cmd = opts.verifyCommand;
    verify = () => {
      if (!deps.execCommand) {
        return { ok: false, feedback: 'verifyCommand is not available in this scope' };
      }
      const r = deps.execCommand(cmd);
      return r.ok ? { ok: true } : { ok: false, feedback: r.output };
    };
  } else if (opts.verifyCondition) {
    const expr = opts.verifyCondition;
    const evalCond = deps.evaluateCondition;
    verify = (out: unknown) => {
      if (!evalCond) return { ok: false, feedback: 'verifyCondition evaluator unavailable' };
      const record = out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
      const ok = evalCond(expr, record);
      return ok ? { ok: true } : { ok: false, feedback: `condition not met: ${expr}` };
    };
  }

  return solve<unknown>(deps.fork, {
    task,
    verify,
    ...(opts.ladder ? { ladder: opts.ladder } : {}),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
  });
}
