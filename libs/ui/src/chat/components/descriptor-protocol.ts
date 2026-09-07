/**
 * JSX descriptors — the currency between an agent runtime and every renderer.
 *
 * VENDORED (runtime-ported, not stubbed) from `@lmthing/core`'s
 * `libs/core/src/ui/descriptor.ts` (previously imported as
 * `@lmthing/core/ui`'s `isRenderableType`/`parseDescriptorPayload`) when
 * `@lmthing/ui` severed its dependency on `@lmthing/core`. Only the pieces
 * actually consumed here are copied — `isRenderableType`, `parseDescriptorPayload`
 * and their internal dependency `isJsxDescriptor` — copied byte-for-byte from
 * core's source, including the `.toLowerCase()` matching semantics against
 * {@link CATALOG_BY_NAME} (vendored alongside in `./component-catalog`) and
 * {@link RENDER_ALIASES}. `renderableTypes`, `sanitizeDescriptor` and
 * `descriptorToText` were NOT ported: no file under `libs/ui/src` imported
 * them, so there is nothing here that exercises them. If `@lmthing/ui` later
 * needs one of those, port it from the same source file the same way.
 *
 * The old QuickJS VM's `React.createElement` shim used to turn model-authored
 * JSX into this plain `{ type, props, children }` object; that object then
 * travelled over a trace event, a WebSocket frame, or an append-only channel
 * log before anything rendered it — so by the time a surface saw it, it was
 * just JSON, and the ONLY thing separating "a rendered card" from "a wall of
 * braces" was whether that surface recognised the shape. `@lmthing/ui`'s
 * `render-descriptor.tsx` is exactly such a surface, so it keeps its own copy
 * of the recogniser now that the shared one lives in a runtime being retired.
 */

import { CATALOG_BY_NAME } from './component-catalog';

export interface JsxDescriptor {
  type: string;
  props?: Record<string, unknown>;
  children?: unknown[];
}

/**
 * Renderer-only type names: aliases a renderer accepts that are NOT catalog
 * components, so the model cannot write them (they have no JSX stub and no DTS
 * declaration) but a hand-built descriptor or a host-emitted one can use them.
 *
 * `fragment` is what the VM's `React.Fragment` marshals to; the HTML-ish names
 * are the shorthand the renderers have always accepted for a catalog component.
 */
export const RENDER_ALIASES: Readonly<Record<string, string>> = {
  fragment: 'Fragment',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  p: 'Paragraph',
  span: 'Text',
  inline: 'Row',
  img: 'Image',
  image: 'Image',
  audio: 'Audio',
  // The live plan/checklist a renderer draws with real checkboxes. Host-emitted by the
  // `todoWrite` system function (`display({ type: 'checklist', props: { items } })`); the
  // model never hand-writes it, so it has no catalog entry or DTS stub. `plan`/`tasklist`
  // are accepted spellings of the same thing.
  checklist: 'Checklist',
  plan: 'Checklist',
  tasklist: 'Checklist',
};

/**
 * Every type name a renderer may draw: the design-system catalog plus the
 * aliases above, matched case-insensitively (a descriptor may name `<Stack>` or
 * a fixture `stack`).
 *
 * This is the allowlist. `render-descriptor.tsx` unwraps (rather than renders)
 * a descriptor naming anything else.
 */
export function isRenderableType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const key = type.toLowerCase();
  return key in CATALOG_BY_NAME || key in RENDER_ALIASES;
}

export function isJsxDescriptor(v: unknown): v is JsxDescriptor {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as JsxDescriptor).type === 'string'
  );
}

/**
 * A descriptor that arrived as text. Everything between an agent runtime and a
 * surface is JSON at some point — a channel log line, a `result` flattened by
 * an older writer — so a string that parses back to a descriptor is a
 * descriptor, not prose, and rendering it as prose is the bug this exists to
 * stop. Anything else (ordinary markdown, a JSON array of numbers, malformed
 * text) returns `null` and stays text.
 */
export function parseDescriptorPayload(text: unknown): JsxDescriptor | JsxDescriptor[] | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (isJsxDescriptor(parsed)) return parsed;
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isJsxDescriptor)) {
    return parsed as JsxDescriptor[];
  }
  return null;
}
