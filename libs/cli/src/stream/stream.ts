import { streamText, type LanguageModel } from 'ai';
import type { StreamSession } from '@lmthing/core';

export type { StreamSession };

export interface StreamOpts {
  model: LanguageModel;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
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
    textStream: result.textStream,
    abort() {
      abortController.abort();
    },
    usage: result.usage.then((u) => ({
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
    })).catch(() => ({ promptTokens: 0, completionTokens: 0 })),
  };
}
