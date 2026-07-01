import { describe, it, expect } from 'vitest';
import { textDeltaStream } from './stream.js';

async function* partsOf(parts: Array<{ type: string; textDelta?: string; error?: unknown }>) {
  for (const p of parts) yield p;
}

describe('textDeltaStream', () => {
  it('yields text-delta parts as plain strings', async () => {
    const out: string[] = [];
    for await (const chunk of textDeltaStream(partsOf([
      { type: 'text-delta', textDelta: 'hello ' },
      { type: 'text-delta', textDelta: 'world' },
      { type: 'finish' },
    ]))) {
      out.push(chunk);
    }
    expect(out).toEqual(['hello ', 'world']);
  });

  it('throws when the underlying stream reports an error part instead of silently ending', async () => {
    const iterator = textDeltaStream(partsOf([
      { type: 'text-delta', textDelta: 'partial' },
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
