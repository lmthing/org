import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { marked } from 'marked';
import { preview } from '../app/common.js';

export interface Descriptor { type: string; props?: Record<string, unknown>; children?: unknown[] }
export function isDescriptor(v: unknown): v is Descriptor {
  return !!v && typeof v === 'object' && 'type' in (v as object);
}

export function renderDescriptor(d: unknown, key?: React.Key): React.ReactNode {
  if (d === null || d === undefined) return null;
  if (typeof d === 'string' || typeof d === 'number') return d;
  if (Array.isArray(d)) return d.map((c, i) => renderDescriptor(c, i));
  if (!isDescriptor(d)) return <Prim.Text color="var(--lm-muted)" fontFamily="$mono">{preview(d, 400)}</Prim.Text>;

  const props = d.props ?? {};
  const kids = (d.children ?? []).map((c, i) => renderDescriptor(c, i));
  const text = props['text'] as string | undefined;
  const body = text !== undefined ? text : kids;
  const color = props['color'] as string | undefined;

  switch (d.type.toLowerCase()) {
    // ── headings + text ──
    case 'h1': case 'heading': {
      const level = (props['level'] as number) ?? 1;
      const cls = level >= 4 ? 'text-xs' : level === 3 ? 'text-sm' : level === 2 ? 'text-base' : 'text-lg';
      const Tag = (`h${Math.min(Math.max(level, 1), 4)}`) as 'h1';
      return <Tag key={key} className={`${cls} font-semibold text-lm-text my-1`}>{body}</Tag>;
    }
    case 'h2': return <Prim.Text as="h2" key={key} color="var(--lm-text)" fontSize="$base" fontWeight="$semibold" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'h3': return <Prim.Text as="h3" key={key} color="var(--lm-text)" fontSize="$sm" fontWeight="$semibold" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'p': case 'paragraph': return <Prim.Text as="p" key={key} color="var(--lm-text)" marginVertical="0.25rem">{body}</Prim.Text>;
    case 'text': return <Prim.Text key={key} style={color ? { color: `var(--lm-${color}, ${color})` } : undefined} {...(props['bold'] ? { fontWeight: '$semibold' } : {})} {...(props['dim'] ? { color: 'var(--lm-muted)' } : {})} {...(props['italic'] ? { fontStyle: 'italic' as const } : {})}>{body}</Prim.Text>;
    case 'strong': return <Prim.Text as="strong" key={key} fontWeight="$semibold">{body}</Prim.Text>;
    case 'em': return <Prim.Text as="em" key={key}>{body}</Prim.Text>;
    case 'muted': return <Prim.Text key={key} color="var(--lm-muted)">{body}</Prim.Text>;
    case 'kbd': return <Prim.Text as="kbd" key={key} borderColor="var(--lm-border)" backgroundColor="var(--lm-panel)" fontFamily="$mono" fontSize="11px" borderWidth={1} borderRadius="$radius" paddingHorizontal="$1">{body}</Prim.Text>;
    case 'code': return <Prim.Text as="code" key={key} color="var(--lm-cyan)" backgroundColor="var(--lm-bg)" fontFamily="$mono" paddingHorizontal="$1" borderRadius="$radius">{body}</Prim.Text>;
    case 'codeblock': return <Prim.Pre key={key} fontFamily="$mono" fontSize="12px" color="var(--lm-text)" backgroundColor="var(--lm-bg)" borderWidth={1} borderColor="var(--lm-border)" borderRadius="$radius" padding="$2" marginVertical="$1" overflowX="auto"><Prim.Text as="code">{body}</Prim.Text></Prim.Pre>;
    case 'markdown': {
      let markdown = text;
      if (!markdown && d.children && d.children.length > 0) {
        markdown = d.children.map(c => typeof c === 'string' ? c : '').join('');
      }
      markdown = markdown || '';
      const html = marked.parse(markdown) as string;
      return <Prim.Box key={key} className="prose prose-sm prose-headings:text-lm-text prose-a:text-lm-accent prose-code:text-lm-cyan prose-code:bg-lm-bg prose-pre:bg-lm-bg prose-pre:border prose-pre:border-lm-border" maxWidth="none" color="var(--lm-text)" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'span': return <Prim.Text key={key}>{body}</Prim.Text>;
    case 'quote': return <Prim.Box as="blockquote" key={key} borderColor="var(--lm-border)" color="var(--lm-muted)" borderLeftWidth={2} paddingLeft="$2" fontStyle="italic" marginVertical="0.25rem">{body}</Prim.Box>;
    case 'link': return <Prim.Link key={key} href={String(props['href'] ?? '#')} target="_blank" rel="noreferrer" color="var(--lm-accent)" textDecorationLine="underline">{body}</Prim.Link>;

    // ── media ──
    case 'image': case 'img': {
      const src = String(props['src'] ?? props['url'] ?? '');
      const alt = String(props['alt'] ?? props['caption'] ?? 'image');
      if (!src) return null;
      return <Prim.Image key={key} src={src} alt={alt} borderColor="var(--lm-border)" maxWidth="100%" maxHeight="360px" borderRadius="$radius-lg" borderWidth={1} marginVertical="$1" objectFit="contain" />;
    }
    case 'audio': {
      const src = String(props['src'] ?? props['url'] ?? '');
      if (!src) return null;
      // eslint-disable-next-line jsx-a11y/media-has-caption
      return <Prim.Audio key={key} controls src={src} className="my-1 max-w-full" />;
    }

    // ── layout ──
    case 'stack': return <Prim.Col key={key} marginVertical="$1" style={{ gap: ((props['gap'] as number) ?? 1) * 4 }}>{body}</Prim.Col>;
    case 'row': case 'inline': {
      const j = props['justify'] as string | undefined;
      const a = props['align'] as string | undefined;
      const jc = j === 'between' ? 'space-between' : j === 'center' ? 'center' : j === 'end' ? 'flex-end' : 'flex-start';
      const ai = a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start';
      return <Prim.Row key={key} marginVertical="$1" style={{ gap: ((props['gap'] as number) ?? 1) * 4, justifyContent: jc, alignItems: ai }}>{body}</Prim.Row>;
    }
    case 'columns': return <Prim.Box key={key} display="grid" marginVertical="0.25rem" style={{ gridTemplateColumns: `repeat(${(d.children ?? []).length || 1}, minmax(0,1fr))`, gap: ((props['gap'] as number) ?? 2) * 4 }}>{body}</Prim.Box>;
    case 'spacer': return <Prim.Box key={key} style={{ flexGrow: 1 }} />;
    case 'divider': return (
      <Prim.Row key={key} color="var(--lm-muted)" gap="$2" marginVertical="$2" fontSize="11px" alignItems="center">
        <Prim.Text borderColor="var(--lm-border)" flexGrow={1} flexShrink={1} flexBasis="0%" borderTopWidth={1} />{props['label'] ? <Prim.Text>{String(props['label'])}</Prim.Text> : null}<Prim.Text borderColor="var(--lm-border)" flexGrow={1} flexShrink={1} flexBasis="0%" borderTopWidth={1} />
      </Prim.Row>
    );

    // ── surfaces ──
    case 'card': case 'panel': return (
      <Prim.Box key={key} borderColor="var(--lm-border)" backgroundColor="var(--lm-panel2)" borderWidth={1} borderRadius="$radius" padding="$2" marginVertical="0.25rem">
        {props['title'] ? <Prim.Box color="var(--lm-text)" fontSize="$sm" fontWeight="$semibold" marginBottom="0.25rem">{String(props['title'])}</Prim.Box> : null}{body}
      </Prim.Box>
    );
    case 'callout': case 'alert': case 'banner': {
      const variant = props['variant'] as string | undefined;
      const tone = variant === 'error' ? 'red' : variant === 'success' ? 'green' : variant === 'warning' ? 'amber' : 'accent';
      return <Prim.Box key={key} marginVertical="0.25rem" borderLeftWidth={2} borderLeftColor={`var(--lm-${tone})`} color={`var(--lm-${tone})`} backgroundColor="var(--lm-panel2)" paddingHorizontal="$2" paddingVertical="$1" borderRadius="$radius">{props['title'] ? <Prim.Box fontWeight="$semibold">{String(props['title'])}</Prim.Box> : null}{body}</Prim.Box>;
    }
    case 'badge': case 'tag': case 'pill': {
      const tone = `var(--lm-${color ?? 'accent'})`;
      return <Prim.Text key={key} display="inline-block" borderRadius={d.type.toLowerCase() === 'pill' ? '$radius-full' : '$radius'} paddingHorizontal="$1.5" paddingVertical="$0.5" fontSize="10px" color={tone} backgroundColor={`color-mix(in srgb, ${tone} 20%, transparent)`}>{body}</Prim.Text>;
    }

    // ── collections ──
    case 'list': case 'orderedlist': {
      const ordered = d.type.toLowerCase() === 'orderedlist';
      const items = props['items'] as (string | number)[] | undefined;
      const lis = items ? items.map((it, i) => <Prim.ListItem key={i}>{String(it)}</Prim.ListItem>) : kids;
      return ordered
        ? <Prim.List ordered key={key} color="var(--lm-text)" marginLeft="1.25rem" marginVertical="0.25rem" style={{ listStyleType: 'decimal' }}>{lis}</Prim.List>
        : <Prim.List key={key} color="var(--lm-text)" marginLeft="1.25rem" marginVertical="0.25rem" style={{ listStyleType: 'disc' }}>{lis}</Prim.List>;
    }
    case 'listitem': return <Prim.ListItem key={key}>{body}</Prim.ListItem>;
    case 'table': {
      const columns = (props['columns'] as string[]) ?? [];
      const rows = (props['rows'] as (string | number)[][]) ?? [];
      return (
        <Prim.Table key={key} marginVertical="$1" fontSize="12px" borderColor="$collapse">
          {columns.length > 0 && <Prim.Thead><Prim.Tr>{columns.map((c, i) => <Prim.Th key={i} textAlign="left" fontWeight="$semibold" color="var(--lm-muted)" borderBottomWidth={1} borderColor="var(--lm-border)" paddingHorizontal="$2" paddingVertical="$1">{c}</Prim.Th>)}</Prim.Tr></Prim.Thead>}
          <Prim.Tbody>{rows.map((r, ri) => <Prim.Tr key={ri}>{r.map((cell, ci) => <Prim.Td key={ci} borderBottomWidth={1} borderColor="var(--lm-border)" paddingHorizontal="$2" paddingVertical="$1" color="var(--lm-text)">{String(cell)}</Prim.Td>)}</Prim.Tr>)}</Prim.Tbody>
        </Prim.Table>
      );
    }
    case 'keyvalue': {
      const pairs = (props['pairs'] as Record<string, unknown>) ?? {};
      return <Prim.Box as="dl" key={key} fontSize="12px" marginVertical="0.25rem">{Object.entries(pairs).map(([k, v]) => <Prim.Row key={k} gap="$2"><Prim.Text as="dt" color="var(--lm-muted)" minWidth="120px">{k}</Prim.Text><Prim.Text as="dd" color="var(--lm-text)">{String(v)}</Prim.Text></Prim.Row>)}</Prim.Box>;
    }
    case 'timeline': {
      const items = (props['items'] as { title: string; time?: string; detail?: string }[]) ?? [];
      return <Prim.List key={key} borderColor="var(--lm-border)" borderLeftWidth={1} paddingLeft="$3" marginVertical="0.25rem">{items.map((it, i) => <Prim.ListItem key={i} marginBottom="0.25rem"><Prim.Box color="var(--lm-text)">{it.title}{it.time ? <Prim.Text color="var(--lm-muted)" fontSize="10px" marginLeft="0.5rem">{it.time}</Prim.Text> : null}</Prim.Box>{it.detail ? <Prim.Box color="var(--lm-muted)" fontSize="11px">{it.detail}</Prim.Box> : null}</Prim.ListItem>)}</Prim.List>;
    }

    // ── indicators ──
    case 'progressbar': {
      const max = (props['max'] as number) ?? (Number(props['value']) <= 1 ? 1 : 100);
      const pct = Math.max(0, Math.min(100, (Number(props['value'] ?? 0) / max) * 100));
      return <Prim.Box key={key} marginVertical="0.25rem"><Prim.Box backgroundColor="var(--lm-panel)" height="$2" borderRadius="$radius" overflow="hidden"><Prim.Box backgroundColor="var(--lm-accent)" height="100%" style={{ width: `${pct}%` }} /></Prim.Box>{props['label'] ? <Prim.Box color="var(--lm-muted)" fontSize="10px" marginTop="0.125rem">{String(props['label'])}</Prim.Box> : null}</Prim.Box>;
    }
    case 'spinner': return <Prim.Row key={key} color="var(--lm-muted)" gap="$2" fontSize="12px" marginVertical="$1" alignItems="center"><Prim.Text className="lm-spin">◐</Prim.Text>{props['label'] ? String(props['label']) : null}</Prim.Row>;
    case 'statcard': return <Prim.Box key={key} borderColor="var(--lm-border)" backgroundColor="var(--lm-panel2)" borderWidth={1} borderRadius="$radius" padding="$2" display="inline-block" marginVertical="0.25rem"><Prim.Box color="var(--lm-muted)" fontSize="10px" textTransform="uppercase">{String(props['label'] ?? '')}</Prim.Box><Prim.Box color="var(--lm-text)" fontSize="$lg" fontWeight="$semibold">{String(props['value'] ?? '')}</Prim.Box>{props['delta'] ? <Prim.Box color="var(--lm-green)" fontSize="11px">{String(props['delta'])}</Prim.Box> : null}</Prim.Box>;
    case 'details': return <Prim.Box as="details" key={key} borderColor="var(--lm-border)" backgroundColor="var(--lm-panel2)" borderWidth={1} borderRadius="$radius" padding="$2" marginVertical="0.25rem"><Prim.Box as="summary" color="var(--lm-text)" cursor="pointer">{String(props['summary'] ?? 'Details')}</Prim.Box><Prim.Box marginTop="0.25rem">{body}</Prim.Box></Prim.Box>;

    case 'fragment': return <React.Fragment key={key}>{body}</React.Fragment>;
    default: return <Prim.Box key={key} color="var(--lm-muted)" fontFamily="$mono" fontSize="11px">{d.type}: {preview(props, 200)}</Prim.Box>;
  }
}
