/**
 * Serializes scope values to TypeScript comment syntax used in __scope and scope.json.
 */
import type { CompactionRecord, SessionError } from '../session/types.js';

export type { CompactionRecord } from '../session/types.js';

export type PromiseState =
  | { status: 'pending' }
  | { status: 'resolved'; value: unknown }
  | { status: 'rejected'; error: string }
  | { status: 'asking' };

export interface SerializeScopeOptions {
  depth?: number;
  pins: Set<string>;
  compactions: Map<string, CompactionRecord>;
  promiseStates: Map<string, PromiseState>;
  decayTier: 'early' | 'mid' | 'late';
  lastAccessedCycle: Map<string, number>;
  inspectCount: number;
}

function cycleDistance(name: string, opts: SerializeScopeOptions): number {
  const last = opts.lastAccessedCycle.get(name);
  if (last === undefined) return opts.inspectCount;
  return opts.inspectCount - last;
}

function effectiveDepth(name: string, opts: SerializeScopeOptions, baseDepth: number): number {
  if (opts.pins.has(name)) return baseDepth;
  const dist = cycleDistance(name, opts);
  if (opts.decayTier === 'mid' && dist >= 3) return 1;
  if (opts.decayTier === 'late') return 1;
  return baseDepth;
}

function truncateValue(value: unknown, depth: number, isRoot = false): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return `Symbol(${value.description ?? ''})`;
  if (typeof value === 'function') return '/* Function */';

  if (typeof value === 'string') {
    if (value.length <= 100) return JSON.stringify(value);
    return `{ length: ${value.length}, preview: ${JSON.stringify(value.slice(0, 80) + '…')} }`;
  }

  if (typeof value === 'object') {
    // Orphan placeholder
    if (
      value !== null &&
      typeof (value as Record<string, unknown>)['__orphaned'] === 'string'
    ) {
      const cls = (value as Record<string, unknown>)['__orphaned'] as string;
      return `/* OrphanedInstance: ${cls} */`;
    }

    if (value instanceof Promise) return '/* Promise */';

    if (Array.isArray(value)) {
      if (!isRoot && depth === 0) {
        const elementType = value.length > 0 ? typeof value[0] : 'unknown';
        return `/* Array<${elementType}>(${value.length}) */`;
      }
      if (value.length === 0) return '[]';
      const elements = value.slice(0, 3).map((el) => truncateValue(el, depth - 1));
      const truncated = value.length > 3 ? `, /* +${value.length - 3} more */` : '';
      return `[${elements.join(', ')}${truncated}]`;
    }

    if (value instanceof Set) return `/* Set(${value.size}) */`;
    if (value instanceof Map) return `/* Map(${value.size}) */`;

    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return '{}';

    if (depth === 0) {
      return `/* Object { _keys: ${keys.length} } */`;
    }

    if (keys.length > 5) {
      return `/* Object { _keys: ${keys.length} } */`;
    }

    const entries = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${k}: ${truncateValue(v, depth - 1)}`;
    });
    return `{ ${entries.join(', ')} }`;
  }

  return String(value);
}

function formatScopeEntry(
  name: string,
  value: unknown,
  opts: SerializeScopeOptions,
  baseDepth: number,
  forJson: boolean,
): string {
  // Check compaction
  const compaction = opts.compactions.get(name);
  if (compaction) {
    if (forJson) return JSON.stringify(compaction.compressed);
    return compaction.compressed;
  }

  // Check promise state
  const promiseState = opts.promiseStates.get(name);
  if (promiseState) {
    if (promiseState.status === 'pending') {
      return forJson ? '"/* Promise: pending */"' : '/* Promise: pending */';
    }
    if (promiseState.status === 'asking') {
      return forJson ? '"/* Promise: asking */"' : '/* Promise: asking */';
    }
    if (promiseState.status === 'resolved') {
      const depth = effectiveDepth(name, opts, baseDepth);
      if (forJson) return jsonTruncate(promiseState.value, depth);
      return truncateValue(promiseState.value, depth);
    }
    if (promiseState.status === 'rejected') {
      return forJson
        ? JSON.stringify(`/* Promise: rejected: ${promiseState.error} */`)
        : `/* Promise: rejected: ${promiseState.error} */`;
    }
  }

  const depth = effectiveDepth(name, opts, baseDepth);

  if (forJson) return jsonTruncate(value, depth);
  return truncateValue(value, depth, true);
}

function jsonTruncate(value: unknown, depth: number): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.length <= 100) return JSON.stringify(value);
    return JSON.stringify({ length: value.length, preview: value.slice(0, 80) + '…' });
  }
  if (typeof value === 'function') return '"[Function]"';
  if (typeof value === 'symbol') return `"[Symbol]"`;
  if (typeof value === 'bigint') return `"${value}n"`;
  if (typeof value === 'object') {
    if (
      value !== null &&
      typeof (value as Record<string, unknown>)['__orphaned'] === 'string'
    ) {
      const cls = (value as Record<string, unknown>)['__orphaned'] as string;
      return JSON.stringify(`[OrphanedInstance: ${cls}]`);
    }
    if (value instanceof Promise) return '"[Promise]"';
    if (Array.isArray(value)) {
      if (depth === 0) return JSON.stringify(`[Array(${value.length})]`);
      const elements = value.slice(0, 3).map((el) => jsonTruncate(el, depth - 1));
      return `[${elements.join(',')}]`;
    }
    if (value instanceof Set) return JSON.stringify(`[Set(${value.size})]`);
    if (value instanceof Map) return JSON.stringify(`[Map(${value.size})]`);
    if (depth === 0) {
      const keys = Object.keys(value as Record<string, unknown>);
      return JSON.stringify(`[Object { _keys: ${keys.length} }]`);
    }
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 5);
    const entries = keys.map((k) => {
      const v = (value as Record<string, unknown>)[k];
      return `${JSON.stringify(k)}:${jsonTruncate(v, depth - 1)}`;
    });
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

export function serializeScopeBlock(
  scope: Record<string, unknown>,
  opts: SerializeScopeOptions,
): string {
  const baseDepth = opts.depth ?? 2;
  const lines: string[] = [];
  for (const [name, value] of Object.entries(scope)) {
    const repr = formatScopeEntry(name, value, opts, baseDepth, false);
    lines.push(`  ${name}: ${repr},`);
  }
  return lines.join('\n');
}

export function serializeScopeJson(
  scope: Record<string, unknown>,
  opts: SerializeScopeOptions,
): string {
  const baseDepth = opts.depth ?? 2;
  const entries: string[] = [];
  for (const [name, value] of Object.entries(scope)) {
    const repr = formatScopeEntry(name, value, opts, baseDepth, true);
    entries.push(`  ${JSON.stringify(name)}: ${repr}`);
  }
  return `{\n${entries.join(',\n')}\n}`;
}
