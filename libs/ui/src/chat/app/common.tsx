import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import type { NodeStatus, NodeKind } from '../store/model.js';

export const STATUS_GLYPH: Record<NodeStatus, string> = {
  queued: '○',
  running: '⟳',
  done: '✓',
  error: '✗',
  skipped: '⊘',
};

const STATUS_COLOR: Record<NodeStatus, string> = {
  queued: 'text-lm-muted',
  running: 'text-lm-accent',
  done: 'text-lm-green',
  error: 'text-lm-red',
  skipped: 'text-lm-muted',
};

const KIND_COLOR: Record<NodeKind, string> = {
  session: 'text-lm-text',
  run: 'text-lm-muted',
  fork: 'text-lm-cyan',
  delegate: 'text-lm-purple',
  tasklist: 'text-lm-amber',
  task: 'text-lm-amber',
};

export function StatusIcon({ status }: { status: NodeStatus }): React.ReactElement {
  const cls = STATUS_COLOR[status];
  const glyph = STATUS_GLYPH[status];
  return (
    <Prim.Text className={`${cls} ${status === 'running' ? 'lm-spin' : ''}`} aria-label={status} data-status={status}>
      {glyph}
    </Prim.Text>
  );
}

export function KindBadge({ kind }: { kind: NodeKind }): React.ReactElement {
  return <Prim.Text className={`${KIND_COLOR[kind]} font-mono text-[10px] uppercase tracking-wide`}>{kind}</Prim.Text>;
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'amber' | 'red' }): React.ReactElement {
  const cls = tone === 'amber' ? 'text-lm-amber border-lm-amber/40' : tone === 'red' ? 'text-lm-red border-lm-red/40' : 'text-lm-muted border-lm-border';
  return (
    <Prim.Text className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono border ${cls}`}>
      {children}
    </Prim.Text>
  );
}

export function fmtDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CodeBlock({ code }: { code: string }): React.ReactElement {
  return (
    <Prim.Pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words bg-lm-bg border border-lm-border rounded p-2 overflow-x-auto text-lm-text">
      {code}
    </Prim.Pre>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }): React.ReactElement {
  return (
    <Prim.Box className="flex gap-1 border-b border-lm-border" role="tablist">
      {tabs.map((t) => (
        <Prim.Pressable
          key={t}
          role="tab"
          aria-selected={active === t}
          data-testid={`inspector-tab-${t}`}
          onClick={() => onChange(t)}
          className={`px-3 py-1.5 text-[11px] font-mono capitalize border-b-2 -mb-px transition-colors ${
            active === t ? 'border-lm-accent text-lm-text' : 'border-transparent text-lm-muted hover:text-lm-text'
          }`}
        >
          {t}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  );
}

export function preview(v: unknown, max = 200): string {
  let s: string;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max) + `… (${s.length})` : s;
}
