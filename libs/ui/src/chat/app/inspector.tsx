import React from 'react';
import { useStore, type InspectorTab } from '../store/store.js';
import type { ExecNode } from '../store/model.js';
import { Tabs, CodeBlock, StatusIcon, KindBadge, fmtDuration, Badge, preview } from './common.js';

const TABS: readonly InspectorTab[] = ['llm', 'statements', 'yields', 'variables', 'raw'];

function LlmTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.llmCalls.length === 0) return <Empty>No LLM calls.</Empty>;
  return (
    <div className="space-y-3">
      {node.llmCalls.map((c, i) => (
        <div key={i} className="border border-lm-border rounded">
          <div className="flex items-center gap-2 px-2 py-1 bg-lm-panel2 text-[11px]">
            <span className="font-mono text-lm-muted">call {i}</span>
            {c.model && <Badge>{c.model}</Badge>}
            {c.responses.length > 1 && <Badge tone="amber">×{c.responses.length} attempts</Badge>}
          </div>
          <details className="px-2 py-1">
            <summary className="cursor-pointer text-[11px] text-lm-muted">system + {c.messages.length} messages</summary>
            <pre className="font-mono text-[10px] whitespace-pre-wrap text-lm-muted mt-1 max-h-48 overflow-y-auto">{c.system}</pre>
            {c.messages.map((m, j) => (
              <div key={j} className="mt-1">
                <span className="text-[10px] uppercase text-lm-accent">{m.role}</span>
                <pre className="font-mono text-[10px] whitespace-pre-wrap text-lm-text">{preview(m.content, 1000)}</pre>
              </div>
            ))}
          </details>
          {c.responses.map((r, j) => (
            <div key={j} className="px-2 py-1 border-t border-lm-border">
              <span className="text-[10px] text-lm-muted font-mono">response (attempt {r.attempt})</span>
              <CodeBlock code={r.text} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function StatementsTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.statements.length === 0) return <Empty>No statements.</Empty>;
  return (
    <div className="space-y-2">
      {node.statements.map((s, i) => (
        <div key={i}>
          <CodeBlock code={s.code} />
          {s.errors.map((e, j) => (
            <div key={j} className="text-[11px] text-lm-red font-mono mt-1 pl-2">
              {e.phase} error{e.attempt ? ` (attempt ${e.attempt})` : ''}: {e.message}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function YieldsTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.yields.length === 0) return <Empty>No yields.</Empty>;
  return (
    <div className="space-y-2">
      {node.yields.map((y, i) => (
        <div key={i} className="border border-lm-border rounded px-2 py-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className={y.resolved ? 'text-lm-green' : 'text-lm-accent lm-spin'}>{y.resolved ? '✓' : '⟳'}</span>
            <span className="font-mono text-lm-cyan">{y.kind}</span>
          </div>
          <div className="text-[10px] text-lm-muted font-mono mt-1">args: {preview(y.args, 300)}</div>
          {y.resolved && <div className="text-[10px] text-lm-text font-mono mt-1">→ {preview(y.value, 400)}</div>}
        </div>
      ))}
    </div>
  );
}

function VariablesTab({ node }: { node: ExecNode }): React.ReactElement {
  const entries = Object.entries(node.variables);
  if (entries.length === 0) return <Empty>No variables captured.</Empty>;
  return (
    <div className="space-y-1 font-mono text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="border-b border-lm-border/50 py-1">
          <span className="text-lm-accent">{k}</span>: <span className="text-lm-green break-words">{preview(v, 600)}</span>
        </div>
      ))}
    </div>
  );
}

function RawTab({ node }: { node: ExecNode }): React.ReactElement {
  const rawEvents = useStore((s) => s.model.rawEvents);
  const bySeq = React.useMemo(() => new Map(rawEvents.map((e) => [e.seq, e.event])), [rawEvents]);
  if (node.eventSeqs.length === 0) return <Empty>No events.</Empty>;
  return (
    <div className="space-y-1">
      {node.eventSeqs.map((seq) => {
        const ev = bySeq.get(seq);
        if (!ev) return null;
        return <pre key={seq} className="font-mono text-[10px] whitespace-pre-wrap text-lm-muted border-b border-lm-border/40 pb-1">[{seq}] {preview(ev, 500)}</pre>;
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="text-lm-muted text-[12px] py-3">{children}</div>;
}

export function Inspector(): React.ReactElement {
  useStore((s) => s.version);
  const id = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => (id ? s.model.nodes[id] : undefined));
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  if (!node) {
    return <aside aria-label="inspector" className="h-full flex items-center justify-center text-lm-muted text-[12px]">Select a node to inspect.</aside>;
  }

  return (
    <aside aria-label="inspector" className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-lm-border">
        <div className="flex items-center gap-2">
          <StatusIcon status={node.status} />
          <span className="font-mono text-[12px] text-lm-text truncate" title={node.label}>{node.label}</span>
          <KindBadge kind={node.kind} />
          {node.durationMs !== undefined && <span className="ml-auto text-[10px] text-lm-muted font-mono">{fmtDuration(node.durationMs)}</span>}
        </div>
        <div className="text-[10px] text-lm-muted font-mono mt-1 truncate" title={node.id}>{node.id}</div>
        {node.detail && Object.keys(node.detail).length > 0 && (
          <div className="text-[10px] text-lm-muted font-mono mt-1">{preview(node.detail, 200)}</div>
        )}
        {node.error && <div className="text-[11px] text-lm-red font-mono mt-1">{preview(node.error, 300)}</div>}
        {node.result !== undefined && <div className="text-[10px] text-lm-green font-mono mt-1">result: {preview(node.result, 200)}</div>}
      </div>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'llm' && <LlmTab node={node} />}
        {tab === 'statements' && <StatementsTab node={node} />}
        {tab === 'yields' && <YieldsTab node={node} />}
        {tab === 'variables' && <VariablesTab node={node} />}
        {tab === 'raw' && <RawTab node={node} />}
      </div>
    </aside>
  );
}
