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
  if (!isDescriptor(d)) return <Prim.Text className="font-mono text-lm-muted">{preview(d, 400)}</Prim.Text>;

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
    case 'h2': return <Prim.Text as="h2" key={key} className="text-base font-semibold text-lm-text my-1">{body}</Prim.Text>;
    case 'h3': return <Prim.Text as="h3" key={key} className="text-sm font-semibold text-lm-text my-1">{body}</Prim.Text>;
    case 'p': case 'paragraph': return <Prim.Text as="p" key={key} className="my-1 text-lm-text">{body}</Prim.Text>;
    case 'text': return <Prim.Text key={key} style={color ? { color: `var(--lm-${color}, ${color})` } : undefined} className={`${props['bold'] ? 'font-semibold' : ''} ${props['dim'] ? 'text-lm-muted' : ''} ${props['italic'] ? 'italic' : ''}`}>{body}</Prim.Text>;
    case 'strong': return <Prim.Text as="strong" key={key} className="font-semibold">{body}</Prim.Text>;
    case 'em': return <Prim.Text as="em" key={key}>{body}</Prim.Text>;
    case 'muted': return <Prim.Text key={key} className="text-lm-muted">{body}</Prim.Text>;
    case 'kbd': return <Prim.Text as="kbd" key={key} className="font-mono text-[11px] border border-lm-border rounded px-1 bg-lm-panel">{body}</Prim.Text>;
    case 'code': return <Prim.Text as="code" key={key} className="font-mono text-lm-cyan bg-lm-bg px-1 rounded">{body}</Prim.Text>;
    case 'codeblock': return <Prim.Pre key={key} className="font-mono text-[12px] text-lm-text bg-lm-bg border border-lm-border rounded p-2 my-1 overflow-x-auto"><Prim.Text as="code">{body}</Prim.Text></Prim.Pre>;
    case 'markdown': {
      let markdown = text;
      if (!markdown && d.children && d.children.length > 0) {
        markdown = d.children.map(c => typeof c === 'string' ? c : '').join('');
      }
      markdown = markdown || '';
      const html = marked.parse(markdown) as string;
      return <Prim.Box key={key} className="prose prose-sm max-w-none text-lm-text prose-headings:text-lm-text prose-a:text-lm-accent prose-code:text-lm-cyan prose-code:bg-lm-bg prose-pre:bg-lm-bg prose-pre:border prose-pre:border-lm-border" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'span': return <Prim.Text key={key}>{body}</Prim.Text>;
    case 'quote': return <Prim.Box as="blockquote" key={key} className="border-l-2 border-lm-border pl-2 my-1 text-lm-muted italic">{body}</Prim.Box>;
    case 'link': return <Prim.Link key={key} href={String(props['href'] ?? '#')} target="_blank" rel="noreferrer" className="text-lm-accent underline">{body}</Prim.Link>;

    // ── media ──
    case 'image': case 'img': {
      const src = String(props['src'] ?? props['url'] ?? '');
      const alt = String(props['alt'] ?? props['caption'] ?? 'image');
      if (!src) return null;
      return <Prim.Image key={key} src={src} alt={alt} className="max-w-full max-h-[360px] rounded-lg border border-lm-border my-1 object-contain" />;
    }
    case 'audio': {
      const src = String(props['src'] ?? props['url'] ?? '');
      if (!src) return null;
      // eslint-disable-next-line jsx-a11y/media-has-caption
      return <Prim.Audio key={key} controls src={src} className="my-1 max-w-full" />;
    }

    // ── layout ──
    case 'stack': return <Prim.Box key={key} className="flex flex-col my-1" style={{ gap: ((props['gap'] as number) ?? 1) * 4 }}>{body}</Prim.Box>;
    case 'row': case 'inline': {
      const j = props['justify'] as string | undefined;
      const a = props['align'] as string | undefined;
      const jc = j === 'between' ? 'space-between' : j === 'center' ? 'center' : j === 'end' ? 'flex-end' : 'flex-start';
      const ai = a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start';
      return <Prim.Box key={key} className="flex flex-row my-1" style={{ gap: ((props['gap'] as number) ?? 1) * 4, justifyContent: jc, alignItems: ai }}>{body}</Prim.Box>;
    }
    case 'columns': return <Prim.Box key={key} className="grid my-1" style={{ gridTemplateColumns: `repeat(${(d.children ?? []).length || 1}, minmax(0,1fr))`, gap: ((props['gap'] as number) ?? 2) * 4 }}>{body}</Prim.Box>;
    case 'spacer': return <Prim.Box key={key} style={{ flexGrow: 1 }} />;
    case 'divider': return (
      <Prim.Box key={key} className="flex items-center gap-2 my-2 text-lm-muted text-[11px]">
        <Prim.Text className="flex-1 border-t border-lm-border" />{props['label'] ? <Prim.Text>{String(props['label'])}</Prim.Text> : null}<Prim.Text className="flex-1 border-t border-lm-border" />
      </Prim.Box>
    );

    // ── surfaces ──
    case 'card': case 'panel': return (
      <Prim.Box key={key} className="border border-lm-border rounded p-2 my-1 bg-lm-panel2">
        {props['title'] ? <Prim.Box className="text-sm font-semibold text-lm-text mb-1">{String(props['title'])}</Prim.Box> : null}{body}
      </Prim.Box>
    );
    case 'callout': case 'alert': case 'banner': {
      const variant = props['variant'] as string | undefined;
      const c = variant === 'error' ? 'border-lm-red text-lm-red' : variant === 'success' ? 'border-lm-green text-lm-green' : variant === 'warning' ? 'border-lm-amber text-lm-amber' : 'border-lm-accent text-lm-accent';
      return <Prim.Box key={key} className={`border-l-2 ${c} bg-lm-panel2 px-2 py-1 my-1 rounded`}>{props['title'] ? <Prim.Box className="font-semibold">{String(props['title'])}</Prim.Box> : null}{body}</Prim.Box>;
    }
    case 'badge': case 'tag': case 'pill': {
      const rounded = d.type.toLowerCase() === 'pill' ? 'rounded-full' : 'rounded';
      const cv = color ? `bg-[var(--lm-${color})]/20 text-[var(--lm-${color})]` : 'bg-lm-accent/20 text-lm-accent';
      return <Prim.Text key={key} className={`inline-block ${rounded} px-1.5 py-0.5 text-[10px] ${cv}`}>{body}</Prim.Text>;
    }

    // ── collections ──
    case 'list': case 'orderedlist': {
      const ordered = d.type.toLowerCase() === 'orderedlist';
      const items = props['items'] as (string | number)[] | undefined;
      const lis = items ? items.map((it, i) => <Prim.ListItem key={i}>{String(it)}</Prim.ListItem>) : kids;
      return ordered
        ? <Prim.List ordered key={key} className="list-decimal ml-5 my-1 text-lm-text">{lis}</Prim.List>
        : <Prim.List key={key} className="list-disc ml-5 my-1 text-lm-text">{lis}</Prim.List>;
    }
    case 'listitem': return <Prim.ListItem key={key}>{body}</Prim.ListItem>;
    case 'table': {
      const columns = (props['columns'] as string[]) ?? [];
      const rows = (props['rows'] as (string | number)[][]) ?? [];
      return (
        <Prim.Table key={key} className="my-1 text-[12px] border-collapse">
          {columns.length > 0 && <Prim.Thead><Prim.Tr>{columns.map((c, i) => <Prim.Th key={i} className="text-left font-semibold text-lm-muted border-b border-lm-border px-2 py-1">{c}</Prim.Th>)}</Prim.Tr></Prim.Thead>}
          <Prim.Tbody>{rows.map((r, ri) => <Prim.Tr key={ri}>{r.map((cell, ci) => <Prim.Td key={ci} className="border-b border-lm-border px-2 py-1 text-lm-text">{String(cell)}</Prim.Td>)}</Prim.Tr>)}</Prim.Tbody>
        </Prim.Table>
      );
    }
    case 'keyvalue': {
      const pairs = (props['pairs'] as Record<string, unknown>) ?? {};
      return <Prim.Box as="dl" key={key} className="my-1 text-[12px]">{Object.entries(pairs).map(([k, v]) => <Prim.Box key={k} className="flex gap-2"><Prim.Text as="dt" className="text-lm-muted min-w-[120px]">{k}</Prim.Text><Prim.Text as="dd" className="text-lm-text">{String(v)}</Prim.Text></Prim.Box>)}</Prim.Box>;
    }
    case 'timeline': {
      const items = (props['items'] as { title: string; time?: string; detail?: string }[]) ?? [];
      return <Prim.List key={key} className="my-1 border-l border-lm-border pl-3">{items.map((it, i) => <Prim.ListItem key={i} className="mb-1"><Prim.Box className="text-lm-text">{it.title}{it.time ? <Prim.Text className="text-lm-muted text-[10px] ml-2">{it.time}</Prim.Text> : null}</Prim.Box>{it.detail ? <Prim.Box className="text-lm-muted text-[11px]">{it.detail}</Prim.Box> : null}</Prim.ListItem>)}</Prim.List>;
    }

    // ── indicators ──
    case 'progressbar': {
      const max = (props['max'] as number) ?? (Number(props['value']) <= 1 ? 1 : 100);
      const pct = Math.max(0, Math.min(100, (Number(props['value'] ?? 0) / max) * 100));
      return <Prim.Box key={key} className="my-1"><Prim.Box className="h-2 bg-lm-panel rounded overflow-hidden"><Prim.Box className="h-full bg-lm-accent" style={{ width: `${pct}%` }} /></Prim.Box>{props['label'] ? <Prim.Box className="text-[10px] text-lm-muted mt-0.5">{String(props['label'])}</Prim.Box> : null}</Prim.Box>;
    }
    case 'spinner': return <Prim.Box key={key} className="flex items-center gap-2 text-lm-muted text-[12px] my-1"><Prim.Text className="lm-spin">◐</Prim.Text>{props['label'] ? String(props['label']) : null}</Prim.Box>;
    case 'statcard': return <Prim.Box key={key} className="inline-block border border-lm-border rounded p-2 my-1 bg-lm-panel2"><Prim.Box className="text-[10px] text-lm-muted uppercase">{String(props['label'] ?? '')}</Prim.Box><Prim.Box className="text-lg font-semibold text-lm-text">{String(props['value'] ?? '')}</Prim.Box>{props['delta'] ? <Prim.Box className="text-[11px] text-lm-green">{String(props['delta'])}</Prim.Box> : null}</Prim.Box>;
    case 'details': return <Prim.Box as="details" key={key} className="my-1 border border-lm-border rounded p-2 bg-lm-panel2"><Prim.Box as="summary" className="cursor-pointer text-lm-text">{String(props['summary'] ?? 'Details')}</Prim.Box><Prim.Box className="mt-1">{body}</Prim.Box></Prim.Box>;

    case 'fragment': return <React.Fragment key={key}>{body}</React.Fragment>;
    default: return <Prim.Box key={key} className="font-mono text-[11px] text-lm-muted">{d.type}: {preview(props, 200)}</Prim.Box>;
  }
}
