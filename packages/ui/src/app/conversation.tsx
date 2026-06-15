import React from 'react';
import { isFormDescriptor } from '@lmthing/core/ui';
import { useStore } from '../store/store.js';
import type { ConvoBlock } from '../store/model.js';
import { preview } from './common.js';
import { CatalogForm } from '../components/forms/CatalogForm.js';
import { renderDescriptor, isDescriptor } from '../components/render-descriptor.js';
import type { Descriptor } from '../components/render-descriptor.js';
export type { Descriptor };

declare const __SPACE_COMPONENTS__: Record<string, React.ComponentType<Record<string, unknown>>> | undefined;
function spaceComponents(): Record<string, React.ComponentType<Record<string, unknown>>> {
  const w = window as unknown as { __SPACE_COMPONENTS__?: Record<string, React.ComponentType<Record<string, unknown>>> };
  return w.__SPACE_COMPONENTS__ ?? (typeof __SPACE_COMPONENTS__ !== 'undefined' ? __SPACE_COMPONENTS__ : {}) ?? {};
}

// ─── Ask form ────────────────────────────────────────────────────────────────

function AskForm({ block }: { block: Extract<ConvoBlock, { type: 'ask' }> }): React.ReactElement {
  const send = (window as unknown as { __LM_SEND__?: (m: unknown) => void }).__LM_SEND__;
  const inert = block.state !== 'open';
  const comps = spaceComponents();
  const d = block.descriptor as Descriptor | undefined;
  const Comp = d && isDescriptor(d) ? comps[d.type] : undefined;

  const [text, setText] = React.useState('');
  const onSubmit = (value: unknown) => send?.({ type: 'submitForm', id: block.askId, value });

  return (
    <div data-testid="ask-form" data-ask-id={block.askId} className={`border rounded p-2 my-1 ${inert ? 'border-lm-border opacity-70' : 'border-lm-accent'}`}>
      {block.state === 'answered' && <div className="text-[10px] text-lm-green font-mono mb-1">answered: {preview(block.answer, 200)}</div>}
      {block.state === 'cancelled' && <div className="text-[10px] text-lm-muted font-mono mb-1">cancelled</div>}
      <div style={inert ? { pointerEvents: 'none' } : undefined}>
        {Comp ? (
          <Comp {...(d!.props ?? {})} onSubmit={onSubmit} />
        ) : d && isFormDescriptor(d) ? (
          <CatalogForm descriptor={d} onSubmit={onSubmit} />
        ) : (
          <div className="flex gap-2">
            <input
              className="flex-1 bg-lm-bg border border-lm-border rounded px-2 py-1 text-lm-text text-[12px]"
              value={text}
              disabled={inert}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(text); }}
              placeholder={typeof d?.props?.['prompt'] === 'string' ? String(d.props['prompt']) : 'your answer…'}
            />
            <button disabled={inert} onClick={() => onSubmit(text)} className="px-3 py-1 bg-lm-accent/20 text-lm-accent rounded text-[12px] disabled:opacity-50">Send</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

function BlockCard({ block }: { block: ConvoBlock }): React.ReactElement {
  const selectNode = useStore((s) => s.selectNode);
  const node = useStore((s) => s.model.nodes[block.nodeId]);
  const attribution = node && node.kind !== 'session' && node.kind !== 'run'
    ? <button onClick={() => selectNode(block.nodeId, true)} className="text-[10px] font-mono text-lm-cyan hover:underline" data-node-id={block.nodeId}>{node.label}</button>
    : null;

  let inner: React.ReactNode;
  if (block.type === 'user') inner = <div className="text-lm-text"><span className="text-lm-accent font-mono text-[10px] mr-2">you</span>{block.content}</div>;
  else if (block.type === 'display') inner = renderDescriptor(block.descriptor);
  else if (block.type === 'error') inner = <div className="text-lm-red font-mono text-[11px]">{block.message}</div>;
  else inner = <AskForm block={block} />;

  return (
    <div data-testid="block" className="px-3 py-1.5">
      {attribution && <div className="mb-0.5">{attribution}</div>}
      {inner}
    </div>
  );
}

function MessageInput(): React.ReactElement {
  const done = useStore((s) => s.done);
  const mode = useStore((s) => s.mode);
  const noteUser = useStore((s) => s.noteUserMessage);
  const [text, setText] = React.useState('');
  const send = (window as unknown as { __LM_SEND__?: (m: unknown) => void }).__LM_SEND__;
  if (mode === 'replay') return <div className="px-3 py-2 text-[11px] text-lm-muted border-t border-lm-border">Replay mode — input disabled.</div>;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    noteUser(t);
    send?.({ type: 'sendMessage', content: t });
    setText('');
  };
  return (
    <div className="flex gap-2 px-3 py-2 border-t border-lm-border">
      <input
        data-testid="message-input"
        className="flex-1 bg-lm-bg border border-lm-border rounded px-2 py-1.5 text-lm-text text-[13px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={done ? 'Continue the conversation…' : 'Type a message…'}
      />
      <button onClick={submit} className="px-4 py-1.5 bg-lm-accent/20 text-lm-accent rounded text-[13px]">Send</button>
    </div>
  );
}

export function ConversationStream(): React.ReactElement {
  useStore((s) => s.version);
  const blocks = useStore((s) => s.model.blocks);
  const follow = useStore((s) => s.follow);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [blocks.length, follow]);

  return (
    <main aria-label="conversation" className="h-full flex flex-col">
      <div ref={ref} className="flex-1 overflow-y-auto py-1">
        {blocks.length === 0 && <div className="px-3 py-4 text-lm-muted text-[12px]">No messages yet.</div>}
        {blocks.map((b) => <BlockCard key={b.id} block={b} />)}
      </div>
      <MessageInput />
    </main>
  );
}
