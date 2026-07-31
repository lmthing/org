import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore, type InspectorTab } from '../store/store';
import type { ExecNode } from '../store/model';
import { Tabs, CodeBlock, StatusIcon, KindBadge, fmtDuration, Badge, preview } from './common';

const TABS: readonly InspectorTab[] = ['llm', 'statements', 'yields', 'variables', 'raw'];

function LlmTab({ node }: { node: ExecNode }): React.ReactElement {
  if (node.llmCalls.length === 0) return <Empty>No LLM calls.</Empty>;
  return (
    <Prim.Box display="flex" flexDirection="column" gap="$3">
      {node.llmCalls.map((c, i) => (
        <Prim.Box key={i} borderColor="var(--border)" borderWidth={1} borderRadius="$radius">
          <Prim.Row backgroundColor="var(--accent)" gap="$2" paddingHorizontal="$2" paddingVertical="$1" fontSize="11px" alignItems="center">
            <Prim.Text color="var(--muted-foreground)" fontFamily="$mono">call {i}</Prim.Text>
            {c.model && <Badge>{c.model}</Badge>}
            {c.responses.length > 1 && <Badge tone="amber">×{c.responses.length} attempts</Badge>}
          </Prim.Row>
          <Prim.Box as="details" paddingHorizontal="$2" paddingVertical="$1">
            <Prim.Box as="summary" color="var(--muted-foreground)" cursor="pointer" fontSize="11px">system + {c.messages.length} messages</Prim.Box>
            <Prim.Pre fontFamily="$mono" fontSize="10px" whiteSpace="pre-wrap" color="var(--muted-foreground)" marginTop="$1" maxHeight="$48" overflowY="auto">{c.system}</Prim.Pre>
            {c.messages.map((m, j) => (
              <Prim.Box key={j} marginTop="0.25rem">
                <Prim.Text color="var(--agent)" fontSize="10px" textTransform="uppercase">{m.role}</Prim.Text>
                <Prim.Pre fontFamily="$mono" fontSize="10px" whiteSpace="pre-wrap" color="var(--foreground)">{preview(m.content, 1000)}</Prim.Pre>
              </Prim.Box>
            ))}
          </Prim.Box>
          {c.responses.map((r, j) => (
            <Prim.Box key={j} borderColor="var(--border)" paddingHorizontal="$2" paddingVertical="$1" borderTopWidth={1}>
              <Prim.Text color="var(--muted-foreground)" fontSize="10px" fontFamily="$mono">response (attempt {r.attempt})</Prim.Text>
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
    <Prim.Box display="flex" flexDirection="column" gap="$2">
      {node.statements.map((s, i) => (
        <Prim.Box key={i}>
          <CodeBlock code={s.code} />
          {s.errors.map((e, j) => (
            <Prim.Box key={j} color="var(--destructive)" fontSize="11px" fontFamily="$mono" paddingLeft="$2" marginTop="0.25rem">
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
    <Prim.Box display="flex" flexDirection="column" gap="$2">
      {node.yields.map((y, i) => (
        <Prim.Box key={i} borderColor="var(--border)" borderWidth={1} borderRadius="$radius" paddingHorizontal="$2" paddingVertical="$1">
          <Prim.Row gap="$2" fontSize="11px" alignItems="center">
            {/* `lm-spin` is a KEYFRAME animation — not the driver's job; a hand-written class (§5). */}
            <Prim.Text
              color={y.resolved ? 'var(--success)' : 'var(--agent)'}
              className={y.resolved ? undefined : 'lm-spin'}
            >{y.resolved ? '✓' : '⟳'}</Prim.Text>
            <Prim.Text color="var(--knowledge)" fontFamily="$mono">{y.kind}</Prim.Text>
          </Prim.Row>
          <Prim.Box color="var(--muted-foreground)" fontSize="10px" fontFamily="$mono" marginTop="0.25rem">args: {preview(y.args, 300)}</Prim.Box>
          {y.resolved && <Prim.Box color="var(--foreground)" fontSize="10px" fontFamily="$mono" marginTop="0.25rem">→ {preview(y.value, 400)}</Prim.Box>}
        </Prim.Box>
      ))}
    </Prim.Box>
  );
}

function VariablesTab({ node }: { node: ExecNode }): React.ReactElement {
  const entries = Object.entries(node.variables);
  if (entries.length === 0) return <Empty>No variables captured.</Empty>;
  return (
    <Prim.Box display="flex" flexDirection="column" gap="$1" fontFamily="$mono" fontSize="11px">
      {entries.map(([k, v]) => (
        <Prim.Box key={k} borderColor="color-mix(in srgb, var(--border) 50%, transparent)" borderBottomWidth={1} paddingVertical="$1">
          <Prim.Text color="var(--agent)">{k}</Prim.Text>: <Prim.Text color="var(--success)" wordWrap="break-word">{preview(v, 600)}</Prim.Text>
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
    <Prim.Box display="flex" flexDirection="column" gap="$1">
      {node.eventSeqs.map((seq) => {
        const ev = bySeq.get(seq);
        if (!ev) return null;
        return <Prim.Pre key={seq} fontFamily="$mono" fontSize="10px" whiteSpace="pre-wrap" color="var(--muted-foreground)" borderBottomWidth={1} borderColor="color-mix(in srgb, var(--border) 40%, transparent)" paddingBottom="$1">[{seq}] {preview(ev, 500)}</Prim.Pre>;
      })}
    </Prim.Box>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Prim.Box color="var(--muted-foreground)" fontSize="12px" paddingVertical="$3">{children}</Prim.Box>;
}

export function Inspector(): React.ReactElement {
  useStore((s) => s.version);
  const id = useStore((s) => s.selectedNodeId);
  const node = useStore((s) => (id ? s.model.nodes[id] : undefined));
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  if (!node) {
    return <Prim.Box as="aside" display="flex" flexDirection="row" aria-label="inspector" color="var(--muted-foreground)" height="100%" justifyContent="center" fontSize="12px" alignItems="center"><Prim.Text>Select a node to inspect.</Prim.Text></Prim.Box>;
  }

  return (
    <Prim.Box as="aside" display="flex" flexDirection="column" aria-label="inspector" height="100%">
      <Prim.Box borderColor="var(--border)" paddingHorizontal="$3" paddingVertical="$2" borderBottomWidth={1}>
        <Prim.Row gap="$2" alignItems="center">
          <StatusIcon status={node.status} />
          <Prim.Text color="var(--foreground)" fontFamily="$mono" fontSize="12px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={node.label}>{node.label}</Prim.Text>
          <KindBadge kind={node.kind} />
          {node.durationMs !== undefined && <Prim.Text color="var(--muted-foreground)" fontSize="10px" fontFamily="$mono" marginLeft="auto">{fmtDuration(node.durationMs)}</Prim.Text>}
        </Prim.Row>
        <Prim.Box color="var(--muted-foreground)" fontSize="10px" fontFamily="$mono" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" marginTop="0.25rem" title={node.id}><Prim.Text>{node.id}</Prim.Text></Prim.Box>
        {node.detail && Object.keys(node.detail).length > 0 && (
          <Prim.Box color="var(--muted-foreground)" fontSize="10px" fontFamily="$mono" marginTop="0.25rem"><Prim.Text>{preview(node.detail, 200)}</Prim.Text></Prim.Box>
        )}
        {node.error && <Prim.Box color="var(--destructive)" fontSize="11px" fontFamily="$mono" marginTop="0.25rem"><Prim.Text>{preview(node.error, 300)}</Prim.Text></Prim.Box>}
        {node.result !== undefined && <Prim.Box color="var(--success)" fontSize="10px" fontFamily="$mono" marginTop="0.25rem">result: {preview(node.result, 200)}</Prim.Box>}
      </Prim.Box>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto" padding="$2">
        {tab === 'llm' && <LlmTab node={node} />}
        {tab === 'statements' && <StatementsTab node={node} />}
        {tab === 'yields' && <YieldsTab node={node} />}
        {tab === 'variables' && <VariablesTab node={node} />}
        {tab === 'raw' && <RawTab node={node} />}
      </Prim.Box>
    </Prim.Box>
  );
}
