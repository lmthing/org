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
  if (!isDescriptor(d)) return <span className="font-mono text-lm-muted">{preview(d, 400)}</span>;

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
    case 'h2': return <h2 key={key} className="text-base font-semibold text-lm-text my-1">{body}</h2>;
    case 'h3': return <h3 key={key} className="text-sm font-semibold text-lm-text my-1">{body}</h3>;
    case 'p': case 'paragraph': return <p key={key} className="my-1 text-lm-text">{body}</p>;
    case 'text': return <span key={key} style={color ? { color: `var(--lm-${color}, ${color})` } : undefined} className={`${props['bold'] ? 'font-semibold' : ''} ${props['dim'] ? 'text-lm-muted' : ''} ${props['italic'] ? 'italic' : ''}`}>{body}</span>;
    case 'strong': return <strong key={key} className="font-semibold">{body}</strong>;
    case 'em': return <em key={key}>{body}</em>;
    case 'muted': return <span key={key} className="text-lm-muted">{body}</span>;
    case 'kbd': return <kbd key={key} className="font-mono text-[11px] border border-lm-border rounded px-1 bg-lm-panel">{body}</kbd>;
    case 'code': return <code key={key} className="font-mono text-lm-cyan bg-lm-bg px-1 rounded">{body}</code>;
    case 'codeblock': return <pre key={key} className="font-mono text-[12px] text-lm-text bg-lm-bg border border-lm-border rounded p-2 my-1 overflow-x-auto"><code>{body}</code></pre>;
    case 'markdown': {
      let markdown = text;
      if (!markdown && d.children && d.children.length > 0) {
        markdown = d.children.map(c => typeof c === 'string' ? c : '').join('');
      }
      markdown = markdown || '';
      const html = marked.parse(markdown) as string;
      return <div key={key} className="prose prose-sm max-w-none text-lm-text prose-headings:text-lm-text prose-a:text-lm-accent prose-code:text-lm-cyan prose-code:bg-lm-bg prose-pre:bg-lm-bg prose-pre:border prose-pre:border-lm-border" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'span': return <span key={key}>{body}</span>;
    case 'quote': return <blockquote key={key} className="border-l-2 border-lm-border pl-2 my-1 text-lm-muted italic">{body}</blockquote>;
    case 'link': return <a key={key} href={String(props['href'] ?? '#')} target="_blank" rel="noreferrer" className="text-lm-accent underline">{body}</a>;

    // ── layout ──
    case 'stack': return <div key={key} className="flex flex-col my-1" style={{ gap: ((props['gap'] as number) ?? 1) * 4 }}>{body}</div>;
    case 'row': case 'inline': {
      const j = props['justify'] as string | undefined;
      const a = props['align'] as string | undefined;
      const jc = j === 'between' ? 'space-between' : j === 'center' ? 'center' : j === 'end' ? 'flex-end' : 'flex-start';
      const ai = a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start';
      return <div key={key} className="flex flex-row my-1" style={{ gap: ((props['gap'] as number) ?? 1) * 4, justifyContent: jc, alignItems: ai }}>{body}</div>;
    }
    case 'columns': return <div key={key} className="grid my-1" style={{ gridTemplateColumns: `repeat(${(d.children ?? []).length || 1}, minmax(0,1fr))`, gap: ((props['gap'] as number) ?? 2) * 4 }}>{body}</div>;
    case 'spacer': return <div key={key} style={{ flexGrow: 1 }} />;
    case 'divider': return (
      <div key={key} className="flex items-center gap-2 my-2 text-lm-muted text-[11px]">
        <span className="flex-1 border-t border-lm-border" />{props['label'] ? <span>{String(props['label'])}</span> : null}<span className="flex-1 border-t border-lm-border" />
      </div>
    );

    // ── surfaces ──
    case 'card': case 'panel': return (
      <div key={key} className="border border-lm-border rounded p-2 my-1 bg-lm-panel2">
        {props['title'] ? <div className="text-sm font-semibold text-lm-text mb-1">{String(props['title'])}</div> : null}{body}
      </div>
    );
    case 'callout': case 'alert': case 'banner': {
      const variant = props['variant'] as string | undefined;
      const c = variant === 'error' ? 'border-lm-red text-lm-red' : variant === 'success' ? 'border-lm-green text-lm-green' : variant === 'warning' ? 'border-lm-amber text-lm-amber' : 'border-lm-accent text-lm-accent';
      return <div key={key} className={`border-l-2 ${c} bg-lm-panel2 px-2 py-1 my-1 rounded`}>{props['title'] ? <div className="font-semibold">{String(props['title'])}</div> : null}{body}</div>;
    }
    case 'badge': case 'tag': case 'pill': {
      const rounded = d.type.toLowerCase() === 'pill' ? 'rounded-full' : 'rounded';
      const cv = color ? `bg-[var(--lm-${color})]/20 text-[var(--lm-${color})]` : 'bg-lm-accent/20 text-lm-accent';
      return <span key={key} className={`inline-block ${rounded} px-1.5 py-0.5 text-[10px] ${cv}`}>{body}</span>;
    }

    // ── collections ──
    case 'list': case 'orderedlist': {
      const ordered = d.type.toLowerCase() === 'orderedlist';
      const items = props['items'] as (string | number)[] | undefined;
      const lis = items ? items.map((it, i) => <li key={i}>{String(it)}</li>) : kids;
      return ordered
        ? <ol key={key} className="list-decimal ml-5 my-1 text-lm-text">{lis}</ol>
        : <ul key={key} className="list-disc ml-5 my-1 text-lm-text">{lis}</ul>;
    }
    case 'listitem': return <li key={key}>{body}</li>;
    case 'table': {
      const columns = (props['columns'] as string[]) ?? [];
      const rows = (props['rows'] as (string | number)[][]) ?? [];
      return (
        <table key={key} className="my-1 text-[12px] border-collapse">
          {columns.length > 0 && <thead><tr>{columns.map((c, i) => <th key={i} className="text-left font-semibold text-lm-muted border-b border-lm-border px-2 py-1">{c}</th>)}</tr></thead>}
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci} className="border-b border-lm-border px-2 py-1 text-lm-text">{String(cell)}</td>)}</tr>)}</tbody>
        </table>
      );
    }
    case 'keyvalue': {
      const pairs = (props['pairs'] as Record<string, unknown>) ?? {};
      return <dl key={key} className="my-1 text-[12px]">{Object.entries(pairs).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-lm-muted min-w-[120px]">{k}</dt><dd className="text-lm-text">{String(v)}</dd></div>)}</dl>;
    }
    case 'timeline': {
      const items = (props['items'] as { title: string; time?: string; detail?: string }[]) ?? [];
      return <ul key={key} className="my-1 border-l border-lm-border pl-3">{items.map((it, i) => <li key={i} className="mb-1"><div className="text-lm-text">{it.title}{it.time ? <span className="text-lm-muted text-[10px] ml-2">{it.time}</span> : null}</div>{it.detail ? <div className="text-lm-muted text-[11px]">{it.detail}</div> : null}</li>)}</ul>;
    }

    // ── indicators ──
    case 'progressbar': {
      const max = (props['max'] as number) ?? (Number(props['value']) <= 1 ? 1 : 100);
      const pct = Math.max(0, Math.min(100, (Number(props['value'] ?? 0) / max) * 100));
      return <div key={key} className="my-1"><div className="h-2 bg-lm-panel rounded overflow-hidden"><div className="h-full bg-lm-accent" style={{ width: `${pct}%` }} /></div>{props['label'] ? <div className="text-[10px] text-lm-muted mt-0.5">{String(props['label'])}</div> : null}</div>;
    }
    case 'spinner': return <div key={key} className="flex items-center gap-2 text-lm-muted text-[12px] my-1"><span className="lm-spin">◐</span>{props['label'] ? String(props['label']) : null}</div>;
    case 'statcard': return <div key={key} className="inline-block border border-lm-border rounded p-2 my-1 bg-lm-panel2"><div className="text-[10px] text-lm-muted uppercase">{String(props['label'] ?? '')}</div><div className="text-lg font-semibold text-lm-text">{String(props['value'] ?? '')}</div>{props['delta'] ? <div className="text-[11px] text-lm-green">{String(props['delta'])}</div> : null}</div>;
    case 'details': return <details key={key} className="my-1 border border-lm-border rounded p-2 bg-lm-panel2"><summary className="cursor-pointer text-lm-text">{String(props['summary'] ?? 'Details')}</summary><div className="mt-1">{body}</div></details>;

    case 'fragment': return <React.Fragment key={key}>{body}</React.Fragment>;
    default: return <div key={key} className="font-mono text-[11px] text-lm-muted">{d.type}: {preview(props, 200)}</div>;
  }
}
