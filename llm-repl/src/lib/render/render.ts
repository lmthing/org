import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import { TraceWriter } from '../sandbox/trace.js';
import { injectGlobal, marshalToHost, marshalToQuickJS } from '../sandbox/host-bridge.js';

export type DisplayMode = 'replace' | 'append';

export interface DisplayOptions {
  id?: string;
  mode?: DisplayMode;
}

export interface AskOptions<T = string> {
  timeout?: number;
  fallback?: T;
}

export interface DisplayEntry {
  id: string | null;
  descriptor: unknown;
  statementIndex: number;
  cycle: number;
}

export interface AskEntry<T = unknown> {
  id: string;
  descriptor: unknown;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  statementIndex: number;
  fallback?: T;
  hasFallback: boolean;
}

export interface RenderConfig {
  maxEntries: number;
  maxTokens: number;
}

export class TimeoutError extends Error {
  constructor(message = 'ask() timed out — no fallback provided') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class SessionEndedError extends Error {
  constructor(message = 'Session ended before ask() was answered') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

let _askCounter = 0;

function nextAskId(): string {
  return `ask_${++_askCounter}_${Date.now()}`;
}

export class RenderEngine {
  private readonly _trace: TraceWriter;
  private readonly _config: RenderConfig;
  private readonly _onAskSubmit?: (id: string, value: unknown) => void;
  private readonly _onDisplay?: (id: string | null, descriptor: unknown) => void;
  private readonly _onAskStart?: (id: string, descriptor: unknown) => void;
  private readonly _onAskEnd?: (id: string) => void;
  private _displayEntries: DisplayEntry[] = [];
  private _pendingAsks: Map<string, AskEntry> = new Map();
  private _cycle = 0;

  statementIndex = 0;

  constructor(opts: {
    trace: TraceWriter;
    config: RenderConfig;
    onAskSubmit?: (id: string, value: unknown) => void;
    onDisplay?: (id: string | null, descriptor: unknown) => void;
    onAskStart?: (id: string, descriptor: unknown) => void;
    onAskEnd?: (id: string) => void;
  }) {
    this._trace = opts.trace;
    this._config = opts.config;
    this._onAskSubmit = opts.onAskSubmit;
    this._onDisplay = opts.onDisplay;
    this._onAskStart = opts.onAskStart;
    this._onAskEnd = opts.onAskEnd;
  }

  registerGlobals(ctx: QuickJSAsyncContext): void {
    const self = this;

    injectGlobal(ctx, 'display', (descriptor: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : {}) as DisplayOptions;
      self.display(descriptor, options, self.statementIndex);
    });

    const askFn = ctx.newFunction('ask', (descriptorHandle, optsHandle) => {
      const descriptor = marshalToHost(ctx, descriptorHandle);
      const opts = optsHandle ? (marshalToHost(ctx, optsHandle) as AskOptions) : {};
      const options = (opts && typeof opts === 'object' ? opts : {}) as AskOptions;

      const deferred = ctx.newPromise();

      const promise = self.ask(descriptor, options, self.statementIndex);
      promise
        .then((v) => {
          const handle = marshalToQuickJS(ctx, v);
          deferred.resolve(handle);
          handle.dispose();
          ctx.runtime.executePendingJobs();
        })
        .catch((err: unknown) => {
          const errHandle = ctx.newString(
            err instanceof Error ? err.message : String(err),
          );
          deferred.reject(errHandle);
          errHandle.dispose();
          ctx.runtime.executePendingJobs();
        });

      return deferred.handle;
    });

    ctx.setProp(ctx.global, 'ask', askFn);
    askFn.dispose();
  }

  getDisplayEntries(): DisplayEntry[] {
    return [...this._displayEntries];
  }

  getPendingAsks(): AskEntry[] {
    return Array.from(this._pendingAsks.values());
  }

  invalidateAfter(statementIndex: number): void {
    const before = this._displayEntries.length;
    this._displayEntries = this._displayEntries.filter(
      (e) => e.statementIndex <= statementIndex,
    );
    const removed = before - this._displayEntries.length;
    if (removed > 0) {
      this._trace.write({ type: 'display_invalidate', cutoffIndex: statementIndex, removed });
    }
  }

  display(descriptor: unknown, opts: DisplayOptions, statementIndex: number): void {
    const id = opts.id ?? null;
    const mode = opts.mode ?? (id !== null ? 'replace' : 'append');

    this._cycle++;

    if (id !== null && mode === 'replace') {
      const existingIdx = this._displayEntries.findIndex((e) => e.id === id);
      if (existingIdx !== -1) {
        this._displayEntries[existingIdx] = { id, descriptor, statementIndex, cycle: this._cycle };
        this._trace.write({ type: 'display', id, mode: 'replace', statementIndex });
        this._onDisplay?.(id, descriptor);
        return;
      }
    }

    const entry: DisplayEntry = { id, descriptor, statementIndex, cycle: this._cycle };
    this._displayEntries.push(entry);

    if (this._displayEntries.length > this._config.maxEntries) {
      const nonIdIdx = this._displayEntries.findIndex((e) => e.id === null);
      if (nonIdIdx !== -1) {
        this._displayEntries.splice(nonIdIdx, 1);
      } else {
        this._displayEntries.shift();
      }
    }

    this._trace.write({ type: 'display', id, mode: 'append', statementIndex });
    this._onDisplay?.(id, descriptor);
  }

  ask<T = string>(descriptor: unknown, opts: AskOptions<T>, statementIndex: number): Promise<T> {
    const id = nextAskId();
    const timeoutMs = opts.timeout ?? 300000;
    const hasFallback = 'fallback' in opts;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this._pendingAsks.has(id)) return;
        this._pendingAsks.delete(id);

        if (hasFallback) {
          this._trace.write({ type: 'ask_timeout', id, statementIndex });
          this._onAskEnd?.(id);
          resolve(opts.fallback as T);
        } else {
          this._trace.write({ type: 'ask_timeout', id, statementIndex });
          this._onAskEnd?.(id);
          reject(new TimeoutError());
        }
      }, timeoutMs);

      const entry: AskEntry = {
        id,
        descriptor,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timer,
        statementIndex,
        fallback: opts.fallback as unknown,
        hasFallback,
      };

      this._pendingAsks.set(id, entry);
      this._trace.write({ type: 'ask', id, statementIndex, timeout: timeoutMs });
      this._onAskStart?.(id, descriptor);
    });
  }

  submitAsk(id: string, value: unknown): void {
    const entry = this._pendingAsks.get(id);
    if (!entry) return;

    clearTimeout(entry.timeout);
    this._pendingAsks.delete(id);
    this._trace.write({ type: 'ask_resolve', id, statementIndex: entry.statementIndex });
    this._onAskEnd?.(id);
    entry.resolve(value);
  }

  endSession(): void {
    for (const entry of this._pendingAsks.values()) {
      clearTimeout(entry.timeout);
      this._trace.write({ type: 'ask_cancelled', id: entry.id, statementIndex: entry.statementIndex });
      if (entry.hasFallback) {
        entry.resolve(entry.fallback);
      } else {
        entry.reject(new SessionEndedError());
      }
    }
    this._pendingAsks.clear();
  }
}
