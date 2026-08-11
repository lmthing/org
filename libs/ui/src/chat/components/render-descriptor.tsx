import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { isRenderableType, parseDescriptorPayload } from '@lmthing/core/ui';
import { Markdown } from '../../elements/content/markdown';
import { CodeBlock } from '../../elements/content/code-block';
import { preview } from '../app/common';
// `.lm-prose` lives in the shared markdown stylesheet; state the dependency where it is used.

/**
 * `--lm-*` colour bridge, inlined.
 *
 * This renderer used to spell every colour as `var(--lm-<name>)`, relying on `app/styles.css` (a
 * web-only stylesheet the `/chat` ROUTE loads) to alias each one onto a shared design token. React
 * Native never loads that CSS file — its primitive layer (`elements/primitives/_native.tsx`)
 * rewrites ANY `var(--x)` straight to the Tamagui token `$x` with no knowledge of the bridge, so
 * `var(--lm-text)` became the token `$lm-text`, which does not exist, and the colour silently
 * vanished on a phone. This IS the renderer for everything `display()` produces, so that took down
 * colour for the whole /chat transcript, `DisplayBlock`, and the team channels on native.
 *
 * The fix is to reach the same token `app/styles.css:42-55` aliases onto, directly, so the value is
 * a real token on both targets rather than a web-only indirection. Kept as a table (not inlined at
 * each call site) because a couple of call sites resolve the name from an agent-authored prop
 * (`color`/`variant`) at runtime rather than a literal.
 */
const LM_COLOR_ALIASES: Record<string, string> = {
  bg: 'background',
  panel: 'muted',
  panel2: 'accent',
  border: 'border',
  text: 'foreground',
  muted: 'muted-foreground',
  accent: 'agent',
  green: 'success',
  red: 'destructive',
  amber: 'warning',
  purple: 'agent',
  cyan: 'knowledge',
};

/**
 * An agent-authored colour name (`"red"`, `"accent"`, or an arbitrary CSS colour like `"crimson"`)
 * → a value both targets can render. A known bridge name resolves to its real token as
 * `var(--token)` (which the native primitive layer rewrites to `$token`, a token that actually
 * exists); anything else passes through unchanged — a literal CSS colour an agent wrote works on
 * web as-is, and is at least AS correct on native as the old `var(--lm-<name>)` fallback, which
 * never reached the fallback on native at all (the rewrite rule captures only the name before the
 * comma).
 */
function lmColor(name: string): string {
  const token = LM_COLOR_ALIASES[name];
  return token ? `var(--${token})` : name;
}

export interface Descriptor { type: string; props?: Record<string, unknown>; children?: unknown[] }
export function isDescriptor(v: unknown): v is Descriptor {
  return !!v && typeof v === 'object' && 'type' in (v as object);
}

/**
 * Content about to go inside a VIEW-like container (`Box`/`Col`/`Row`/`ListItem`/
 * table cells), with any bare string wrapped in a `Text`.
 *
 * React Native refuses to render a string inside a View — "Text strings must be
 * rendered within a <Text> component" — so `<Prim.Td>{'alpha'}</Prim.Td>` puts a
 * cell on the web and nothing on a phone. `react-test-renderer` does not enforce
 * the rule either, which is why `metro/suites/descriptor.tsx` asserts on the
 * host TYPE of the mounted node rather than just finding the text.
 *
 * Harmless on web: `Prim.Text` is an inline span there.
 *
 * `ambient` carries the CONTAINER's own text styling (e.g. `quote`'s `color`/`fontStyle`,
 * `callout`'s tone colour) down onto the `Text` this wraps a bare string in. The container below is
 * a `Prim.Box`/`Prim.Row`, an RN `View`, which drops `color`/`fontFamily`/`fontSize`/`fontWeight`
 * entirely rather than passing them to a text child — and `NativeText`'s own unconditional defaults
 * fill the gap with body ink at body size instead. Only the STRING branch needs it: an already-
 * rendered element (a nested descriptor, a `renderDescriptor` result) carries its own explicit
 * styling from its own case in the switch below.
 */
function inView(content: React.ReactNode, key?: React.Key, ambient?: Prim.TextProps): React.ReactNode {
  if (typeof content === 'string' || typeof content === 'number') {
    return <Prim.Text key={key} {...ambient}>{content}</Prim.Text>;
  }
  if (Array.isArray(content)) return content.map((c, i) => inView(c, i, ambient));
  return content;
}

export function renderDescriptor(d: unknown, key?: React.Key): React.ReactNode {
  if (d === null || d === undefined) return null;
  if (typeof d === 'string' || typeof d === 'number') return d;
  // A top-level array always lands inside a container (a transcript block, a
  // channel message), so a bare string in it is the native "Text strings must be
  // rendered within a <Text>" trap — wrap it here rather than at every caller.
  if (Array.isArray(d)) return d.map((c, i) => inView(renderDescriptor(c, i), i));
  if (!isDescriptor(d)) return <Prim.Text color="var(--muted-foreground)" fontFamily="$mono">{preview(d, 400)}</Prim.Text>;
  // A component nobody ships is a styling question; the sentence inside it is
  // not. Render the children and drop the box, rather than printing the
  // descriptor's own JSON at the reader — which is what this used to do.
  if (!isRenderableType(d.type)) {
    return <React.Fragment key={key}>{inView((d.children ?? []).map((c, i) => renderDescriptor(c, i)))}</React.Fragment>;
  }

  const props = d.props ?? {};
  const kids = (d.children ?? []).map((c, i) => renderDescriptor(c, i));
  const text = props['text'] as string | undefined;
  const body = text !== undefined ? text : kids;
  const color = props['color'] as string | undefined;

  switch (d.type.toLowerCase()) {
    // ── headings + text ──
    case 'h1': case 'h4': case 'heading': {
      // `<h4>` has no case of its own below, so the tag itself carries the level
      // when the descriptor did not spell one out.
      const level = (props['level'] as number) ?? (d.type.toLowerCase() === 'h4' ? 4 : 1);
      const size = level >= 4 ? '$xs' : level === 3 ? '$sm' : level === 2 ? '$base' : '$lg';
      const Tag = (`h${Math.min(Math.max(level, 1), 4)}`) as 'h1';
      // `Prim.Text as="h1"`, not a bare `<h1>`: a raw host tag has no view config on
      // React Native and throws on mount, and the `text-lg font-semibold text-lm-text
      // my-1` className this used to carry was Tailwind, which was deleted — so it was
      // styling nothing on web either.
      return <Prim.Text as={Tag} key={key} color="var(--foreground)" fontSize={size} fontWeight="$semibold" marginVertical="0.25rem">{body}</Prim.Text>;
    }
    case 'h2': return <Prim.Text as="h2" key={key} color="var(--foreground)" fontSize="$base" fontWeight="$semibold" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'h3': return <Prim.Text as="h3" key={key} color="var(--foreground)" fontSize="$sm" fontWeight="$semibold" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'p': case 'paragraph': return <Prim.Text as="p" key={key} color="var(--foreground)" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'text': return <Prim.Text key={key} style={color ? { color: lmColor(color) } : undefined} {...(props['bold'] ? { fontWeight: '$semibold' } : {})} {...(props['dim'] ? { color: 'var(--muted-foreground)' } : {})} {...(props['italic'] ? { fontStyle: 'italic' as const } : {})}>{body}</Prim.Text>;
    case 'strong': return <Prim.Text as="strong" key={key} fontWeight="$semibold">{body}</Prim.Text>;
    case 'em': return <Prim.Text as="em" key={key}>{body}</Prim.Text>;
    case 'muted': return <Prim.Text key={key} color="var(--muted-foreground)">{body}</Prim.Text>;
    case 'kbd': return <Prim.Text as="kbd" key={key} borderColor="var(--border)" backgroundColor="var(--muted)" fontFamily="$mono" fontSize="11px" borderWidth={1} borderRadius="$radius" paddingHorizontal="$1">{body}</Prim.Text>;
    case 'code': return <Prim.Text as="code" key={key} color="var(--knowledge)" backgroundColor="var(--background)" fontFamily="$mono" paddingHorizontal="$1" borderRadius="$radius">{body}</Prim.Text>;
    // A `CodeBlock` is the ONE descriptor whose size is unbounded — THING answers a "build me an
    // app" turn with whole source files, and on a phone each one was thirty screenfuls between one
    // sentence and the next. `CodeBlock` (the element) keeps a short block exactly as it was and
    // opens a long one collapsed. `body` may be a node array when the agent nested children, so the
    // collapsible path is taken only when the content is genuinely a string.
    case 'codeblock': {
      const source = typeof body === 'string'
        ? body
        : (d.children ?? []).every((c) => typeof c === 'string')
          ? (d.children as string[]).join('')
          : null;
      const preProps = { fontFamily: '$mono', fontSize: '12px', color: 'var(--foreground)', backgroundColor: 'var(--background)', borderWidth: 1, borderColor: 'var(--border)', borderRadius: '$radius', padding: '$2', marginVertical: '$1', overflowX: 'auto', whiteSpace: 'pre-wrap' } as const;
      if (source === null) return <Prim.Pre key={key} {...preProps}><Prim.Text as="code">{body}</Prim.Text></Prim.Pre>;
      return <CodeBlock key={key} code={source} {...(typeof props['lang'] === 'string' ? { language: props['lang'] } : {})} preProps={preProps} fadeColor="var(--background)" />;
    }
    case 'markdown': {
      let markdown = text;
      if (!markdown && d.children && d.children.length > 0) {
        markdown = d.children.map(c => typeof c === 'string' ? c : '').join('');
      }
      markdown = markdown || '';
      // The same renderer and scale the transcript uses, so a `markdown` descriptor and a chat
      // message cannot render differently.
      return <Markdown key={key} source={markdown} preset="prose" />;
    }
    case 'span': return <Prim.Text key={key}>{body}</Prim.Text>;
    // `color`/`fontStyle` are on the `Box` (an RN `View`), so `inView` is handed them as `ambient`
    // to stamp onto whatever bare string it wraps — otherwise the quote rendered in body ink,
    // upright, on native.
    case 'quote': return <Prim.Box as="blockquote" key={key} borderColor="var(--border)" color="var(--muted-foreground)" borderLeftWidth={2} paddingLeft="$2" fontStyle="italic" marginVertical="0.25rem">{inView(body, undefined, { color: 'var(--muted-foreground)', fontStyle: 'italic' })}</Prim.Box>;
    case 'link': return <Prim.Link key={key} href={String(props['href'] ?? '#')} target="_blank" rel="noreferrer" color="var(--agent)" textDecorationLine="underline">{body}</Prim.Link>;

    // ── media ──
    case 'image': case 'img': {
      const src = String(props['src'] ?? props['url'] ?? '');
      const alt = String(props['alt'] ?? props['caption'] ?? 'image');
      if (!src) return null;
      return <Prim.Image key={key} src={src} alt={alt} borderColor="var(--border)" maxWidth="100%" maxHeight="360px" borderRadius="$radius-lg" borderWidth={1} marginVertical="$1" objectFit="contain" />;
    }
    case 'audio': {
      const src = String(props['src'] ?? props['url'] ?? '');
      if (!src) return null;
      // No `jsx-a11y` disable: the plugin is not a dependency, so the rule never ran and the
      // directive itself was an error. See the same note in `chat/app/Message.tsx`.
      // `Prim.Audio` is a host passthrough — style props are ignored, so `style` it is.
      return <Prim.Audio key={key} controls src={src} style={{ marginTop: '0.25rem', marginBottom: '0.25rem', maxWidth: '100%' }} />;
    }

    // ── layout ──
    case 'stack': return <Prim.Col key={key} marginVertical="$1" gap={((props['gap'] as number) ?? 1) * 4}>{inView(body)}</Prim.Col>;
    case 'row': case 'inline': {
      const j = props['justify'] as string | undefined;
      const a = props['align'] as string | undefined;
      const jc = j === 'between' ? 'space-between' : j === 'center' ? 'center' : j === 'end' ? 'flex-end' : 'flex-start';
      const ai = a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start';
      return <Prim.Row key={key} marginVertical="$1" gap={((props['gap'] as number) ?? 1) * 4} justifyContent={jc} alignItems={ai}>{inView(body)}</Prim.Row>;
    }
    case 'columns': return <Prim.Box key={key} display="grid" marginVertical="0.25rem" gridTemplateColumns={`repeat(${(d.children ?? []).length || 1}, minmax(0,1fr))`} gap={((props['gap'] as number) ?? 2) * 4}>{inView(body)}</Prim.Box>;
    case 'spacer': return <Prim.Box key={key} flexGrow={1} />;
    case 'divider': return (
      // The Row's `color`/`fontSize` are container props (an RN `View` drops both); the label is
      // the only actual text here, so it alone needs to restate them. The two RULES either side of
      // it hold no text at all — they are `Prim.Box`es, not childless `Prim.Text`s. Giving a face
      // to something with nothing to render answers a lint and not the question.
      <Prim.Row key={key} color="var(--muted-foreground)" gap="$2" marginVertical="$2" fontSize="11px" alignItems="center">
        <Prim.Box borderColor="var(--border)" flexGrow={1} flexShrink={1} flexBasis="0%" borderTopWidth={1} />{props['label'] ? <Prim.Text color="var(--muted-foreground)" fontSize="11px">{String(props['label'])}</Prim.Text> : null}<Prim.Box borderColor="var(--border)" flexGrow={1} flexShrink={1} flexBasis="0%" borderTopWidth={1} />
      </Prim.Row>
    );

    // ── surfaces ──
    case 'card': case 'panel': return (
      <Prim.Box key={key} borderColor="var(--border)" backgroundColor="var(--accent)" borderWidth={1} borderRadius="$radius" padding="$2" marginVertical="0.25rem">
        {props['title'] ? <Prim.Text color="var(--foreground)" fontSize="$sm" fontWeight="$semibold" marginBottom="0.25rem">{String(props['title'])}</Prim.Text> : null}{inView(body)}
      </Prim.Box>
    );
    case 'callout': case 'alert': case 'banner': {
      const variant = props['variant'] as string | undefined;
      const tone = variant === 'error' ? 'red' : variant === 'success' ? 'green' : variant === 'warning' ? 'amber' : 'accent';
      // The Box's `color={lmColor(tone)}` is a container prop an RN `View` drops — the title and
      // any bare-string body both need the tone colour restated, or the whole callout reads in
      // body ink on native regardless of `variant`.
      return <Prim.Box key={key} marginVertical="0.25rem" borderLeftWidth={2} borderLeftColor={lmColor(tone)} color={lmColor(tone)} backgroundColor="var(--accent)" paddingHorizontal="$2" paddingVertical="$1" borderRadius="$radius">{props['title'] ? <Prim.Text color={lmColor(tone)} fontWeight="$semibold">{String(props['title'])}</Prim.Text> : null}{inView(body, undefined, { color: lmColor(tone) })}</Prim.Box>;
    }
    case 'badge': case 'tag': case 'pill': {
      const tone = lmColor(color ?? 'accent');
      return <Prim.Text key={key} display="inline-block" borderRadius={d.type.toLowerCase() === 'pill' ? '$radius-full' : '$radius'} paddingHorizontal="$1.5" paddingVertical="$0.5" fontSize="10px" color={tone} backgroundColor={`color-mix(in srgb, ${tone} 20%, transparent)`}>{body}</Prim.Text>;
    }

    // ── collections ──
    case 'list': case 'orderedlist': {
      const ordered = d.type.toLowerCase() === 'orderedlist';
      const items = props['items'] as (string | number)[] | undefined;
      // `Prim.List` below carries `color="var(--foreground)"` — a container prop an RN `View`
      // (`Prim.List`/`Prim.ListItem`) drops, so each item's text needs its own copy.
      const lis = items ? items.map((it, i) => <Prim.ListItem key={i}><Prim.Text color="var(--foreground)">{String(it)}</Prim.Text></Prim.ListItem>) : kids;
      return ordered
        ? <Prim.List ordered key={key} color="var(--foreground)" marginLeft="1.25rem" marginVertical="0.25rem" style={{ listStyleType: 'decimal' }}>{lis}</Prim.List>
        : <Prim.List key={key} color="var(--foreground)" marginLeft="1.25rem" marginVertical="0.25rem" style={{ listStyleType: 'disc' }}>{lis}</Prim.List>;
    }
    case 'listitem': return <Prim.ListItem key={key}>{inView(body)}</Prim.ListItem>;
    // ── the dynamic plan / checklist (host-emitted by the `todoWrite` system function) ──
    // Real checkboxes + per-task state so the reader can watch the agent work the plan on
    // both personal and team pods (this renderer feeds /chat AND the embedded AgentChatPanel).
    // A Row/View drops text styling on native, so every glyph and label restates its own colour.
    case 'checklist': case 'plan': case 'tasklist': {
      const items = (props['items'] as { content?: unknown; status?: unknown }[] | undefined) ?? [];
      const title = typeof props['title'] === 'string' ? (props['title'] as string) : 'Plan';
      const done = items.filter((it) => it && it.status === 'completed').length;
      // pending ☐, in_progress ◐ (spins), completed ☑, failed ✗ — mirrors the ExecutionTree glyphs.
      const glyph = (s: unknown): string =>
        s === 'completed' ? '☑' : s === 'in_progress' ? '◐' : s === 'failed' ? '✗' : '☐';
      const glyphColor = (s: unknown): string =>
        s === 'completed' ? 'var(--success)'
          : s === 'in_progress' ? 'var(--agent)'
          : s === 'failed' ? 'var(--destructive)'
          : 'var(--muted-foreground)';
      const textColor = (s: unknown): string =>
        s === 'completed' ? 'var(--muted-foreground)' : s === 'failed' ? 'var(--destructive)' : 'var(--foreground)';
      return (
        <Prim.Box key={key} borderColor="var(--border)" backgroundColor="var(--accent)" borderWidth={1} borderRadius="$radius" padding="$2" marginVertical="0.25rem">
          <Prim.Row justifyContent="space-between" alignItems="center" marginBottom="0.25rem">
            <Prim.Text color="var(--foreground)" fontSize="$sm" fontWeight="$semibold">{title}</Prim.Text>
            <Prim.Text color="var(--muted-foreground)" fontSize="10px">{done}/{items.length}</Prim.Text>
          </Prim.Row>
          <Prim.Col gap="$1">
            {items.map((it, i) => (
              <Prim.Row key={i} gap="$2" alignItems="flex-start">
                <Prim.Text className={it && it.status === 'in_progress' ? 'lm-spin' : undefined} color={glyphColor(it?.status)} fontFamily="$mono" fontSize="12px">{glyph(it?.status)}</Prim.Text>
                <Prim.Text color={textColor(it?.status)} fontSize="12px" {...(it && it.status === 'completed' ? { textDecorationLine: 'line-through' as const } : {})}>{String(it?.content ?? '')}</Prim.Text>
              </Prim.Row>
            ))}
          </Prim.Col>
        </Prim.Box>
      );
    }
    case 'table': {
      const columns = (props['columns'] as string[]) ?? [];
      const rows = (props['rows'] as (string | number)[][]) ?? [];
      return (
        <Prim.Table key={key} marginVertical="$1" fontSize="12px" borderColor="$collapse">
          {/* `Prim.Th`/`Prim.Td` are RN `View`s (see `primitives/table.native.tsx`) — their own
              `fontWeight`/`color` style the cell container, not the `Prim.Text` inside it. The
              `Prim.Table`'s own `fontSize="12px"` is a container prop too, so both cell texts
              also restate it here rather than falling back to Tamagui's default size. */}
          {columns.length > 0 && <Prim.Thead><Prim.Tr>{columns.map((c, i) => <Prim.Th key={i} textAlign="left" fontWeight="$semibold" color="var(--muted-foreground)" borderBottomWidth={1} borderColor="var(--border)" paddingHorizontal="$2" paddingVertical="$1"><Prim.Text fontWeight="$semibold" color="var(--muted-foreground)" fontSize="12px">{c}</Prim.Text></Prim.Th>)}</Prim.Tr></Prim.Thead>}
          <Prim.Tbody>{rows.map((r, ri) => <Prim.Tr key={ri}>{r.map((cell, ci) => <Prim.Td key={ci} borderBottomWidth={1} borderColor="var(--border)" paddingHorizontal="$2" paddingVertical="$1" color="var(--foreground)"><Prim.Text color="var(--foreground)" fontSize="12px">{String(cell)}</Prim.Text></Prim.Td>)}</Prim.Tr>)}</Prim.Tbody>
        </Prim.Table>
      );
    }
    case 'keyvalue': {
      const pairs = (props['pairs'] as Record<string, unknown>) ?? {};
      // `Prim.Box`'s `fontSize="12px"` is a container prop; both `dt`/`dd` already restate their
      // own `color` but not the size, so without this each pair rendered at Tamagui's default text
      // size instead of the compact 12px the rest of the descriptor renderer uses.
      return <Prim.Box as="dl" key={key} fontSize="12px" marginVertical="0.25rem">{Object.entries(pairs).map(([k, v]) => <Prim.Row key={k} gap="$2"><Prim.Text as="dt" color="var(--muted-foreground)" fontSize="12px" minWidth="120px">{k}</Prim.Text><Prim.Text as="dd" color="var(--foreground)" fontSize="12px">{String(v)}</Prim.Text></Prim.Row>)}</Prim.Box>;
    }
    case 'timeline': {
      const items = (props['items'] as { title: string; time?: string; detail?: string }[]) ?? [];
      return <Prim.List key={key} borderColor="var(--border)" borderLeftWidth={1} paddingLeft="$3" marginVertical="0.25rem">{items.map((it, i) => <Prim.ListItem key={i} marginBottom="0.25rem"><Prim.Text color="var(--foreground)">{it.title}{it.time ? <Prim.Text color="var(--muted-foreground)" fontSize="10px" marginLeft="0.5rem">{it.time}</Prim.Text> : null}</Prim.Text>{it.detail ? <Prim.Text color="var(--muted-foreground)" fontSize="11px">{it.detail}</Prim.Text> : null}</Prim.ListItem>)}</Prim.List>;
    }

    // ── indicators ──
    case 'progressbar': {
      const max = (props['max'] as number) ?? (Number(props['value']) <= 1 ? 1 : 100);
      const pct = Math.max(0, Math.min(100, (Number(props['value'] ?? 0) / max) * 100));
      return <Prim.Box key={key} marginVertical="0.25rem"><Prim.Box backgroundColor="var(--muted)" height="$2" borderRadius="$radius" overflow="hidden"><Prim.Box backgroundColor="var(--agent)" height="100%" width={`${pct}%`} /></Prim.Box>{props['label'] ? <Prim.Text color="var(--muted-foreground)" fontSize="10px" marginTop="0.125rem">{String(props['label'])}</Prim.Text> : null}</Prim.Box>;
    }
    // The Row's `color`/`fontSize` are container props an RN `View` drops — both the spinner glyph
    // and the label restate them, or they'd render at body size/ink on native.
    case 'spinner': return <Prim.Row key={key} color="var(--muted-foreground)" gap="$2" fontSize="12px" marginVertical="$1" alignItems="center"><Prim.Text className="lm-spin" color="var(--muted-foreground)" fontSize="12px">◐</Prim.Text>{props['label'] ? <Prim.Text color="var(--muted-foreground)" fontSize="12px">{String(props['label'])}</Prim.Text> : null}</Prim.Row>;
    case 'statcard': return <Prim.Box key={key} borderColor="var(--border)" backgroundColor="var(--accent)" borderWidth={1} borderRadius="$radius" padding="$2" display="inline-block" marginVertical="0.25rem"><Prim.Text color="var(--muted-foreground)" fontSize="10px" textTransform="uppercase">{String(props['label'] ?? '')}</Prim.Text><Prim.Text color="var(--foreground)" fontSize="$lg" fontWeight="$semibold">{String(props['value'] ?? '')}</Prim.Text>{props['delta'] ? <Prim.Text color="var(--success)" fontSize="11px">{String(props['delta'])}</Prim.Text> : null}</Prim.Box>;
    case 'details': return <Prim.Box as="details" key={key} borderColor="var(--border)" backgroundColor="var(--accent)" borderWidth={1} borderRadius="$radius" padding="$2" marginVertical="0.25rem"><Prim.Box as="summary" cursor="pointer"><Prim.Text color="var(--foreground)">{String(props['summary'] ?? 'Details')}</Prim.Text></Prim.Box><Prim.Box marginTop="0.25rem">{inView(body)}</Prim.Box></Prim.Box>;

    // A Fragment is not a container, so it cannot hold a bare string on native
    // either — whatever View it lands in still refuses one.
    case 'fragment': return <React.Fragment key={key}>{inView(body)}</React.Fragment>;
    // Only an allowed component reaches here — the guard above already turned
    // everything else away — so this is a catalog FORM control that the agent
    // put in a display() instead of an ask(). There is nothing to submit it to,
    // so show its content and never its props.
    default: return <React.Fragment key={key}>{inView(body)}</React.Fragment>;
  }
}

/**
 * The value a surface actually holds → something {@link renderDescriptor} can
 * draw. Between the sandbox and a reader a descriptor may be serialized to JSON
 * (a channel log line, a `result` flattened by an older writer); a string that
 * parses back to a descriptor is a descriptor, and rendering it as prose is the
 * bug this exists to stop. Returns `null` when the value is ordinary text the
 * caller should render as markdown.
 */
export function toRenderableDescriptor(value: unknown): unknown | null {
  if (typeof value === 'string') return parseDescriptorPayload(value);
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length ? value : null;
  return typeof value === 'object' ? value : null;
}
