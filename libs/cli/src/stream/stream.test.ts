import { describe, it, expect } from 'vitest';
import { textDeltaStream, toModelMessages } from './stream.js';
import type { StreamMessage } from '@lmthing/core';

async function* partsOf(parts: Array<{ type: string; text?: string; error?: unknown }>) {
  for (const p of parts) yield p;
}

describe('textDeltaStream', () => {
  it('yields text-delta parts as plain strings (AI SDK v5 `.text`)', async () => {
    const out: string[] = [];
    for await (const chunk of textDeltaStream(partsOf([
      { type: 'text-delta', text: 'hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'finish' },
    ]))) {
      out.push(chunk);
    }
    expect(out).toEqual(['hello ', 'world']);
  });

  it('throws when the underlying stream reports an error part instead of silently ending', async () => {
    const iterator = textDeltaStream(partsOf([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', error: new Error('429: rate limit exceeded') },
    ]))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: 'partial', done: false });
    await expect(iterator.next()).rejects.toThrow('429: rate limit exceeded');
  });

  it('wraps a non-Error error value', async () => {
    const iterator = textDeltaStream(partsOf([
      { type: 'error', error: 'plain string failure' },
    ]))[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow('plain string failure');
  });
});

describe('toModelMessages (AI SDK v5 mapping)', () => {
  it('passes plain string content through for both roles', () => {
    const msgs: StreamMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    expect(toModelMessages(msgs)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('emits a content-parts array when a user message has image/file attachments', () => {
    const msgs: StreamMessage[] = [
      {
        role: 'user',
        content: 'what is this?',
        attachments: [
          { type: 'image', image: 'data:image/png;base64,AAA', mediaType: 'image/png' },
          { type: 'file', data: 'data:application/pdf;base64,BBB', mediaType: 'application/pdf', filename: 'doc.pdf' },
        ],
      },
    ];
    const [m] = toModelMessages(msgs);
    expect(m!.role).toBe('user');
    expect(m!.content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', image: 'data:image/png;base64,AAA', mediaType: 'image/png' },
      { type: 'file', data: 'data:application/pdf;base64,BBB', mediaType: 'application/pdf', filename: 'doc.pdf' },
    ]);
  });

  it('omits optional fields when absent', () => {
    const msgs: StreamMessage[] = [
      { role: 'user', content: 'x', attachments: [{ type: 'image', image: 'u' }] },
    ];
    const [m] = toModelMessages(msgs);
    expect(m!.content).toEqual([
      { type: 'text', text: 'x' },
      { type: 'image', image: 'u' },
    ]);
  });

  it('does not wrap a user message with an empty attachments array', () => {
    const msgs: StreamMessage[] = [{ role: 'user', content: 'plain', attachments: [] }];
    expect(toModelMessages(msgs)).toEqual([{ role: 'user', content: 'plain' }]);
  });
});
