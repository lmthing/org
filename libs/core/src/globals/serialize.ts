export interface SerializeOpts {
  depthCap?: number;
  byteCap?: number;
  /**
   * Max length before a string value is cut with a "chars total" annotation. Defaults to
   * 200 for the ordinary VARIABLES preview. `inspect()` passes a much larger bound
   * (`INSPECT_STR_CAP` in `inspect.ts`) — the model calling `inspect(var, { slice/path })`
   * is explicitly asking to see more of a value than the standard preview allows, and the
   * hardcoded 200-char cap used to apply anyway, silently defeating that escape hatch for
   * any oversized STRING (a document, a delegate's transcription, an API response body).
   */
  strCap?: number;
}

const DEFAULT_DEPTH_CAP = 6;
const DEFAULT_BYTE_CAP = 4096;
const DEFAULT_STR_CAP = 200;

/**
 * Capped JSON serializer. Truncates deeply nested or large values with a
 * placeholder message that guides the user to use inspect() to expand.
 */
export function serialize(value: unknown, opts?: SerializeOpts): string {
  const depthCap = opts?.depthCap ?? DEFAULT_DEPTH_CAP;
  const byteCap = opts?.byteCap ?? DEFAULT_BYTE_CAP;
  const strCap = opts?.strCap ?? DEFAULT_STR_CAP;

  const result = serializeValue(value, 0, depthCap, strCap);
  if (result.length <= byteCap) return result;

  // If still over cap, truncate with a message
  return (
    result.slice(0, byteCap - 60) +
    `… [truncated — inspect([var, { slice: [0, 10] }]) to expand]`
  );
}

function serializeValue(value: unknown, depth: number, depthCap: number, strCap: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);

  if (typeof value === 'string') {
    if (value.length > strCap) {
      const head = JSON.stringify(value.slice(0, strCap));
      return `${head.slice(0, -1)}… (${value.length} chars total)"`;
    }
    return JSON.stringify(value);
  }

  if (depth >= depthCap) {
    if (Array.isArray(value)) {
      return `[… ${value.length} items, truncated — inspect([var, { depth: ${depthCap + 2} }]) to expand]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value as object);
      return `{… ${keys.length} keys, truncated — inspect([var, { depth: ${depthCap + 2} }]) to expand}`;
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    const MAX_ITEMS = 20;
    const items = value.slice(0, MAX_ITEMS).map((item) => serializeValue(item, depth + 1, depthCap, strCap));
    const suffix = value.length > MAX_ITEMS ? `, … (${value.length} items total)` : '';
    return `[${items.join(', ')}${suffix}]`;
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array((value as ArrayBufferView).buffer);
    return `<ArrayBuffer ${bytes.length} bytes>`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const MAX_KEYS = 20;
    const keys = Object.keys(obj).slice(0, MAX_KEYS);
    const entries = keys.map((k) => `${JSON.stringify(k)}: ${serializeValue(obj[k], depth + 1, depthCap, strCap)}`);
    const suffix = Object.keys(obj).length > MAX_KEYS
      ? `, … (${Object.keys(obj).length} keys total)`
      : '';
    return `{${entries.join(', ')}${suffix}}`;
  }

  return String(value);
}
