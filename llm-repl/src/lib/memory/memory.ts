import { createHash } from 'node:crypto';
import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import type { TraceWriter } from '../sandbox/trace.js';
import type { BudgetTracker } from '../inspect/budget.js';
import { injectGlobal } from '../sandbox/host-bridge.js';

export type CompactStrategy = 'schema' | 'sample' | 'summary' | 'hash';

export interface PinOptions {
  maxTokens?: number;
}

export interface CompactOptions {
  strategy: CompactStrategy;
  maxTokens?: number;
}

export interface PinRecord {
  name: string;
  cycleAdded: number;
  maxTokens?: number;
  gitRef: number;
}

export interface CompactionRecord {
  name: string;
  strategy: CompactStrategy;
  compressed: string;
}

function inferTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const first = value[0];
    if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
      const keys = Object.keys(first as Record<string, unknown>);
      if (keys.length > 0) {
        const sample = first as Record<string, unknown>;
        const name = (sample['__type'] as string) ?? (sample['type'] as string) ?? 'Object';
        return `${name}[]`;
      }
    }
    return `${typeof first}[]`;
  }
  if (typeof value === 'object') {
    return 'Object';
  }
  return typeof value;
}

function inferFieldTypes(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) result[k] = 'null';
    else if (Array.isArray(v)) result[k] = 'array';
    else result[k] = typeof v;
  }
  return result;
}

export function applyCompactStrategy(
  value: unknown,
  strategy: CompactStrategy,
  opts?: { maxTokens?: number },
): string {
  void opts;

  if (strategy === 'schema') {
    if (Array.isArray(value)) {
      const typeName = inferTypeName(value);
      const len = value.length;
      const schemaFields: Record<string, string> = {};
      if (value.length > 0) {
        const first = value[0];
        if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
          Object.assign(schemaFields, inferFieldTypes(first as Record<string, unknown>));
        }
      }
      return JSON.stringify({ _type: typeName, _len: len, _schema: schemaFields });
    }
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>);
      const schemaFields = inferFieldTypes(value as Record<string, unknown>);
      return JSON.stringify({ _type: 'Object', _keys: keys.length, _schema: schemaFields });
    }
    return JSON.stringify({ _type: typeof value, _value: String(value) });
  }

  if (strategy === 'sample') {
    if (Array.isArray(value)) {
      const len = value.length;
      if (len <= 5) return JSON.stringify(value);
      const first3 = value.slice(0, 3);
      const last2 = value.slice(-2);
      const extra = len - 5;
      return JSON.stringify([...first3, `... +${extra} more ...`, ...last2]);
    }
    return JSON.stringify(value);
  }

  if (strategy === 'summary') {
    if (Array.isArray(value)) {
      const len = value.length;
      if (len === 0) return `Empty array.`;
      const typeName = inferTypeName(value);
      const baseType = typeName.replace('[]', '');
      if (value.length > 0) {
        const first = value[0];
        if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
          const fields = Object.keys(first as Record<string, unknown>).join(', ');
          return `Array of ${len} ${baseType} objects. Fields: ${fields}.`;
        }
      }
      return `Array of ${len} ${baseType} values.`;
    }
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>);
      return `Object with ${keys.length} keys: ${keys.join(', ')}.`;
    }
    return `${typeof value}: ${String(value)}`;
  }

  if (strategy === 'hash') {
    const json = JSON.stringify(value);
    const sha1 = createHash('sha1').update(json).digest('hex').slice(0, 8);
    return `/* sha1:${sha1} */`;
  }

  return String(value);
}

export class MemoryEngine {
  private readonly _trace: TraceWriter;
  private readonly _budgetTracker: BudgetTracker;
  private readonly _onAutoCompact?: (compacted: string[]) => void;
  private readonly _pins: Map<string, PinRecord> = new Map();
  private readonly _compactions: Map<string, CompactionRecord> = new Map();

  constructor(opts: {
    trace: TraceWriter;
    budgetTracker: BudgetTracker;
    onAutoCompact?: (compacted: string[]) => void;
  }) {
    this._trace = opts.trace;
    this._budgetTracker = opts.budgetTracker;
    this._onAutoCompact = opts.onAutoCompact;
  }

  pin(name: string, opts?: PinOptions): void {
    const record: PinRecord = {
      name,
      cycleAdded: this._budgetTracker.inspectCount,
      maxTokens: opts?.maxTokens,
      gitRef: this._budgetTracker.inspectCount,
    };
    this._pins.set(name, record);
    this._trace.write({ type: 'pin', name, maxTokens: opts?.maxTokens ?? null });
  }

  unpin(name: string): void {
    this._pins.delete(name);
    this._trace.write({ type: 'unpin', name });
  }

  compact(name: string, value: unknown, opts: CompactOptions): void {
    const compressed = applyCompactStrategy(value, opts.strategy, { maxTokens: opts.maxTokens });
    const record: CompactionRecord = {
      name,
      strategy: opts.strategy,
      compressed,
    };
    this._compactions.set(name, record);
    this._trace.write({ type: 'compact', name, strategy: opts.strategy });
  }

  expand(name: string): void {
    this._compactions.delete(name);
    this._trace.write({ type: 'expand', name });
  }

  autoCompact(
    scope: Record<string, unknown>,
    opts: {
      inspectCount: number;
      lastAccessedCycle: Map<string, number>;
      tier: 'early' | 'mid' | 'late';
    },
  ): string[] {
    const thresholds: Record<string, number> = {
      early: 10,
      mid: 6,
      late: 3,
    };
    const threshold = thresholds[opts.tier];

    const compacted: string[] = [];

    for (const [name, value] of Object.entries(scope)) {
      if (this._pins.has(name)) continue;
      const last = opts.lastAccessedCycle.get(name);
      const dist = last === undefined ? opts.inspectCount : opts.inspectCount - last;
      if (dist >= threshold) {
        this.compact(name, value, { strategy: 'schema' });
        compacted.push(name);
      }
    }

    this._trace.write({ type: 'auto_compact', names: compacted, tier: opts.tier });

    if (compacted.length > 0 && this._onAutoCompact) {
      this._onAutoCompact(compacted);
    }

    return compacted;
  }

  getPinMeta(name: string): PinRecord | undefined {
    return this._pins.get(name);
  }

  getCompaction(name: string): CompactionRecord | undefined {
    return this._compactions.get(name);
  }

  getPins(): Map<string, PinRecord> {
    return this._pins;
  }

  getCompactions(): Map<string, CompactionRecord> {
    return this._compactions;
  }

  registerGlobals(ctx: QuickJSAsyncContext): void {
    injectGlobal(ctx, 'pin', (name: unknown, opts: unknown) => {
      this.pin(name as string, opts as PinOptions | undefined);
    });

    injectGlobal(ctx, 'unpin', (name: unknown) => {
      this.unpin(name as string);
    });

    injectGlobal(ctx, 'compact', (name: unknown, value: unknown, opts: unknown) => {
      this.compact(name as string, value, opts as CompactOptions);
    });

    injectGlobal(ctx, 'expand', (name: unknown) => {
      this.expand(name as string);
    });
  }
}
