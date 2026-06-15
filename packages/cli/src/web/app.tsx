import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useReplSession, DisplayBlock, VariablesBlock } from '@lmthing/agent-ui';
import type { ReplBlock } from '@lmthing/agent-ui';

// Space-specific form components registered by serve.ts at bundle time
declare const __SPACE_COMPONENTS__: Record<string, React.ComponentType<Record<string, unknown>>>;

interface JSXDescriptor {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}

function isDescriptor(v: unknown): v is JSXDescriptor {
  return typeof v === 'object' && v !== null && 'type' in v && 'props' in v;
}

interface SpaceAskBlockProps {
  id: string;
  descriptor: unknown;
  onSubmit: (id: string, value: unknown) => void;
  onCancel: (id: string) => void;
}

function SpaceAskBlock({ id, descriptor, onSubmit, onCancel }: SpaceAskBlockProps): React.ReactElement {
  const [textValue, setTextValue] = useState('');

  if (isDescriptor(descriptor)) {
    const SpaceComp = __SPACE_COMPONENTS__[descriptor.type];
    if (SpaceComp) {
      // Pass all props + inject onSubmit so space components can call it
      return (
        <div style={{ border: '1px solid #dee2e6', borderRadius: 4, padding: 16 }}>
          <SpaceComp
            {...descriptor.props}
            onSubmit={(value: unknown) => onSubmit(id, value)}
          />
        </div>
      );
    }
  }

  // Generic fallback: text input
  return (
    <div style={{ border: '1px solid #0d6efd', borderRadius: 4, padding: 16 }}>
      {isDescriptor(descriptor) && (
        <div style={{ marginBottom: 8, fontWeight: 500 }}>{descriptor.type}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(id, textValue); }}
          placeholder="Enter value…"
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <button
          onClick={() => onSubmit(id, textValue)}
          style={{ padding: '6px 14px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          Submit
        </button>
        <button
          onClick={() => onCancel(id)}
          style={{ padding: '6px 14px', background: '#fff', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function App(): React.ReactElement {
  const { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone } =
    useReplSession((window as unknown as Record<string, string>)['__WS_URL__'] ?? 'ws://localhost:3000');
  const [input, setInput] = useState('');
  const [started, setStarted] = useState(false);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    setStarted(true);
    sendMessage(msg);
  };

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: 20, fontSize: 12, color: isConnected ? '#198754' : '#dc3545' }}>
        {isConnected ? '● connected' : '○ connecting…'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {blocks.map((block: ReplBlock) => {
          switch (block.type) {
            case 'display':
              return <DisplayBlock key={block.id} descriptor={block.data} />;
            case 'ask':
              return (
                <SpaceAskBlock
                  key={block.id}
                  id={block.id}
                  descriptor={block.data}
                  onSubmit={submitForm}
                  onCancel={cancelAsk}
                />
              );
            case 'variables':
              return <VariablesBlock key={block.id} vars={block.data as Record<string, unknown>} />;
            case 'error':
              return (
                <div
                  key={block.id}
                  style={{ color: '#dc3545', fontFamily: 'monospace', fontSize: 13, padding: '8px 12px', background: '#fff5f5', borderRadius: 4 }}
                >
                  {String(block.data)}
                </div>
              );
            default:
              return null;
          }
        })}
      </div>

      {isDone && (
        <div style={{ marginTop: 24, color: '#6c757d', fontSize: 13 }}>Done.</div>
      )}

      {!started && isConnected && (
        <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder="What would you like to do?"
            style={{ flex: 1, padding: '8px 12px', fontSize: 14, border: '1px solid #dee2e6', borderRadius: 4 }}
          />
          <button
            onClick={handleSend}
            style={{ padding: '8px 20px', fontSize: 14, background: '#0d6efd', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
