import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { isFormDescriptor } from '@lmthing/core/ui';
import { useStore } from '../store/store';
import type { ConvoBlock } from '../store/model';
import type { TraceAttachment } from '@lmthing/core';
import { preview } from './common';
import { CatalogForm } from '../components/forms/CatalogForm';
import { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from '../components/ConsentCard';
import { renderDescriptor, isDescriptor } from '../components/render-descriptor';
import type { Descriptor } from '../components/render-descriptor';
import { ActivityStrip } from './ActivityStrip';
import { withAuthToken } from './auth';
import { cn } from '../lib/cn';

// The transcript's markdown is rendered as ELEMENTS, not injected HTML, so it needs no stylesheet
// and works on both targets. `preset="prose"` is the former `.lm-prose` scale.
import { Markdown } from '../../elements/content/markdown';
import { getLiveSend } from './live-send';
import { clipboard } from '../../platform/clipboard';

// ─── Space component registry ─────────────────────────────────────────────────

declare const __SPACE_COMPONENTS__: Record<string, React.ComponentType<Record<string, unknown>>> | undefined;
function spaceComponents(): Record<string, React.ComponentType<Record<string, unknown>>> {
  // `globalThis`, not `window`: the pod injects this global, and there is no `window` on native.
  const w = globalThis as unknown as { __SPACE_COMPONENTS__?: Record<string, React.ComponentType<Record<string, unknown>>> };
  return w.__SPACE_COMPONENTS__ ?? (typeof __SPACE_COMPONENTS__ !== 'undefined' ? __SPACE_COMPONENTS__ : {}) ?? {};
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownText({ text }: { text: string }) {
  return <Markdown source={text} preset="prose" />;
}

/**
 * `border-border opacity-70` / `border-agent/50 bg-agent/5` — the answered-or-cancelled vs open ask
 * frame. The `/50` and `/5` alphas become web `color-mix`, the convention used across this codebase.
 */
const BLOCK_INERT = { borderColor: '$border', opacity: 0.7 } as const;
const BLOCK_LIVE = {
  borderColor: 'color-mix(in srgb, var(--agent) 50%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--agent) 5%, transparent)',
} as const;

// ─── Ask form ─────────────────────────────────────────────────────────────────

function AskForm({ block }: { block: Extract<ConvoBlock, { type: 'ask' }> }) {
  const send = getLiveSend();
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
      {...(inert ? BLOCK_INERT : BLOCK_LIVE)} transition="quick" animateOnly={["color", "background-color", "border-color"]} borderWidth={1} borderRadius="$radius-xl" padding="$3"
    >
      {block.state === 'answered' && (
        <Prim.Box fontSize="$xs" color="$knowledge" fontFamily="$mono" marginBottom="0.5rem">✓ {preview(block.answer, 200)}</Prim.Box>
      )}
      {block.state === 'cancelled' && (
        <Prim.Box fontSize="$xs" color="$muted-foreground" fontFamily="$mono" marginBottom="0.5rem">cancelled</Prim.Box>
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
          <Prim.Row gap="$2">
            <Prim.TextField
              flexGrow={1} flexShrink={1} flexBasis="0%" backgroundColor="$background" borderWidth={1} borderColor="$border" borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$1.5" fontSize="$sm" color="$foreground" placeholderTextColor="$muted-foreground" focusStyle={{ outlineWidth: 2, outlineStyle: "solid", outlineColor: "$ring" }}
              value={text}
              disabled={inert}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text); }}
              placeholder={typeof d?.props?.['prompt'] === 'string' ? String(d.props['prompt']) : 'your answer…'}
            />
            <Prim.Pressable
              disabled={inert}
              onClick={() => onSubmit(text)}
              transition="quick" animateOnly={["opacity"]} paddingHorizontal="$3" paddingVertical="$1.5" backgroundColor="$agent" color="$agent-foreground" borderRadius="$radius-lg" fontSize="$sm" disabledStyle={{ opacity: 0.5 }} hoverStyle={{ opacity: 0.9 }}
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
      transition="quick" animateOnly={["color", "background-color", "border-color"]} fontSize="$xs" color="$muted-foreground" fontFamily="$mono" hoverStyle={{ color: "$foreground" }} marginBottom="0.25rem" display="block"
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
      await clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* */ }
  };
  return (
    <Prim.Pressable
      onClick={() => void copy()}
      transition="quick" animateOnly={["opacity"]} flexShrink={0} opacity={0} color="$muted-foreground" padding="$1" borderRadius="$radius" $group-hover={{ opacity: 1 }} hoverStyle={{ color: "$foreground" }}
      title="Copy"
      aria-label="Copy message"
    >
      {copied
        ? <Prim.Text color="$knowledge" fontSize="$xs">✓</Prim.Text>
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
          maxWidth="260px" maxHeight="260px" borderRadius="$radius-xl" borderWidth={1} borderColor="$border" objectFit="cover"
        />
      </Prim.Link>
    );
  }
  if (att.kind === 'audio') {
    return (
      <Prim.Col gap="$1" alignItems="flex-end">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        {/* `Prim.Audio` is a host passthrough — it IGNORES style props, so this is a `style`. */}
        <Prim.Audio controls src={url} style={{ maxWidth: 260 }} />
        {att.transcript && (
          <Prim.Box maxWidth="260px" fontSize="$xs" color="$muted-foreground" fontStyle="italic" textAlign="right">
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
      alignItems="center" gap="$1.5" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$muted" paddingHorizontal="$3" paddingVertical="$2" fontSize="$sm" color="$foreground" hoverStyle={{ opacity: 0.9 }} display="inline-flex"
    >
      <Prim.Text color="$muted-foreground">📎</Prim.Text>
      <Prim.Text maxWidth="200px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{att.filename ?? att.mediaType}</Prim.Text>
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
      <Prim.Row className="lm-fade-in" {...({ group: true } as Record<string, unknown>)} justifyContent="flex-end" paddingHorizontal="$4" paddingVertical="$2">
        <Prim.Row maxWidth="75%" gap="$1.5" alignItems="flex-start">
          <CopyButton text={block.content} />
          <Prim.Col gap="$1.5" alignItems="flex-end">
            {attachments.length > 0 && (
              <Prim.Col gap="$1.5" alignItems="flex-end">
                {attachments.map((a, i) => (
                  <UserAttachment key={i} att={a} />
                ))}
              </Prim.Col>
            )}
            {block.content && (
              <Prim.Box backgroundColor="$muted" color="$foreground" borderRadius="$radius-xl" borderTopRightRadius="$radius-sm" paddingHorizontal="$4" paddingVertical="$2.5" fontSize="$sm" lineHeight={1.625} whiteSpace="pre-wrap">
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
      <Prim.Box className="lm-fade-in" {...({ group: true } as Record<string, unknown>)} paddingHorizontal="$4" paddingVertical="$2" data-testid="block">
        <Prim.Row gap="$1.5" alignItems="flex-start">
          <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0} fontSize="$sm" color="$foreground">
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
      <Prim.Box className="lm-fade-in" paddingHorizontal="$4" paddingVertical="$2" data-testid="block">
        <Prim.Box borderColor="color-mix(in srgb, var(--destructive) 30%, transparent)" backgroundColor="color-mix(in srgb, var(--destructive) 10%, transparent)" borderWidth={1} borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$2" fontSize="$sm" color="$destructive" fontFamily="$mono">
          {block.message}
        </Prim.Box>
      </Prim.Box>
    );
  }

  // Ask form
  return (
    <Prim.Box className="lm-fade-in" paddingHorizontal="$4" paddingVertical="$2" data-testid="block">
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
    <Prim.Box className="lm-fade-in" {...({ group: true } as Record<string, unknown>)} paddingVertical="$1" position="relative">
      <Prim.Row gap="$2" paddingHorizontal="$4" alignItems="flex-start">
        <Prim.Text backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)" flexShrink={0} width="$6" height="$6" borderRadius="$radius-full" alignItems="center" justifyContent="center" fontSize="$xs" userSelect="none" marginTop="0.75rem" display="flex" aria-hidden="true">
          ✦
        </Prim.Text>
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
          {blocks.map((b) => <Message key={b.id} block={b} />)}
          {nodeIds && nodeIds.length > 0 && (
            <Prim.Box paddingHorizontal="$0" paddingBottom="$2">
              <ActivityStrip nodeIds={nodeIds} />
            </Prim.Box>
          )}
        </Prim.Box>
        {textContent && <CopyButton text={textContent} />}
      </Prim.Row>
    </Prim.Box>
  );
}
