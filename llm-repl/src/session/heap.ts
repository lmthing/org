/**
 * Binary serialization of QuickJS scope values into heap.bin.
 * Format: JSON-encoded HeapFile { version: 1, scope: Record<string, SerializableValue> },
 * stored as UTF-8 Buffer. Capped at 64MB.
 */

export const HEAP_MAX_BYTES = 64 * 1024 * 1024;

// ── Serializable value types ──

export type SerializableValue =
  | { t: 'u' }
  | { t: 'n' }
  | { t: 'b'; v: boolean }
  | { t: 'i'; v: number }
  | { t: 's'; v: string }
  | { t: 'a'; e: SerializableValue[] }
  | { t: 'o'; e: [string, SerializableValue][] }
  | { t: 'S'; e: SerializableValue[] }
  | { t: 'M'; e: [SerializableValue, SerializableValue][] }
  | { t: 'x'; cls: string; keys: string[]; data: Record<string, SerializableValue> }

interface HeapFile {
  version: 1;
  scope: Record<string, SerializableValue>;
}

function serializeValue(value: unknown, seen: WeakSet<object>): SerializableValue {
  if (value === undefined) return { t: 'u' };
  if (value === null) return { t: 'n' };
  if (typeof value === 'boolean') return { t: 'b', v: value };
  if (typeof value === 'number') return { t: 'i', v: value };
  if (typeof value === 'string') return { t: 's', v: value };
  if (typeof value === 'function') return { t: 'u' };
  if (typeof value === 'symbol') return { t: 'u' };
  if (typeof value === 'bigint') return { t: 's', v: value.toString() };

  if (typeof value === 'object') {
    if (seen.has(value)) return { t: 'u' };
    seen.add(value);

    if (value instanceof Promise) {
      seen.delete(value);
      return { t: 'u' };
    }

    if (Array.isArray(value)) {
      const e = value.map((el) => serializeValue(el, seen));
      seen.delete(value);
      return { t: 'a', e };
    }

    if (value instanceof Set) {
      const e: SerializableValue[] = [];
      for (const item of value) {
        e.push(serializeValue(item, seen));
      }
      seen.delete(value);
      return { t: 'S', e };
    }

    if (value instanceof Map) {
      const e: [SerializableValue, SerializableValue][] = [];
      for (const [k, v] of value) {
        e.push([serializeValue(k, seen), serializeValue(v, seen)]);
      }
      seen.delete(value);
      return { t: 'M', e };
    }

    // Check if it's a plain Object or an orphan
    const ctor = (value as Record<string, unknown>).constructor;
    const isOrphan =
      '__orphaned' in (value as Record<string, unknown>) ||
      (ctor !== undefined && ctor !== null && ctor !== Object);

    if (isOrphan) {
      const cls =
        typeof (value as Record<string, unknown>)['__orphaned'] === 'string'
          ? (value as Record<string, unknown>)['__orphaned'] as string
          : (ctor as { name?: string })?.name ?? 'Unknown';
      const keys = Object.keys(value as Record<string, unknown>);
      const data: Record<string, SerializableValue> = {};
      for (const key of keys) {
        data[key] = serializeValue((value as Record<string, unknown>)[key], seen);
      }
      seen.delete(value);
      return { t: 'x', cls, keys, data };
    }

    const e: [string, SerializableValue][] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      e.push([k, serializeValue(v, seen)]);
    }
    seen.delete(value);
    return { t: 'o', e };
  }

  return { t: 'u' };
}

function deserializeValue(sv: SerializableValue): unknown {
  switch (sv.t) {
    case 'u': return undefined;
    case 'n': return null;
    case 'b': return sv.v;
    case 'i': return sv.v;
    case 's': return sv.v;
    case 'a': return sv.e.map(deserializeValue);
    case 'S': {
      const s = new Set<unknown>();
      for (const item of sv.e) s.add(deserializeValue(item));
      return s;
    }
    case 'M': {
      const m = new Map<unknown, unknown>();
      for (const [k, v] of sv.e) m.set(deserializeValue(k), deserializeValue(v));
      return m;
    }
    case 'o': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of sv.e) obj[k] = deserializeValue(v);
      return obj;
    }
    case 'x': {
      const obj: Record<string, unknown> = {
        __orphaned: sv.cls,
        __keys: sv.keys,
      };
      for (const [k, v] of Object.entries(sv.data)) {
        obj[k] = deserializeValue(v);
      }
      return obj;
    }
  }
}

export function marshalHeap(
  scope: Record<string, unknown>,
): { buf: Buffer; skipped: boolean } {
  const seen = new WeakSet<object>();
  const serializedScope: Record<string, SerializableValue> = {};
  for (const [k, v] of Object.entries(scope)) {
    serializedScope[k] = serializeValue(v, seen);
  }
  const file: HeapFile = { version: 1, scope: serializedScope };
  const json = JSON.stringify(file);
  const buf = Buffer.from(json, 'utf-8');
  if (buf.byteLength > HEAP_MAX_BYTES) {
    return { buf: Buffer.alloc(0), skipped: true };
  }
  return { buf, skipped: false };
}

export function unmarshalHeap(buf: Buffer): Record<string, unknown> {
  if (buf.byteLength === 0) return {};
  const json = buf.toString('utf-8');
  const file = JSON.parse(json) as HeapFile;
  const result: Record<string, unknown> = {};
  for (const [k, sv] of Object.entries(file.scope)) {
    result[k] = deserializeValue(sv);
  }
  return result;
}
