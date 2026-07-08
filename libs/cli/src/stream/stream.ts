import { streamText, type LanguageModel, type ModelMessage } from 'ai';
import type { StreamMessage, StreamSession } from '@lmthing/core';

export type { StreamSession };

export interface StreamOpts {
  model: LanguageModel;
  system: string;
  messages: StreamMessage[];
}

// The AI SDK's `textStream` only forwards text parts and silently drops an
// 'error' part (e.g. a 429 from the provider) — the iterator just ends, which
// turn-loop.ts can't tell apart from the model finishing with no output.
// Consuming `fullStream` instead and throwing on 'error' routes provider
// failures into turn-loop's existing stream-error retry/give-up path.
// AI SDK v5: text deltas arrive as `{ type: 'text-delta', text }` (was
// `textDelta` in v4).
export async function* textDeltaStream(
  fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
): AsyncGenerator<string> {
  for await (const part of fullStream) {
    if (part.type === 'text-delta' && part.text) {
      yield part.text;
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
}

/** Map our internal messages to the AI SDK v5 `ModelMessage` shape. Assistant
 *  turns are model-produced text. A user turn with attachments is emitted as a
 *  content-parts array: the text first, then each image/file part.
 *  Exported for unit testing. */
export function toModelMessages(messages: StreamMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content };
    }
    if (!m.attachments || m.attachments.length === 0) {
      return { role: 'user', content: m.content };
    }
    return {
      role: 'user',
      content: [
        { type: 'text' as const, text: m.content },
        ...m.attachments.map((p) => {
          if (p.type === 'image') {
            return {
              type: 'image' as const,
              image: p.image,
              ...(p.mediaType ? { mediaType: p.mediaType } : {}),
            };
          }
          return {
            type: 'file' as const,
            data: p.data,
            mediaType: p.mediaType,
            ...(p.filename ? { filename: p.filename } : {}),
          };
        }),
      ],
    };
  });
}

export async function createStream(opts: StreamOpts): Promise<StreamSession> {
  const abortController = new AbortController();

  const result = streamText({
    model: opts.model,
    system: opts.system,
    messages: toModelMessages(opts.messages),
    abortSignal: abortController.signal,
  });

  return {
    textStream: textDeltaStream(result.fullStream),
    abort() {
      abortController.abort();
    },
    // AI SDK v5 renamed usage fields: promptTokens/completionTokens →
    // inputTokens/outputTokens. Map back to the core contract.
    usage: result.usage
      .then((u) => ({
        promptTokens: u.inputTokens ?? 0,
        completionTokens: u.outputTokens ?? 0,
      }))
      .catch(() => ({ promptTokens: 0, completionTokens: 0 })),
  };
}
