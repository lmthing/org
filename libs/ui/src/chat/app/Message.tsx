import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { marked } from 'marked';
import { isFormDescriptor } from '@lmthing/core/ui';
import { useStore } from '../store/store.js';
import type { ConvoBlock } from '../store/model.js';
import type { TraceAttachment } from '@lmthing/core';
import { preview } from './common.js';
import { CatalogForm } from '../components/forms/CatalogForm.js';
import { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from '../components/ConsentCard.js';
import { renderDescriptor, isDescriptor } from '../components/render-descriptor.js';
import type { Descriptor } from '../components/render-descriptor.js';
import { ActivityStrip } from './ActivityStrip.js';
import { withAuthToken } from './auth.js';
import { cn } from '../lib/cn.js';

// ─── Space component registry ─────────────────────────────────────────────────

declare const __SPACE_COMPONENTS__: Record<string, React.ComponentType<Record<string, unknown>>> | undefined;
function spaceComponents(): Record<string, React.ComponentType<Record<string, unknown>>> {
  const w = window as unknown as { __SPACE_COMPONENTS__?: Record<string, React.ComponentType<Record<string, unknown>>> };
  return w.__SPACE_COMPONENTS__ ?? (typeof __SPACE_COMPONENTS__ !== 'undefined' ? __SPACE_COMPONENTS__ : {}) ?? {};
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownText({ text }: { text: string }) {
  const html = React.useMemo(() => {
    try { return marked.parse(text) as string; } catch { return text; }
  }, [text]);
  return <Prim.Box className="lm-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Ask form ─────────────────────────────────────────────────────────────────

function AskForm({ block }: { block: Extract<ConvoBlock, { type: 'ask' }> }) {
  const send = (window as unknown as { __LM_SEND__?: (m: unknown) => void }).__LM_SEND__;
  const inert = block.state !== 'open';
  const comps = spaceComponents();
  const d = block.descriptor as Descriptor | undefined;
  const Comp = d && isDescriptor(d) ? comps[d.type] : undefined;
  const [text, setText] = React.useState('');
  const onSubmit = (value: unknown) => send?.({ type: 'submitForm', id: block.askId, value });

  return (
    <Prim.Box
      data-testid="ask-form"
      data-ask-id={block.askId}
      marginVertical="0.25rem"
      className={cn(
        'border rounded-xl p-3 transition-colors',
        inert ? 'border-border opacity-70' : 'border-agent/50 bg-agent/5',
      )}
    >
      {block.state === 'answered' && (
        <Prim.Box className="text-xs text-knowledge font-mono" marginBottom="0.5rem">✓ {preview(block.answer, 200)}</Prim.Box>
      )}
      {block.state === 'cancelled' && (
        <Prim.Box className="text-xs text-muted-foreground font-mono" marginBottom="0.5rem">cancelled</Prim.Box>
      )}
      <Prim.Box style={inert ? { pointerEvents: 'none' } : undefined}>
        {d && isConsentDescriptor(d) ? (
          <ConsentCard
            {...consentPropsFromDescriptor(d)}
            inert={inert}
            onApprove={() => onSubmit(true)}
            onDeny={() => onSubmit(false)}
          />
        ) : Comp ? (
          <Comp {...(d!.props ?? {})} onSubmit={onSubmit} />
        ) : d && isFormDescriptor(d) ? (
          <CatalogForm descriptor={d} onSubmit={onSubmit} />
        ) : (
          <Prim.Row className="gap-2">
            <Prim.TextField
              className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={text}
              disabled={inert}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text); }}
              placeholder={typeof d?.props?.['prompt'] === 'string' ? String(d.props['prompt']) : 'your answer…'}
            />
            <Prim.Pressable
              disabled={inert}
              onClick={() => onSubmit(text)}
              className="px-3 py-1.5 bg-agent text-agent-foreground rounded-lg text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              Send
            </Prim.Pressable>
          </Prim.Row>
        )}
      </Prim.Box>
    </Prim.Box>
  );
}

// ─── Attribution button ───────────────────────────────────────────────────────

function AttributionButton({ nodeId, label }: { nodeId: string; label: string }) {
  const selectNode = useStore((s) => s.selectNode);
  const setDevPanelOpen = useStore((s) => s.setDevPanelOpen);
  return (
    <Prim.Pressable
      onClick={() => { selectNode(nodeId, true); setDevPanelOpen(true); }}
      className="text-xs text-muted-foreground hover:text-foreground font-mono transition-colors" marginBottom="0.25rem" display="block"
      data-node-id={nodeId}
    >
      {label}
    </Prim.Pressable>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* */ }
  };
  return (
    <Prim.Pressable
      onClick={() => void copy()}
      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded"
      title="Copy"
      aria-label="Copy message"
    >
      {copied
        ? <Prim.Text className="text-knowledge text-xs">✓</Prim.Text>
        : (
          <Prim.Svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <Prim.Rect x="9" y="9" width="13" height="13" rx="2" />
            <Prim.Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </Prim.Svg>
        )
      }
    </Prim.Pressable>
  );
}

// ─── User attachment rendering ─────────────────────────────────────────────────

function UserAttachment({ att }: { att: TraceAttachment }) {
  // `<img>`/`<audio>`/`<a>` can't send an Authorization header, so carry the
  // token as a query param — Envoy's chat-jwt SecurityPolicy accepts it and
  // routes the /api/uploads GET to the user's pod (see withAuthToken).
  const url = withAuthToken(att.url);
  if (att.kind === 'image') {
    return (
      <Prim.Link href={url} target="_blank" rel="noreferrer">
        <Prim.Image
          src={url}
          alt={att.filename ?? 'image attachment'}
          className="max-w-[260px] max-h-[260px] rounded-xl border border-border object-cover"
        />
      </Prim.Link>
    );
  }
  if (att.kind === 'audio') {
    return (
      <Prim.Col className="gap-1" alignItems="flex-end">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <Prim.Audio controls src={url} className="max-w-[260px]" />
        {att.transcript && (
          <Prim.Box className="max-w-[260px] text-xs text-muted-foreground italic text-right">
            “{att.transcript}”
          </Prim.Box>
        )}
      </Prim.Col>
    );
  }
  return (
    <Prim.Link
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground hover:opacity-90"
    >
      <Prim.Text className="text-muted-foreground">📎</Prim.Text>
      <Prim.Text className="max-w-[200px]" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{att.filename ?? att.mediaType}</Prim.Text>
    </Prim.Link>
  );
}

// ─── Message ──────────────────────────────────────────────────────────────────

interface MessageProps {
  block: ConvoBlock;
}

export function Message({ block }: MessageProps) {
  const node = useStore((s) => s.model.nodes[block.nodeId]);
  const showAttribution = node && node.kind !== 'session' && node.kind !== 'run';
  const childNodeIds = node?.childIds ?? [];

  // User bubble
  if (block.type === 'user') {
    const attachments = block.attachments ?? [];
    return (
      <Prim.Row className="justify-end px-4 py-2 lm-fade-in group">
        <Prim.Row className="max-w-[75%] gap-1.5" alignItems="flex-start">
          <CopyButton text={block.content} />
          <Prim.Col className="gap-1.5" alignItems="flex-end">
            {attachments.length > 0 && (
              <Prim.Col className="gap-1.5" alignItems="flex-end">
                {attachments.map((a, i) => (
                  <UserAttachment key={i} att={a} />
                ))}
              </Prim.Col>
            )}
            {block.content && (
              <Prim.Box className="bg-muted text-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed" whiteSpace="pre-wrap">
                {block.content}
              </Prim.Box>
            )}
          </Prim.Col>
        </Prim.Row>
      </Prim.Row>
    );
  }

  // Display block — full-width, no bubble, render markdown or descriptor
  if (block.type === 'display') {
    const isString = typeof block.descriptor === 'string';
    const textForCopy = isString ? (block.descriptor as string) : preview(block.descriptor, 500);
    return (
      <Prim.Box className="px-4 py-2 lm-fade-in group" data-testid="block">
        <Prim.Row className="gap-1.5" alignItems="flex-start">
          <Prim.Box className="flex-1 min-w-0 text-sm text-foreground">
            {showAttribution && (
              <AttributionButton nodeId={block.nodeId} label={node.label} />
            )}
            {isString
              ? <MarkdownText text={block.descriptor as string} />
              : renderDescriptor(block.descriptor)
            }
          </Prim.Box>
          <CopyButton text={textForCopy} />
        </Prim.Row>
      </Prim.Box>
    );
  }

  // Error callout
  if (block.type === 'error') {
    return (
      <Prim.Box className="px-4 py-2 lm-fade-in" data-testid="block">
        <Prim.Box className="border border-destructive/30 bg-destructive/10 rounded-lg px-3 py-2 text-sm text-destructive font-mono">
          {block.message}
        </Prim.Box>
      </Prim.Box>
    );
  }

  // Ask form
  return (
    <Prim.Box className="px-4 py-2 lm-fade-in" data-testid="block">
      {showAttribution && (
        <AttributionButton nodeId={block.nodeId} label={node.label} />
      )}
      <AskForm block={block} />
      <ActivityStrip nodeIds={childNodeIds} />
    </Prim.Box>
  );
}

// ─── AssistantTurn ────────────────────────────────────────────────────────────
// Groups a run of assistant-side blocks (display + ask) with the agent avatar
// and a single copy button for all text content in the turn.

export function AssistantTurn({ blocks, nodeIds }: { blocks: ConvoBlock[]; nodeIds?: string[] }) {
  const textContent = blocks
    .filter((b): b is Extract<ConvoBlock, { type: 'display' }> => b.type === 'display' && typeof b.descriptor === 'string')
    .map((b) => b.descriptor as string)
    .join('\n\n');

  return (
    <Prim.Box className="py-1 group relative lm-fade-in">
      <Prim.Row className="gap-2 px-4" alignItems="flex-start">
        <Prim.Text className="shrink-0 w-6 h-6 rounded-full bg-brand-2/20 items-center justify-center text-xs select-none" marginTop="0.75rem" display="flex" aria-hidden="true">
          ✦
        </Prim.Text>
        <Prim.Box className="flex-1 min-w-0">
          {blocks.map((b) => <Message key={b.id} block={b} />)}
          {nodeIds && nodeIds.length > 0 && (
            <Prim.Box className="px-0 pb-2">
              <ActivityStrip nodeIds={nodeIds} />
            </Prim.Box>
          )}
        </Prim.Box>
        {textContent && <CopyButton text={textContent} />}
      </Prim.Row>
    </Prim.Box>
  );
}
