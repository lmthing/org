/**
 * Fork engine — manages parallel completions on git branches.
 * Implements spec §"Forks" (spec L1554–1572).
 */
import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import type { TraceWriter } from '../sandbox/trace.js';
import type { SessionAssembly } from '../../session/assembly.js';
import { BudgetTracker } from '../inspect/budget.js';
import { injectGlobal } from '../sandbox/host-bridge.js';

export { BudgetTracker } from '../inspect/budget.js';

// ── Public types ──

export interface ForkOptions {
  instruction: string;
  exclude?: string[];
  tokenBudget?: number;
  warnAt?: number;
}

export interface ForkResult<T = unknown> {
  status: 'resolved' | 'rejected';
  value?: T;
  error?: string;
  tokensUsed: number;
  forkId: string;
}

export interface ForkHandle<T = unknown> extends Promise<ForkResult<T>> {
  forkId: string;
  inject(answer: string): void;
}

export type ForkState =
  | { status: 'pending' }
  | { status: 'resolved'; value: unknown; tokensUsed: number }
  | { status: 'rejected'; error: string; tokensUsed: number }
  | { status: 'asking'; question: unknown };

// ── Internal state ──

interface ForkEntry {
  forkId: string;
  state: ForkState;
  tokenCap: number;
  tokensUsed: number;
  warnAt: number;
  warnedAt: boolean;
  resolve: (result: ForkResult<unknown>) => void;
  reject: (err: Error) => void;
  pendingAsk: { question: unknown; resolve: (answer: string) => void; timeout: ReturnType<typeof setTimeout> } | null;
}

// ── BudgetExceededError ──

export class BudgetExceededError extends Error {
  constructor(forkId: string, cap: number) {
    super(`Fork ${forkId} exceeded token budget of ${cap}`);
    this.name = 'BudgetExceededError';
  }
}

// ── Counter for unique IDs ──

let _forkCounter = 0;

function newForkId(): string {
  _forkCounter += 1;
  return `fork-${Date.now()}-${_forkCounter}`;
}

// ── ForkEngine ──

export class ForkEngine {
  private readonly _assembly: SessionAssembly;
  private readonly _budgetTracker: BudgetTracker;
  private readonly _trace: TraceWriter;
  private readonly _seedChildScope: (exclude: string[]) => Record<string, unknown>;
  private readonly _onBudgetWarning: (forkId: string, tokensRemaining: number) => void;

  private readonly _forks = new Map<string, ForkEntry>();

  constructor(opts: {
    assembly: SessionAssembly;
    budgetTracker: BudgetTracker;
    trace: TraceWriter;
    seedChildScope: (exclude: string[]) => Record<string, unknown>;
    onBudgetWarning: (forkId: string, tokensRemaining: number) => void;
  }) {
    this._assembly = opts.assembly;
    this._budgetTracker = opts.budgetTracker;
    this._trace = opts.trace;
    this._seedChildScope = opts.seedChildScope;
    this._onBudgetWarning = opts.onBudgetWarning;
  }

  fork<T = unknown>(opts: ForkOptions): ForkHandle<T> {
    const forkId = newForkId();

    // Cap token budget at min(tokenBudget, parent.tokensRemaining)
    const parentRemaining = this._budgetTracker.tokensRemaining;
    const requestedBudget = opts.tokenBudget ?? parentRemaining;
    const tokenCap = Math.min(requestedBudget, parentRemaining);

    // Compute warnAt threshold
    const defaultWarnAt = Math.max(Math.floor(tokenCap * 0.2), 500);
    const warnAt = opts.warnAt ?? defaultWarnAt;

    // Seed child scope
    this._seedChildScope(opts.exclude ?? []);

    let resolveHandle!: (result: ForkResult<unknown>) => void;
    let rejectHandle!: (err: Error) => void;

    const promise = new Promise<ForkResult<T>>((res, rej) => {
      resolveHandle = res as (r: ForkResult<unknown>) => void;
      rejectHandle = rej;
    });

    const entry: ForkEntry = {
      forkId,
      state: { status: 'pending' },
      tokenCap,
      tokensUsed: 0,
      warnAt,
      warnedAt: false,
      resolve: resolveHandle,
      reject: rejectHandle,
      pendingAsk: null,
    };

    this._forks.set(forkId, entry);

    this._trace.write({
      type: 'fork_spawn',
      forkId,
      instruction: opts.instruction,
      tokenCap,
      warnAt,
      branch: `fork/${forkId}`,
    });

    // Update parent budget tracker fork counts
    this._syncForkCounts();

    // Attach forkId + inject to the promise
    const handle = promise as ForkHandle<T>;
    Object.defineProperty(handle, 'forkId', { value: forkId, enumerable: true, writable: false });
    Object.defineProperty(handle, 'inject', {
      value: (answer: string) => this.injectForkAnswer(forkId, answer),
      enumerable: true,
      writable: false,
    });

    return handle;
  }

  resolve<T>(forkId: string, value: T): never {
    const entry = this._forks.get(forkId);
    if (!entry) {
      throw new Error(`fork ${forkId} not found`);
    }
    if (entry.state.status !== 'pending' && entry.state.status !== 'asking') {
      throw new Error(`fork ${forkId} is already ${entry.state.status}`);
    }

    entry.state = { status: 'resolved', value, tokensUsed: entry.tokensUsed };

    const result: ForkResult<T> = {
      status: 'resolved',
      value,
      tokensUsed: entry.tokensUsed,
      forkId,
    };

    this._trace.write({ type: 'fork_resolve', forkId, tokensUsed: entry.tokensUsed });
    entry.resolve(result as ForkResult<unknown>);

    this._syncForkCounts();

    throw new Error(`__fork_resolved:${forkId}`);
  }

  getForkStates(): Map<string, ForkState> {
    const result = new Map<string, ForkState>();
    for (const [id, entry] of this._forks) {
      result.set(id, entry.state);
    }
    return result;
  }

  getPendingAsks(): Array<{ forkId: string; question: unknown }> {
    const asks: Array<{ forkId: string; question: unknown }> = [];
    for (const [forkId, entry] of this._forks) {
      if (entry.state.status === 'asking' && entry.pendingAsk) {
        asks.push({ forkId, question: entry.pendingAsk.question });
      }
    }
    return asks;
  }

  registerGlobals(ctx: QuickJSAsyncContext, isFork = false): void {
    if (!isFork) {
      // Main session: register fork() but not resolve()
      injectGlobal(ctx, 'fork', (optsArg: unknown) => {
        const o = optsArg as ForkOptions;
        return this.fork(o);
      });
    } else {
      // Fork context: register resolve() but not fork()
      injectGlobal(ctx, 'resolve', (forkIdArg: unknown, valueArg: unknown) => {
        return this.resolve(forkIdArg as string, valueArg);
      });
    }
  }

  recordForkTokens(forkId: string, tokens: number): void {
    const entry = this._forks.get(forkId);
    if (!entry) return;
    if (entry.state.status !== 'pending' && entry.state.status !== 'asking') return;

    entry.tokensUsed += tokens;

    // Debit parent BudgetTracker
    this._budgetTracker.recordTokens(tokens);

    const tokensRemaining = entry.tokenCap - entry.tokensUsed;

    // Check if budget cap exceeded
    if (tokensRemaining <= 0) {
      entry.state = { status: 'rejected', error: 'BudgetExceeded', tokensUsed: entry.tokensUsed };
      const result: ForkResult<unknown> = {
        status: 'rejected',
        error: 'BudgetExceeded',
        tokensUsed: entry.tokensUsed,
        forkId,
      };
      this._trace.write({ type: 'fork_reject', forkId, reason: 'BudgetExceeded', tokensUsed: entry.tokensUsed });
      entry.resolve(result);
      this._syncForkCounts();
      return;
    }

    // Check if budget warning threshold crossed
    if (!entry.warnedAt && tokensRemaining <= entry.warnAt) {
      entry.warnedAt = true;
      this._trace.write({ type: 'fork_budget_warning', forkId, tokensRemaining });
      this._onBudgetWarning(forkId, tokensRemaining);
    }
  }

  injectForkAnswer(forkId: string, answer: string): void {
    if (typeof answer !== 'string') {
      throw Object.assign(new Error('inject() answer must be a string'), { kind: 'contract' });
    }

    const entry = this._forks.get(forkId);
    if (!entry) return; // silently ignore unknown fork
    if (!entry.pendingAsk) return; // silently ignore if no pending ask

    clearTimeout(entry.pendingAsk.timeout);
    const askResolve = entry.pendingAsk.resolve;
    entry.pendingAsk = null;

    // Transition back to pending
    if (entry.state.status === 'asking') {
      entry.state = { status: 'pending' };
    }

    this._trace.write({ type: 'fork_ask_inject', forkId, answer });
    askResolve(answer);
  }

  /**
   * Register a pending ask from inside a fork.
   * Returns a Promise<string> that resolves when parent injects an answer or 5-min timeout.
   */
  registerForkAsk(forkId: string, question: unknown): Promise<string> {
    const entry = this._forks.get(forkId);
    if (!entry) return Promise.reject(new Error(`fork ${forkId} not found`));

    this._trace.write({ type: 'fork_ask', forkId, question });

    return new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        if (entry.pendingAsk?.resolve === resolve) {
          entry.pendingAsk = null;
          if (entry.state.status === 'asking') {
            entry.state = { status: 'pending' };
          }
          this._trace.write({ type: 'fork_ask_timeout', forkId });
          resolve(''); // resolve with empty string on timeout
        }
      }, 5 * 60 * 1000);

      entry.pendingAsk = { question, resolve, timeout };
      entry.state = { status: 'asking', question };
    });
  }

  // ── Private helpers ──

  private _syncForkCounts(): void {
    let active = 0;
    let completed = 0;
    for (const entry of this._forks.values()) {
      if (entry.state.status === 'pending' || entry.state.status === 'asking') {
        active += 1;
      } else {
        completed += 1;
      }
    }
    this._budgetTracker.setForks(active, completed);
  }
}
