import { streamText, type LanguageModel } from 'ai';
import type { StreamSession } from '@lmthing/core';

export type { StreamSession };

export interface StreamOpts {
  model: LanguageModel;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ai@4's `textStream` only forwards 'text-delta' parts and silently drops an
// 'error' part (e.g. a 429 from the provider) — the iterator just ends, which
// turn-loop.ts can't tell apart from the model finishing with no output.
// Consuming `fullStream` instead and throwing on 'error' routes provider
// failures into turn-loop's existing stream-error retry/give-up path.
export async function* textDeltaStream(
  fullStream: AsyncIterable<{ type: string; textDelta?: string; error?: unknown }>,
): AsyncGenerator<string> {
  for await (const part of fullStream) {
    if (part.type === 'text-delta' && part.textDelta) {
      yield part.textDelta;
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
}

export async function createStream(opts: StreamOpts): Promise<StreamSession> {
  const abortController = new AbortController();

  const result = await streamText({
    model: opts.model,
    system: opts.system,
    messages: opts.messages,
    abortSignal: abortController.signal,
  });

  return {
    textStream: textDeltaStream(result.fullStream),
    abort() {
      abortController.abort();
    },
    usage: result.usage.then((u) => ({
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
    })).catch(() => ({ promptTokens: 0, completionTokens: 0 })),
  };
}
