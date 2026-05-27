/**
 * Type-aware preview serializer for values surfaced into the context
 * reconstruction by `inspect()`.
 *
 * Per-type strategy:
 *   - string         → first N chars + JS comment naming exact query to load more
 *   - array          → first M items + JS comment with slice query
 *   - object         → all keys at current depth; values recursed; at max depth,
 *                      collapse to placeholder comment naming `path` query
 *   - Uint8Array/Buffer-ish → hex preview of first ~32 bytes + comment
 *   - Set / Map      → rendered as array / object respectively
 *   - primitives     → as-is
 *
 * The LLM reads the embedded `// load more:` comments — each one names the
 * **exact** `inspect(...)` re-query that fetches the omitted slice.
 */

export interface PreviewLimits {
  stringChars?: number;
  arrayItems?: number;
  depth?: number;
  indent?: number;
  /** For Uint8Array / Buffer values: max bytes shown as hex preview. */
  bytesShown?: number;
}

const DEFAULTS: Required<PreviewLimits> = {
  stringChars: 400,
  arrayItems: 5,
  depth: 3,
  indent: 2,
  bytesShown: 32,
};

interface RenderCtx {
  lim: Required<PreviewLimits>;
  rootName: string;
}

export function previewSerialize(value: unknown, limits: PreviewLimits = {}, name?: string): string {
  const lim = { ...DEFAULTS, ...limits };
  const ctx: RenderCtx = { lim, rootName: name ?? "value" };
  return render(ctx, value, 0, ctx.rootName);
}

function render(ctx: RenderCtx, value: unknown, depth: number, path: string): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "number" || t === "boolean") return String(value);
  if (t === "bigint") return `${value}n`;
  if (t === "string") return renderString(ctx, value as string, path);
  if (t === "function") return `"[Function]"`;
  if (t === "symbol") return `"[Symbol]"`;

  if (isBufferLike(value)) return renderBytes(ctx, value as Uint8Array, path);

  if (depth >= ctx.lim.depth) {
    return depthPlaceholder(value, path);
  }

  if (Array.isArray(value)) return renderArray(ctx, value, depth, path);
  if (value instanceof Set) return renderArray(ctx, [...value], depth, path);
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) obj[String(k)] = v;
    return renderObject(ctx, obj, depth, path);
  }

  return renderObject(ctx, value as Record<string, unknown>, depth, path);
}

// ── string ─────────────────────────────────────────────────────────────────

function renderString(ctx: RenderCtx, s: string, path: string): string {
  if (s.length <= ctx.lim.stringChars) return JSON.stringify(s);
  const head = s.slice(0, ctx.lim.stringChars);
  const remaining = s.length - ctx.lim.stringChars;
  const loadMore = inspectQuery(path, { path: pathSuffix(path), slice: [0, s.length] });
  // Embed the rest-marker as a TS comment so the LLM can read it but parsers see only the head.
  return `${JSON.stringify(head)} /* …${remaining} more chars; total ${s.length}. load more: ${loadMore} */`;
}

// ── array ──────────────────────────────────────────────────────────────────

function renderArray(ctx: RenderCtx, arr: unknown[], depth: number, path: string): string {
  if (arr.length === 0) return "[]";
  const indent = " ".repeat(ctx.lim.indent * (depth + 1));
  const close = " ".repeat(ctx.lim.indent * depth);
  const shown = arr.slice(0, ctx.lim.arrayItems);
  const lines = shown.map((el, i) => `${indent}${render(ctx, el, depth + 1, `${path}[${i}]`)}`);
  if (arr.length > ctx.lim.arrayItems) {
    const remaining = arr.length - ctx.lim.arrayItems;
    const sliceMore = inspectQuery(path, { slice: [ctx.lim.arrayItems, arr.length] });
    const sampleMore = inspectQuery(path, { sample: 10 });
    lines.push(`${indent}/* …${remaining} more items; total ${arr.length}. load more: ${sliceMore} or ${sampleMore} */`);
  }
  return `[\n${lines.join(",\n")}\n${close}]`;
}

// ── object ─────────────────────────────────────────────────────────────────

function renderObject(ctx: RenderCtx, obj: Record<string, unknown>, depth: number, path: string): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const indent = " ".repeat(ctx.lim.indent * (depth + 1));
  const close = " ".repeat(ctx.lim.indent * depth);
  const lines = keys.map((k) => {
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    return `${indent}${safeKey}: ${render(ctx, obj[k], depth + 1, `${path}.${k}`)}`;
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
}

function depthPlaceholder(value: unknown, path: string): string {
  if (Array.isArray(value)) {
    const slice = inspectQuery(path, { slice: [0, Math.min(value.length, 10)] });
    return `"[Array(${value.length})]" /* depth limit; load more: ${slice} */`;
  }
  if (value instanceof Set) {
    return `"[Set(${value.size})]" /* depth limit; load more: ${inspectQuery(path, { slice: [0, 10] })} */`;
  }
  if (value instanceof Map) {
    return `"[Map(${value.size})]" /* depth limit; load more: ${inspectQuery(path, { keys: true })} */`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object);
    const keysQuery = inspectQuery(path, { keys: true });
    const pathQuery = inspectQuery(path, { path: pathSuffix(path), depth: 5 });
    return `"[Object(${keys.length} keys: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""})]" /* depth limit; load more: ${keysQuery} or ${pathQuery} */`;
  }
  return JSON.stringify(value);
}

// ── bytes (Uint8Array / Buffer / ArrayBuffer-backed views) ────────────────

function isBufferLike(v: unknown): boolean {
  return v instanceof Uint8Array || (typeof Buffer !== "undefined" && v instanceof Buffer);
}

function renderBytes(ctx: RenderCtx, bytes: Uint8Array, path: string): string {
  const shown = Math.min(bytes.length, ctx.lim.bytesShown);
  const hex = Array.from(bytes.slice(0, shown))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  if (bytes.length <= shown) {
    return `"<bytes ${bytes.length}: ${hex}>"`;
  }
  const remaining = bytes.length - shown;
  const more = inspectQuery(path, { slice: [shown, bytes.length] });
  return `"<bytes ${bytes.length}: ${hex} …${remaining} more bytes. load more: ${more}>"`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function inspectQuery(path: string, q: Record<string, unknown>): string {
  // The root path is the variable name (without subscripts). The query's
  // `path` field navigates within that variable. Format the call as it
  // should appear in TS source.
  const root = path.split(/[.\[]/)[0] ?? path;
  const qStr = Object.entries(q)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return `inspect([${root}, { ${qStr} }])`;
}

function pathSuffix(path: string): string {
  // Strip the root name; what's left is the path INTO that variable.
  const root = path.split(/[.\[]/)[0] ?? path;
  if (path === root) return "";
  return path.slice(root.length).replace(/^\./, "");
}
