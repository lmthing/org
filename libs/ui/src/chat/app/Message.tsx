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
  return <div className="lm-prose" dangerouslySetInnerHTML={{ __html: html }} />;
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
    <div
      data-testid="ask-form"
      data-ask-id={block.askId}
      className={cn(
        'border rounded-xl p-3 my-1 transition-colors',
        inert ? 'border-border opacity-70' : 'border-agent/50 bg-agent/5',
      )}
    >
      {block.state === 'answered' && (
        <div className="text-xs text-knowledge font-mono mb-2">✓ {preview(block.answer, 200)}</div>
      )}
      {block.state === 'cancelled' && (
        <div className="text-xs text-muted-foreground font-mono mb-2">cancelled</div>
      )}
      <div style={inert ? { pointerEvents: 'none' } : undefined}>
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
          <div className="flex gap-2">
            <input
              className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={text}
              disabled={inert}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text); }}
              placeholder={typeof d?.props?.['prompt'] === 'string' ? String(d.props['prompt']) : 'your answer…'}
            />
            <button
              disabled={inert}
              onClick={() => onSubmit(text)}
              className="px-3 py-1.5 bg-agent text-agent-foreground rounded-lg text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Attribution button ───────────────────────────────────────────────────────

function AttributionButton({ nodeId, label }: { nodeId: string; label: string }) {
  const selectNode = useStore((s) => s.selectNode);
  const setDevPanelOpen = useStore((s) => s.setDevPanelOpen);
  return (
    <button
      onClick={() => { selectNode(nodeId, true); setDevPanelOpen(true); }}
      className="text-xs text-muted-foreground hover:text-foreground font-mono mb-1 block transition-colors"
      data-node-id={nodeId}
    >
      {label}
    </button>
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
    <button
      onClick={() => void copy()}
      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 rounded"
      title="Copy"
      aria-label="Copy message"
    >
      {copied
        ? <span className="text-knowledge text-xs">✓</span>
        : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )
      }
    </button>
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
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={att.filename ?? 'image attachment'}
          className="max-w-[260px] max-h-[260px] rounded-xl border border-border object-cover"
        />
      </a>
    );
  }
  if (att.kind === 'audio') {
    return (
      <div className="flex flex-col items-end gap-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={url} className="max-w-[260px]" />
        {att.transcript && (
          <div className="max-w-[260px] text-xs text-muted-foreground italic text-right">
            “{att.transcript}”
          </div>
        )}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground hover:opacity-90"
    >
      <span className="text-muted-foreground">📎</span>
      <span className="truncate max-w-[200px]">{att.filename ?? att.mediaType}</span>
    </a>
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
      <div className="flex justify-end px-4 py-2 lm-fade-in group">
        <div className="max-w-[75%] flex items-start gap-1.5">
          <CopyButton text={block.content} />
          <div className="flex flex-col items-end gap-1.5">
            {attachments.length > 0 && (
              <div className="flex flex-col items-end gap-1.5">
                {attachments.map((a, i) => (
                  <UserAttachment key={i} att={a} />
                ))}
              </div>
            )}
            {block.content && (
              <div className="bg-muted text-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                {block.content}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Display block — full-width, no bubble, render markdown or descriptor
  if (block.type === 'display') {
    const isString = typeof block.descriptor === 'string';
    const textForCopy = isString ? (block.descriptor as string) : preview(block.descriptor, 500);
    return (
      <div className="px-4 py-2 lm-fade-in group" data-testid="block">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0 text-sm text-foreground">
            {showAttribution && (
              <AttributionButton nodeId={block.nodeId} label={node.label} />
            )}
            {isString
              ? <MarkdownText text={block.descriptor as string} />
              : renderDescriptor(block.descriptor)
            }
          </div>
          <CopyButton text={textForCopy} />
        </div>
      </div>
    );
  }

  // Error callout
  if (block.type === 'error') {
    return (
      <div className="px-4 py-2 lm-fade-in" data-testid="block">
        <div className="border border-destructive/30 bg-destructive/10 rounded-lg px-3 py-2 text-sm text-destructive font-mono">
          {block.message}
        </div>
      </div>
    );
  }

  // Ask form
  return (
    <div className="px-4 py-2 lm-fade-in" data-testid="block">
      {showAttribution && (
        <AttributionButton nodeId={block.nodeId} label={node.label} />
      )}
      <AskForm block={block} />
      <ActivityStrip nodeIds={childNodeIds} />
    </div>
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
    <div className="py-1 group relative lm-fade-in">
      <div className="flex items-start gap-2 px-4">
        <span className="shrink-0 mt-3 w-6 h-6 rounded-full bg-brand-2/20 flex items-center justify-center text-xs select-none" aria-hidden="true">
          ✦
        </span>
        <div className="flex-1 min-w-0">
          {blocks.map((b) => <Message key={b.id} block={b} />)}
          {nodeIds && nodeIds.length > 0 && (
            <div className="px-0 pb-2">
              <ActivityStrip nodeIds={nodeIds} />
            </div>
          )}
        </div>
        {textContent && <CopyButton text={textContent} />}
      </div>
    </div>
  );
}
