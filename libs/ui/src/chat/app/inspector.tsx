import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { useStore, type InspectorTab } from '../store/store.js';
import type { ExecNode } from '../store/model.js';
import { Tabs, CodeBlock, StatusIcon, KindBadge, fmtDuration, Badge, preview } from './common.js';

const TABS: readonly InspectorTab[] = ['llm', 'statements', 'yields', 'variables', 'raw'];

function LlmTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.llmCalls.length === 0) return <Empty>No LLM calls.</Empty>;
  return (
    <Prim.Box className="space-y-3">
      {node.llmCalls.map((c, i) => (
        <Prim.Box key={i} className="border-lm-border" borderWidth={1} borderRadius="$radius">
          <Prim.Row className="bg-lm-panel2" gap="$2" paddingHorizontal="$2" paddingVertical="$1" color="11px" alignItems="center">
            <Prim.Text className="text-lm-muted" fontFamily="$mono">call {i}</Prim.Text>
            {c.model && <Badge>{c.model}</Badge>}
            {c.responses.length > 1 && <Badge tone="amber">×{c.responses.length} attempts</Badge>}
          </Prim.Row>
          <Prim.Box as="details" paddingHorizontal="$2" paddingVertical="$1">
            <Prim.Box as="summary" className="text-lm-muted" cursor="pointer" color="11px">system + {c.messages.length} messages</Prim.Box>
            <Prim.Pre className="font-mono text-[10px] whitespace-pre-wrap text-lm-muted mt-1 max-h-48 overflow-y-auto">{c.system}</Prim.Pre>
            {c.messages.map((m, j) => (
              <Prim.Box key={j} marginTop="0.25rem">
                <Prim.Text className="text-lm-accent" color="10px" textTransform="uppercase">{m.role}</Prim.Text>
                <Prim.Pre className="font-mono text-[10px] whitespace-pre-wrap text-lm-text">{preview(m.content, 1000)}</Prim.Pre>
              </Prim.Box>
            ))}
          </Prim.Box>
          {c.responses.map((r, j) => (
            <Prim.Box key={j} className="border-lm-border" paddingHorizontal="$2" paddingVertical="$1" borderTopWidth={1}>
              <Prim.Text className="text-lm-muted" color="10px" fontFamily="$mono">response (attempt {r.attempt})</Prim.Text>
              <CodeBlock code={r.text} />
            </Prim.Box>
          ))}
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}

function StatementsTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.statements.length === 0) return <Empty>No statements.</Empty>;
  return (
    <Prim.Box className="space-y-2">
      {node.statements.map((s, i) => (
        <Prim.Box key={i}>
          <CodeBlock code={s.code} />
          {s.errors.map((e, j) => (
            <Prim.Box key={j} className="text-lm-red" color="11px" fontFamily="$mono" paddingLeft="$2" marginTop="0.25rem">
              {e.phase} error{e.attempt ? ` (attempt ${e.attempt})` : ''}: {e.message}
            </Prim.Box>
          ))}
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}

function YieldsTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.yields.length === 0) return <Empty>No yields.</Empty>;
  return (
    <Prim.Box className="space-y-2">
      {node.yields.map((y, i) => (
        <Prim.Box key={i} className="border-lm-border" borderWidth={1} borderRadius="$radius" paddingHorizontal="$2" paddingVertical="$1">
          <Prim.Row gap="$2" color="11px" alignItems="center">
            <Prim.Text className={y.resolved ? 'text-lm-green' : 'text-lm-accent lm-spin'}>{y.resolved ? '✓' : '⟳'}</Prim.Text>
            <Prim.Text className="text-lm-cyan" fontFamily="$mono">{y.kind}</Prim.Text>
          </Prim.Row>
          <Prim.Box className="text-lm-muted" color="10px" fontFamily="$mono" marginTop="0.25rem">args: {preview(y.args, 300)}</Prim.Box>
          {y.resolved && <Prim.Box className="text-lm-text" color="10px" fontFamily="$mono" marginTop="0.25rem">→ {preview(y.value, 400)}</Prim.Box>}
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}

function VariablesTab({ node }: { node: ExecNode }): React.ReactElement {
  const entries = Object.entries(node.variables);
  if (entries.length === 0) return <Empty>No variables captured.</Empty>;
  return (
    <Prim.Box className="space-y-1" fontFamily="$mono" color="11px">
      {entries.map(([k, v]) => (
        <Prim.Box key={k} className="border-lm-border/50" borderBottomWidth={1} paddingVertical="$1">
          <Prim.Text className="text-lm-accent">{k}</Prim.Text>: <Prim.Text className="text-lm-green" wordWrap="break-word">{preview(v, 600)}</Prim.Text>
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}

function RawTab({ node }: { node: ExecNode }): React.ReactElement {
  const rawEvents = useStore((s) => s.model.rawEvents);
  const bySeq = React.useMemo(() => new Map(rawEvents.map((e) => [e.seq, e.event])), [rawEvents]);
  if (node.eventSeqs.length === 0) return <Empty>No events.</Empty>;
  return (
    <Prim.Box className="space-y-1">
      {node.eventSeqs.map((seq) => {
        const ev = bySeq.get(seq);
        if (!ev) return null;
        return <Prim.Pre key={seq} className="font-mono text-[10px] whitespace-pre-wrap text-lm-muted border-b border-lm-border/40 pb-1">[{seq}] {preview(ev, 500)}</Prim.Pre>;
      })}
    </Prim.Box>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Prim.Box className="text-lm-muted" color="12px" paddingVertical="$3">{children}</Prim.Box>;
}

export function Inspector(): React.ReactElement {
  useStore((s) => s.version);
  const id = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => (id ? s.model.nodes[id] : undefined));
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  if (!node) {
    return <Prim.Row as="aside" aria-label="inspector" className="text-lm-muted" height="100%" justifyContent="center" color="12px" alignItems="center">Select a node to inspect.</Prim.Row>;
  }

  return (
    <Prim.Col as="aside" aria-label="inspector" height="100%">
      <Prim.Box className="border-lm-border" paddingHorizontal="$3" paddingVertical="$2" borderBottomWidth={1}>
        <Prim.Row gap="$2" alignItems="center">
          <StatusIcon status={node.status} />
          <Prim.Text className="text-lm-text" fontFamily="$mono" color="12px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={node.label}>{node.label}</Prim.Text>
          <KindBadge kind={node.kind} />
          {node.durationMs !== undefined && <Prim.Text className="text-lm-muted" color="10px" fontFamily="$mono" marginLeft="auto">{fmtDuration(node.durationMs)}</Prim.Text>}
        </Prim.Row>
        <Prim.Box className="text-lm-muted" color="10px" fontFamily="$mono" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" marginTop="0.25rem" title={node.id}>{node.id}</Prim.Box>
        {node.detail && Object.keys(node.detail).length > 0 && (
          <Prim.Box className="text-lm-muted" color="10px" fontFamily="$mono" marginTop="0.25rem">{preview(node.detail, 200)}</Prim.Box>
        )}
        {node.error && <Prim.Box className="text-lm-red" color="11px" fontFamily="$mono" marginTop="0.25rem">{preview(node.error, 300)}</Prim.Box>}
        {node.result !== undefined && <Prim.Box className="text-lm-green" color="10px" fontFamily="$mono" marginTop="0.25rem">result: {preview(node.result, 200)}</Prim.Box>}
      </Prim.Box>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto" padding="$2">
        {tab === 'llm' && <LlmTab node={node} />}
        {tab === 'statements' && <StatementsTab node={node} />}
        {tab === 'yields' && <YieldsTab node={node} />}
        {tab === 'variables' && <VariablesTab node={node} />}
        {tab === 'raw' && <RawTab node={node} />}
      </Prim.Box>
    </Prim.Col>
  );
}
