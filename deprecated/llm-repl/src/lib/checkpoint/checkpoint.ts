import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import { TraceWriter } from '../sandbox/trace.js';
import { SessionAssembly } from '../../session/assembly.js';
import { injectGlobal } from '../sandbox/host-bridge.js';

export interface CheckpointOptions {
  label: string;
}

export interface RollbackOptions {
  target: string | number;
}

export interface RollbackResult {
  rewound: number;
  ref: string;
}

export interface SettleResult {
  pendingCount: number;
  elapsedMs: number;
  timeouts: Array<{ name: string }>;
}

export class RollbackBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackBlockedError';
  }
}

export class CheckpointEngine {
  private readonly _assembly: SessionAssembly;
  private readonly _trace: TraceWriter;
  private readonly _onSettle: () => Promise<SettleResult>;

  constructor(opts: {
    assembly: SessionAssembly;
    trace: TraceWriter;
    onSettle: () => Promise<SettleResult>;
  }) {
    this._assembly = opts.assembly;
    this._trace = opts.trace;
    this._onSettle = opts.onSettle;
  }

  async checkpoint(label: string): Promise<void> {
    const before = Date.now();
    const settle = await this._onSettle();
    const elapsedMs = Date.now() - before;

    this._trace.write({
      type: 'checkpoint_settle_wait',
      label,
      pendingCount: settle.pendingCount,
      elapsedMs,
    });

    await this._assembly.checkpoint(label);

    this._trace.write({ type: 'checkpoint', label });
  }

  async rollback(target: string | number): Promise<RollbackResult> {
    let rewound = 0;
    let ref: string;

    if (typeof target === 'string') {
      await this._assembly.rollbackByLabel(target);
      ref = `cp-${target}`;
      rewound = 0;
    } else {
      const n = target;

      if (n === 0) {
        ref = 'HEAD';
        rewound = 0;
      } else {
        const events = this._readTraceEvents();
        const executeEvents = events.filter((e) => e.type === 'execute');

        if (n > executeEvents.length) {
          throw new RollbackBlockedError(
            `Cannot rollback ${n} execute events — only ${executeEvents.length} available`,
          );
        }

        const targetEvent = executeEvents[executeEvents.length - n];
        const sha = targetEvent['sha'] as string | undefined;

        if (!sha) {
          throw new RollbackBlockedError(
            `Execute event at position ${executeEvents.length - n} has no sha — past last valid heap.bin snapshot`,
          );
        }

        await this._assembly.rollbackBySha(sha);
        ref = sha;
        rewound = n;
      }
    }

    this._trace.write({ type: 'rollback', target, rewound, ref });

    return { rewound, ref };
  }

  registerGlobals(ctx: QuickJSAsyncContext): void {
    injectGlobal(ctx, 'checkpoint', (label: unknown) => {
      return this.checkpoint(label as string);
    });

    injectGlobal(ctx, 'rollback', (target: unknown) => {
      return this.rollback(target as string | number).then((r) => r.rewound);
    });
  }

  private _readTraceEvents(): Array<Record<string, unknown>> {
    const events = this._trace.readSuffix(0);
    return events as Array<Record<string, unknown>>;
  }
}
