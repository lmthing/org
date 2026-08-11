/**
 * JSX descriptors — the currency between the sandbox and every renderer.
 *
 * The model writes JSX; the VM's `React.createElement` shim turns it into a
 * plain `{ type, props, children }` object (`../exec/bootstrap.ts`). That object
 * travels over a trace event, a WebSocket frame, or an append-only channel log
 * before anything renders it — so by the time a surface sees it, it is just
 * JSON, and the ONLY thing separating "a rendered card" from "a wall of
 * braces" is whether that surface recognises the shape.
 *
 * This module is the recogniser, and it is deliberately here rather than in a
 * renderer: the web transcript, the team-channel log and the terminal must
 * agree on what a descriptor is and which components are allowed to render, or
 * the same agent answer looks different on each one.
 *
 * Browser-safe (no Node imports) so `@lmthing/core/ui` can be bundled.
 */

import { CATALOG_BY_NAME } from './catalog.js';

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
 * aliases above, matched case-insensitively (the model may write `<Stack>` and
 * a fixture `stack`).
 *
 * This is the allowlist. A descriptor naming anything else is not a component
 * this product ships, so no renderer may invent a representation for it — see
 * {@link sanitizeDescriptor}.
 */
export function isRenderableType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const key = type.toLowerCase();
  return key in CATALOG_BY_NAME || key in RENDER_ALIASES;
}

/** All renderable type names, lower-cased — for tests and renderer switches. */
export function renderableTypes(): string[] {
  return [...Object.keys(CATALOG_BY_NAME), ...Object.keys(RENDER_ALIASES)].sort();
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
 * A descriptor that arrived as text. Everything between the sandbox and a
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

/**
 * Drop everything that is not an allowed component, keeping the content.
 *
 * An unknown type is UNWRAPPED rather than deleted: its children are kept and
 * spliced into the parent. A component nobody ships is a styling question, and
 * losing the sentence inside it to answer that question is worse than losing
 * the box. What must not survive is the descriptor itself leaking to the reader
 * as `{"type":"Whatever","props":{…}}`.
 *
 * Non-descriptor values (a plain object the agent returned, a number) are left
 * alone — a renderer decides how to present those; this function only rules on
 * COMPONENTS.
 */
export function sanitizeDescriptor(value: unknown): unknown {
  if (Array.isArray(value)) return value.flatMap((v) => flattenSanitized(v));
  if (!isJsxDescriptor(value)) return value;
  const kept = flattenSanitized(value);
  return kept.length === 1 ? kept[0] : kept;
}

/** Sanitize one node into the list of nodes that replace it in its parent. */
function flattenSanitized(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => flattenSanitized(v));
  if (!isJsxDescriptor(value)) return [value];

  const children = (value.children ?? []).flatMap((c) => flattenSanitized(c));
  // Unknown component: keep the content, drop the box.
  if (!isRenderableType(value.type)) return children;
  return [{ type: value.type, props: value.props ?? {}, children }];
}

/**
 * Flatten a descriptor to plain text — the fallback body for a surface that
 * cannot render components (a push notification, a channel-log `text` field an
 * older client reads, a search index).
 *
 * Text-bearing props are included because several catalog components carry
 * their content in props rather than children (`Markdown text`, `Card title`,
 * `List items`, `Table rows`), and a plain-text fallback that omitted them
 * would be empty for exactly the answers worth summarising.
 */
export function descriptorToText(value: unknown): string {
  return collectText(value).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const BLOCK_TYPES = new Set([
  'heading', 'h1', 'h2', 'h3', 'h4', 'paragraph', 'p', 'stack', 'card', 'panel',
  'callout', 'alert', 'banner', 'quote', 'codeblock', 'markdown', 'list',
  'orderedlist', 'listitem', 'table', 'keyvalue', 'timeline', 'details',
  'divider', 'statcard', 'progressbar', 'columns', 'checklist', 'plan', 'tasklist',
]);

/** `[ ] `/`[~] `/`[x] `/`[✗] ` prefix for a checklist item's status, in a plain-text fallback. */
function checklistMark(status: unknown): string {
  return status === 'completed' ? '[x] ' : status === 'in_progress' ? '[~] ' : status === 'failed' ? '[✗] ' : '[ ] ';
}

function collectText(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(collectText).join('');
  if (!isJsxDescriptor(value)) return '';

  const props = value.props ?? {};
  const parts: string[] = [];
  for (const key of ['title', 'label', 'summary', 'text']) {
    const v = props[key];
    if (typeof v === 'string' && v) parts.push(v);
  }
  if (Array.isArray(props['items'])) {
    // A checklist item is a plain `{ content, status }` object, not a descriptor, so
    // `collectText` alone would drop it — render each as a marked line instead.
    const items = props['items'] as unknown[];
    const asChecklist = items.every(
      (it) => it && typeof it === 'object' && typeof (it as { content?: unknown }).content === 'string',
    );
    if (items.length > 0 && asChecklist) {
      parts.push(
        items
          .map((it) => {
            const i = it as { content: string; status?: unknown };
            return `${checklistMark(i.status)}${i.content}`;
          })
          .join('\n'),
      );
    } else {
      parts.push(items.map(collectText).join('\n'));
    }
  }
  if (Array.isArray(props['columns'])) parts.push((props['columns'] as unknown[]).map(collectText).join(' | '));
  if (Array.isArray(props['rows'])) {
    parts.push(
      (props['rows'] as unknown[])
        .map((r) => (Array.isArray(r) ? r.map(collectText).join(' | ') : collectText(r)))
        .join('\n'),
    );
  }
  const pairs = props['pairs'];
  if (pairs && typeof pairs === 'object' && !Array.isArray(pairs)) {
    parts.push(
      Object.entries(pairs as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${collectText(v)}`)
        .join('\n'),
    );
  }
  const kids = (value.children ?? []).map(collectText).filter(Boolean);
  if (kids.length) parts.push(kids.join(''));

  const body = parts.filter(Boolean).join('\n');
  return BLOCK_TYPES.has(String(value.type).toLowerCase()) ? `${body}\n` : body;
}
