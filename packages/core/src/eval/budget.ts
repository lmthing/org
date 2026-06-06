/**
 * Budget guardrails for autonomous runs.
 *
 * A `Budget` is a host-side counter that caps how much work a turn loop (or a
 * fork's turn loop) may do before it is forcibly stopped. It is set by the
 * CALLER (session / fork engine) — never by the worker code running inside the
 * VM — so a model cannot lift its own ceiling. Exceeding any limit throws a
 * structured `BudgetExceededError`, which the caller turns into a clean stop and
 * VM disposal.
 *
 * The limits are deliberately coarse and few: episodes (LLM turns), tool calls
 * (yields), fork depth, and wall-clock. They are insurance against runaway cost
 * in unattended sessions, not a fine-grained scheduler.
 */

export interface BudgetLimits {
  /** Max number of LLM turns (episodes) in a single turn-loop invocation. */
  maxEpisodes?: number;
  /** Max number of value-yielding calls (ask/fork/delegate/…) resolved. */
  maxToolCalls?: number;
  /** Max fork nesting depth. A top-level session fork is depth 1. */
  maxForkDepth?: number;
  /** Max wall-clock time for the run, in milliseconds. */
  maxWallClockMs?: number;
}

export type BudgetKind = 'episodes' | 'toolCalls' | 'forkDepth' | 'wallClock';

export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: BudgetKind,
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`Budget exceeded: ${kind} limit of ${limit} (used ${used})`);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetSnapshot {
  episodes: number;
  toolCalls: number;
  elapsedMs: number;
}

export class Budget {
  private _episodes = 0;
  private _toolCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  get episodes(): number {
    return this._episodes;
  }

  get toolCalls(): number {
    return this._toolCalls;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /** Count one LLM turn. Throws if over the episode (or wall-clock) limit. */
  tickEpisode(): void {
    this._episodes++;
    this.assertWallClock();
    if (this.limits.maxEpisodes !== undefined && this._episodes > this.limits.maxEpisodes) {
      throw new BudgetExceededError('episodes', this.limits.maxEpisodes, this._episodes);
    }
  }

  /** Count resolved tool calls (yields). Throws if over the tool-call (or wall-clock) limit. */
  tickToolCalls(n = 1): void {
    this._toolCalls += n;
    this.assertWallClock();
    if (this.limits.maxToolCalls !== undefined && this._toolCalls > this.limits.maxToolCalls) {
      throw new BudgetExceededError('toolCalls', this.limits.maxToolCalls, this._toolCalls);
    }
  }

  /** Assert a fork at the given depth is within the depth limit. */
  assertForkDepth(depth: number): void {
    if (this.limits.maxForkDepth !== undefined && depth > this.limits.maxForkDepth) {
      throw new BudgetExceededError('forkDepth', this.limits.maxForkDepth, depth);
    }
  }

  /** Assert the run has not exceeded its wall-clock limit. */
  assertWallClock(): void {
    if (this.limits.maxWallClockMs !== undefined && this.elapsedMs() > this.limits.maxWallClockMs) {
      throw new BudgetExceededError('wallClock', this.limits.maxWallClockMs, this.elapsedMs());
    }
  }

  /** Read-only progress snapshot, surfaced to the VM via the `progress` global. */
  snapshot(): BudgetSnapshot {
    return { episodes: this._episodes, toolCalls: this._toolCalls, elapsedMs: this.elapsedMs() };
  }
}
