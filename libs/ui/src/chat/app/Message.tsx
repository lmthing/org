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
        // `Prim.Box` is an RN `View` — none of `fontSize`/`color`/`fontFamily` below reaches a bare
        // string child, so both the checkmark and the preview are wrapped in one `Prim.Text` that
        // restates them (see the `cancelled` case just below, and `primitives/_native.tsx#NativeText`).
        <Prim.Box fontSize="$xs" color="$knowledge" fontFamily="$mono" marginBottom="0.5rem">
          <Prim.Text fontSize="$xs" color="$knowledge" fontFamily="$mono">✓ {preview(block.answer, 200)}</Prim.Text>
        </Prim.Box>
      )}
      {block.state === 'cancelled' && (
        // `Prim.Box` is an RN `View` — none of `fontSize`/`color`/`fontFamily` above reaches the
        // nested `Prim.Text`, and `NativeText`'s own unconditional defaults (`$body`/`$foreground`)
        // fill the gap instead. Restated here so "cancelled" actually renders muted and mono on a
        // device rather than at body size/face/ink. See `primitives/_native.tsx#NativeText`.
        <Prim.Box fontSize="$xs" color="$muted-foreground" fontFamily="$mono" marginBottom="0.5rem"><Prim.Text fontSize="$xs" color="$muted-foreground" fontFamily="$mono">cancelled</Prim.Text></Prim.Box>
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
              {/* `Prim.Pressable` is an RN `View` — its `color`/`fontSize` above style the button
                  fill, not this label, so both are restated on the wrapped `Prim.Text`. */}
              <Prim.Text color="$agent-foreground" fontSize="$sm">Send</Prim.Text>
            </Prim.Pressable>
          </Prim.Row>
        )}
      </Prim.Box>
    </Prim.Box>
  );
}

// ─── Retry (a failed turn) ────────────────────────────────────────────────────

/**
 * An error block used to render as text only — a network hiccup or an LLM error ended the
 * conversation dead, and the only way forward was to retype the whole message. This resends the
 * user turn that led to the error, the same way the composer sends one (`noteUser` echoes it into
 * the transcript, `sendMessage` puts it back on the wire).
 */
function RetryButton({ text }: { text: string }) {
  const noteUser = useStore((s) => s.noteUserMessage);
  const retry = () => {
    const send = getLiveSend();
    if (!send) return;
    noteUser(text);
    send({ type: 'sendMessage', content: text });
  };
  return (
    <Prim.Pressable
      onClick={retry}
      transition="quick" animateOnly={["opacity"]} alignItems="center" gap="$1" marginTop="0.375rem" paddingHorizontal="$2" paddingVertical="$1" borderWidth={1} borderColor="color-mix(in srgb, var(--destructive) 40%, transparent)" borderRadius="$radius-lg" fontSize="$xs" color="$destructive" display="inline-flex" hoverStyle={{ opacity: 0.8 }}
      aria-label="Retry the last message"
    >
      <Prim.Text>↻ Retry</Prim.Text>
    </Prim.Pressable>
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
      // Visible from the start, fading UP on hover rather than in from nothing. It used to be
      // `opacity={0}` + `$group-hover={{ opacity: 1 }}`, and `$group-hover` only ever fires from a
      // real `:hover` — which a touchscreen never sends. So on a phone this was not "subtle until
      // you point at it", it was invisible AND untappable: there was no way to copy a message at
      // all. A mouse still gets the reveal (0.45 → 1); a thumb gets a control it can actually see
      // and hit, which is the whole point of the affordance.
      transition="quick" animateOnly={["opacity"]} flexShrink={0} opacity={0.45} color="$muted-foreground" padding="$1" borderRadius="$radius" $group-hover={{ opacity: 1 }} hoverStyle={{ color: "$foreground" }}
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

// ─── Edit-and-resend button ────────────────────────────────────────────────────

/**
 * Reopens a sent user message in the composer for correction (`Composer`'s `editDraft` effect
 * consumes `startEditMessage`'s result). On send, `Composer.handleSend` drops this block and
 * everything the agent said after it from the LOCAL transcript — see the comment there for why
 * that is a view-only fix, not a true edit of what the agent remembers.
 *
 * Deliberately NOT hover-revealed from nothing: `$group-hover` only fires from a real `:hover`,
 * which a touchscreen never sends, so `opacity={0}` + `$group-hover={{ opacity: 1 }}` leaves a
 * control invisible AND unreachable on a phone. `CopyButton` above had exactly that bug — there
 * was no way to copy a message on a phone at all — and now starts visible and merely brightens on
 * hover. Neither control should go back to revealing from zero.
 */
function EditButton({ blockId, text }: { blockId: string; text: string }) {
  const startEdit = useStore((s) => s.startEditMessage);
  return (
    <Prim.Pressable
      onClick={() => startEdit(blockId, text)}
      transition="quick" animateOnly={["color"]} flexShrink={0} color="$muted-foreground" padding="$1" borderRadius="$radius" hoverStyle={{ color: "$foreground" }}
      title="Edit and resend"
      aria-label="Edit and resend message"
    >
      <Prim.Svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <Prim.Path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </Prim.Svg>
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
        {/* No `jsx-a11y` disable here: that plugin is not a dependency, so the rule it named never
            ran and the directive was an ERROR ('Definition for rule was not found'). A voice note has
            no caption track to offer; if `eslint-plugin-jsx-a11y` is ever added, this is a real
            finding to answer rather than a comment to restore. */}
        {/* `Prim.Audio` is a host passthrough — it IGNORES style props, so this is a `style`. */}
        <Prim.Audio controls src={url} style={{ maxWidth: 260 }} />
        {att.transcript && (
          // `Prim.Box` is an RN `View` — its `fontSize`/`color`/`fontStyle`/`textAlign` below style
          // the box, not the quoted transcript, so all four are restated on the wrapped `Prim.Text`.
          <Prim.Box maxWidth="260px" fontSize="$xs" color="$muted-foreground" fontStyle="italic" textAlign="right">
            <Prim.Text fontSize="$xs" color="$muted-foreground" fontStyle="italic" textAlign="right">“{att.transcript}”</Prim.Text>
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

/** The error block, with a Retry that resends whatever user turn preceded it — the nearest
 *  `'user'` block earlier in the transcript. Absent (edge case: an error with no prior user turn,
 *  e.g. a resumed session) simply omits the button rather than retrying nothing. */
function ErrorMessage({ block }: { block: Extract<ConvoBlock, { type: 'error' }> }) {
  const retryText = useStore((s) => {
    const blocks = s.model.blocks;
    const idx = blocks.findIndex((b) => b.id === block.id);
    for (let i = idx - 1; i >= 0; i--) {
      const b = blocks[i]!;
      if (b.type === 'user') return b.content;
    }
    return undefined;
  });
  return (
    <Prim.Box className="lm-fade-in" paddingVertical="$2" data-testid="block">
      <Prim.Box borderColor="color-mix(in srgb, var(--destructive) 30%, transparent)" backgroundColor="color-mix(in srgb, var(--destructive) 10%, transparent)" borderWidth={1} borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$2" fontSize="$sm" color="$destructive" fontFamily="$mono">
        {/* The Box's fontSize/color/fontFamily are container-level props; an RN `View` drops them
            all, so the message rendered at body size/ink/face on native without this. */}
        <Prim.Text fontSize="$sm" color="$destructive" fontFamily="$mono">{block.message}</Prim.Text>
        {retryText && <RetryButton text={retryText} />}
      </Prim.Box>
    </Prim.Box>
  );
}

// ─── Message ──────────────────────────────────────────────────────────────────

interface MessageProps {
  block: ConvoBlock;
}

/**
 * Wrapped in `React.memo` (as is `AssistantTurn` below, with the SAME custom comparator — see
 * `blockRenderEqual`): `ChatView` re-renders the whole transcript on every streamed batch, and
 * `groupBlocks` there recomputes only when a block is added — so without this, every message that
 * had already finished minutes ago re-ran its markdown/code-block parse on every single token of
 * whatever is streaming now, since `blocks.map(...)`/`AssistantTurn` recreate the `<Message>`
 * element on each pass regardless. `feedLive` (`store/session-slice.ts`) only ever `push`es a NEW
 * block object onto `model.blocks` — an existing block's OWN object reference never changes
 * (`resolveAskBlock` is the one exception, mutating `state`/`answer` in place, which is exactly
 * why the comparator is custom rather than the memo default) — so the memo skips the parse for
 * every block whose reference carried over unchanged, which on a long session is most of them.
 */
function MessageImpl({ block }: MessageProps) {
  const node = useStore((s) => s.model.nodes[block.nodeId]);
  const mode = useStore((s) => s.mode);
  const showAttribution = node && node.kind !== 'session' && node.kind !== 'run';
  const childNodeIds = node?.childIds ?? [];

  // User bubble
  if (block.type === 'user') {
    const attachments = block.attachments ?? [];
    return (
      <Prim.Row className="lm-fade-in" {...({ group: true } as Record<string, unknown>)} justifyContent="flex-end" paddingHorizontal="$4" paddingVertical="$2">
        {/* `flexShrink`/`minWidth` rather than `maxWidth` alone: Yoga will not shrink a row below
            its content unless told it may, so a long single-line message grew past the parent's
            `paddingHorizontal` and ran under the right edge of the screen — the cap was never
            reached because the row simply overflowed instead. */}
        <Prim.Row maxWidth="75%" flexShrink={1} minWidth={0} gap="$1.5" alignItems="flex-start">
          {/* Replay has no live composer to resend into (`Composer` renders its "input disabled"
              branch there, never the text field an edit would land in — see that early return),
              and an attachment-only message has no text worth reopening. */}
          {mode !== 'replay' && block.content && <EditButton blockId={block.id} text={block.content} />}
          <CopyButton text={block.content} />
          <Prim.Col gap="$1.5" alignItems="flex-end" flexShrink={1} minWidth={0}>
            {attachments.length > 0 && (
              <Prim.Col gap="$1.5" alignItems="flex-end">
                {attachments.map((a, i) => (
                  <UserAttachment key={i} att={a} />
                ))}
              </Prim.Col>
            )}
            {/* lineHeight is a NUMBER OF PIXELS, never a ratio: Tamagui appends `px` to whatever
                number it is given, so the `leading-relaxed` idiom (`lineHeight={1.625}`) compiled to
                `line-height: 1.625px` and every wrapped line of a message was painted on top of the
                one before it. 24 ≈ 1.7 × the 14px `$sm` text. See lineHeight.test.tsx. */}
            {block.content && (
              <Prim.Box backgroundColor="$muted" color="$foreground" borderRadius="$radius-xl" borderTopRightRadius="$radius-sm" paddingHorizontal="$4" paddingVertical="$2.5" fontSize="$sm" lineHeight={24} whiteSpace="pre-wrap">
                <Prim.Text>{block.content}</Prim.Text>
              </Prim.Box>
            )}
          </Prim.Col>
        </Prim.Row>
      </Prim.Row>
    );
  }

  // Display block — full-width, no bubble, render markdown or descriptor
  //
  // No `paddingHorizontal` here: every non-user block reaches this component nested inside
  // `AssistantTurn`, whose own Row already pads the icon+content pair by `$4`. Padding again here
  // double-indented the text past the icon — on a phone-width column that reads as the whole
  // response shoved off to the right, with a lopsided gap of blank space on the far side.
  if (block.type === 'display') {
    const isString = typeof block.descriptor === 'string';
    const textForCopy = isString ? (block.descriptor as string) : preview(block.descriptor, 500);
    return (
      <Prim.Box className="lm-fade-in" {...({ group: true } as Record<string, unknown>)} paddingVertical="$2" data-testid="block">
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
    return <ErrorMessage block={block} />;
  }

  // Ask form
  return (
    <Prim.Box className="lm-fade-in" paddingVertical="$2" data-testid="block">
      {showAttribution && (
        <AttributionButton nodeId={block.nodeId} label={node.label} />
      )}
      <AskForm block={block} />
      <ActivityStrip nodeIds={childNodeIds} />
    </Prim.Box>
  );
}

/**
 * Whether two (possibly-identical-object) blocks render the same thing.
 *
 * Reference equality is NOT enough for an `ask` block on its own: `resolveAskBlock`
 * (`store/model.ts`) mutates an open ask's `state`/`answer` IN PLACE rather than replacing the
 * block object. That means a comparator cannot simply diff `state`/`answer` between the two
 * sides either — by the time a `React.memo` comparator runs, `prevProps` and `nextProps` are
 * both looking at the SAME (already-mutated) object, so both observations agree with each other
 * regardless of whether the ask just flipped from open to answered. There is no earlier snapshot
 * left to diff against.
 *
 * So an `ask` block is never treated as unchanged by identity alone — this matches today's
 * (correct, unmemoized) behaviour for that one block type exactly, at the cost of not memoizing
 * it. Every other block type is created once and never mutated after (see the audit of every
 * `m.blocks.push`/field assignment in `model.ts`), so reference equality really does mean
 * "unchanged" for them — which is where the memoization actually pays off: `display` blocks are
 * the ones carrying the markdown/code-block parse this exists to skip.
 */
function blockRenderEqual(a: ConvoBlock, b: ConvoBlock): boolean {
  if (a !== b) return false;
  if (a.type === 'ask') return false;
  return true;
}

export const Message = React.memo(MessageImpl, (prev, next) => blockRenderEqual(prev.block, next.block));

// ─── AssistantTurn ────────────────────────────────────────────────────────────
// Groups a run of assistant-side blocks (display + ask) with the agent avatar
// and a single copy button for all text content in the turn.

function AssistantTurnImpl({ blocks, nodeIds }: { blocks: ConvoBlock[]; nodeIds?: string[] }) {
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

/**
 * Memoized with a custom comparator, not the default shallow one — same reason as `Message`
 * above. `blocks` is the array `groupBlocks` (memoized in `ChatView`) hands down; an ask inside it
 * resolving mutates that ask's block IN PLACE, so the array reference is unchanged and a default
 * comparator would silently skip the re-render that shows the answer.
 */
function assistantTurnPropsEqual(
  prev: { blocks: ConvoBlock[]; nodeIds?: string[] },
  next: { blocks: ConvoBlock[]; nodeIds?: string[] },
): boolean {
  if (prev.blocks.length !== next.blocks.length) return false;
  for (let i = 0; i < prev.blocks.length; i++) {
    if (!blockRenderEqual(prev.blocks[i]!, next.blocks[i]!)) return false;
  }
  const pn = prev.nodeIds ?? [];
  const nn = next.nodeIds ?? [];
  if (pn.length !== nn.length) return false;
  for (let i = 0; i < pn.length; i++) if (pn[i] !== nn[i]) return false;
  return true;
}

export const AssistantTurn = React.memo(AssistantTurnImpl, assistantTurnPropsEqual);
