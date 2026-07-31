import { describe, it, expect } from 'vitest';
import { textDeltaStream, toModelMessages, createStream, parseStreamParams } from './stream.js';
import type { StreamMessage } from '@lmthing/core';
import type { LanguageModel } from 'ai';

async function* partsOf(parts: Array<{ type: string; text?: string; error?: unknown; finishReason?: string }>) {
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

  it('hands the terminal finish part\'s finishReason to the callback', async () => {
    const seen: string[] = [];
    for await (const _ of textDeltaStream(
      partsOf([{ type: 'text-delta', text: 'half a stat' }, { type: 'finish', finishReason: 'length' }]),
      (r) => seen.push(r),
    )) { /* drain */ }
    expect(seen).toEqual(['length']);
  });

  it('does not invoke the callback when the stream ends with no finish part (abort)', async () => {
    const seen: string[] = [];
    for await (const _ of textDeltaStream(partsOf([{ type: 'text-delta', text: 'x' }]), (r) => seen.push(r))) { /* drain */ }
    expect(seen).toEqual([]);
  });
});

/** A minimal AI SDK v5 (LanguageModelV2) provider: records the call options it was
 *  given and replays a canned stream. Exercises the REAL streamText path, so the
 *  assertions below prove params actually reach the provider — not just our object. */
function fakeModel(
  parts: Array<Record<string, unknown>>,
  capture: (opts: Record<string, unknown>) => void,
): LanguageModel {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'fake-model',
    supportedUrls: {},
    doStream: async (options: Record<string, unknown>) => {
      capture(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModel;
}

const okParts = (finishReason = 'stop'): Array<Record<string, unknown>> => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: '1' },
  { type: 'text-delta', id: '1', delta: 'display("hi");' },
  { type: 'text-end', id: '1' },
  { type: 'finish', finishReason, usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
];

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
}

describe('createStream — params plumbing', () => {
  it('passes temperature / maxOutputTokens / stopSequences / providerOptions to the provider call', async () => {
    let seen: Record<string, unknown> = {};
    const model = fakeModel(okParts(), (o) => { seen = o; });

    const session = await createStream({
      model,
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      params: {
        temperature: 0.2,
        maxOutputTokens: 3000,
        stopSequences: ['\n\n###'],
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
    });
    expect(await drain(session.textStream)).toBe('display("hi");');

    expect(seen['temperature']).toBe(0.2);
    expect(seen['maxOutputTokens']).toBe(3000);
    expect(seen['stopSequences']).toEqual(['\n\n###']);
    expect(seen['providerOptions']).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('sends nothing (provider defaults stand) when params are omitted or partial', async () => {
    let seen: Record<string, unknown> = {};
    const model = fakeModel(okParts(), (o) => { seen = o; });

    const bare = await createStream({ model, system: 'sys', messages: [{ role: 'user', content: 'go' }] });
    await drain(bare.textStream);
    expect(seen['temperature']).toBeUndefined();
    expect(seen['maxOutputTokens']).toBeUndefined();
    expect(seen['stopSequences']).toBeUndefined();

    const partial = await createStream({
      model, system: 'sys', messages: [{ role: 'user', content: 'go' }],
      params: { maxOutputTokens: 512 },
    });
    await drain(partial.textStream);
    expect(seen['maxOutputTokens']).toBe(512);
    expect(seen['temperature']).toBeUndefined();
  });
});

describe('createStream — finishReason surfacing', () => {
  it('exposes the provider finishReason on the session once the stream is drained', async () => {
    const session = await createStream({
      model: fakeModel(okParts('length'), () => {}),
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
    });
    expect(session.finishReason).toBeUndefined(); // not known until the stream ends
    await drain(session.textStream);
    expect(session.finishReason).toBe('length');
  });

  it('reports a normal stop as `stop`', async () => {
    const session = await createStream({
      model: fakeModel(okParts('stop'), () => {}),
      system: 'sys',
      messages: [{ role: 'user', content: 'go' }],
    });
    await drain(session.textStream);
    expect(session.finishReason).toBe('stop');
  });
});

describe('parseStreamParams (LM_STREAM_PARAMS)', () => {
  const warnings = (): { warn: (m: string) => void; msgs: string[] } => {
    const msgs: string[] = [];
    return { warn: (m) => msgs.push(m), msgs };
  };

  it('returns undefined for unset/blank input', () => {
    expect(parseStreamParams(undefined)).toBeUndefined();
    expect(parseStreamParams('   ')).toBeUndefined();
  });

  it('parses a full object', () => {
    expect(parseStreamParams('{"temperature":0.2,"maxOutputTokens":3000,"stopSequences":["#"],"providerOptions":{"openai":{"x":1}}}'))
      .toEqual({ temperature: 0.2, maxOutputTokens: 3000, stopSequences: ['#'], providerOptions: { openai: { x: 1 } } });
  });

  it('warns and ignores invalid JSON instead of throwing', () => {
    const { warn, msgs } = warnings();
    expect(parseStreamParams('{not json', warn)).toBeUndefined();
    expect(msgs[0]).toContain('not valid JSON');
  });

  it('warns and ignores a non-object payload', () => {
    const { warn, msgs } = warnings();
    expect(parseStreamParams('[1,2]', warn)).toBeUndefined();
    expect(msgs[0]).toContain('expected a JSON object');
  });

  it('drops individually invalid keys but keeps the valid ones', () => {
    const { warn, msgs } = warnings();
    const out = parseStreamParams('{"temperature":"hot","maxOutputTokens":0,"stopSequences":[1],"providerOptions":3}', warn);
    expect(out).toBeUndefined(); // nothing survived
    expect(msgs.join('\n')).toContain('temperature');
    expect(msgs.join('\n')).toContain('maxOutputTokens');
    expect(msgs.join('\n')).toContain('stopSequences');
    expect(msgs.join('\n')).toContain('providerOptions');

    const { warn: w2 } = warnings();
    expect(parseStreamParams('{"temperature":0.1,"maxOutputTokens":-5}', w2)).toEqual({ temperature: 0.1 });
  });

  it('warns about unknown keys and ignores them', () => {
    const { warn, msgs } = warnings();
    expect(parseStreamParams('{"maxTokens":100,"temperature":0}', warn)).toEqual({ temperature: 0 });
    expect(msgs[0]).toContain('unknown key "maxTokens"');
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
