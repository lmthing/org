import { streamText, type LanguageModel, type ModelMessage } from 'ai';
import type { StreamMessage, StreamSession, StreamParams, StreamFinishReason } from '@lmthing/core';

export type { StreamSession, StreamParams };

export interface StreamOpts {
  model: LanguageModel;
  system: string;
  messages: StreamMessage[];
  /** Sampling/limit knobs for this request — see `StreamParams` in core. Absent
   *  fields are simply not sent, leaving the provider's own defaults in place. */
  params?: StreamParams;
}

// The AI SDK's `textStream` only forwards text parts and silently drops an
// 'error' part (e.g. a 429 from the provider) — the iterator just ends, which
// turn-loop.ts can't tell apart from the model finishing with no output.
// Consuming `fullStream` instead and throwing on 'error' routes provider
// failures into turn-loop's existing stream-error retry/give-up path.
// AI SDK v5: text deltas arrive as `{ type: 'text-delta', text }` (was
// `textDelta` in v4).
//
// The terminal `finish` part is the ONLY place the provider says *why* it stopped.
// Dropping it made a `finishReason: 'length'` cut — a response truncated mid-program
// by the endpoint's output cap — indistinguishable from a model that finished its
// program. `onFinish` hands it to createStream, which exposes it on the session so
// the turn loop can retry instead of settling 'done' on half a program.
export async function* textDeltaStream(
  fullStream: AsyncIterable<{ type: string; text?: string; error?: unknown; finishReason?: string }>,
  onFinish?: (reason: StreamFinishReason) => void,
): AsyncGenerator<string> {
  for await (const part of fullStream) {
    if (part.type === 'text-delta' && part.text) {
      yield part.text;
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    } else if (part.type === 'finish' && part.finishReason) {
      onFinish?.(part.finishReason as StreamFinishReason);
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
  const p = opts.params;

  const result = streamText({
    model: opts.model,
    system: opts.system,
    messages: toModelMessages(opts.messages),
    abortSignal: abortController.signal,
    // Only send what was actually asked for — an explicit `undefined` would still
    // count as "set" for some providers, and an absent key is what "provider
    // default" means. `providerOptions` is namespaced per provider, so its inner
    // shape is opaque here (core types it `Record<string, unknown>`).
    ...(p?.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p?.maxOutputTokens !== undefined ? { maxOutputTokens: p.maxOutputTokens } : {}),
    ...(p?.stopSequences !== undefined ? { stopSequences: p.stopSequences } : {}),
    ...(p?.providerOptions !== undefined
      ? { providerOptions: p.providerOptions as Parameters<typeof streamText>[0]['providerOptions'] }
      : {}),
  });

  // Mutable box the generator writes the finish part into. `session.finishReason`
  // is a getter over it, so a reader after the stream ends sees the real value
  // without ever awaiting a promise that a dropped/aborted stream never settles.
  const finish: { reason?: StreamFinishReason } = {};

  const session: StreamSession = {
    textStream: textDeltaStream(result.fullStream, (reason) => { finish.reason = reason; }),
    abort() {
      abortController.abort();
    },
    get finishReason() {
      return finish.reason;
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
  return session;
}

/** Keys `LM_STREAM_PARAMS` accepts — anything else is ignored with a warning. */
const STREAM_PARAM_KEYS = ['temperature', 'maxOutputTokens', 'stopSequences', 'providerOptions'] as const;

/**
 * Parse the `LM_STREAM_PARAMS` env var — a JSON object of `StreamParams` applied to
 * EVERY request of the process. This is the temporary, global stand-in for the
 * per-model `ModelProfile` table: once `profileFor(resolvedSpec)` exists it supplies
 * the same object per model and this env var stays as an override.
 *
 * Bad input never kills a session: an unparseable/none-object value warns and yields
 * `undefined`, and an individually invalid key warns and is dropped, leaving the rest.
 * Exported for unit testing.
 */
export function parseStreamParams(
  raw: string | undefined,
  warn: (msg: string) => void = () => {},
): StreamParams | undefined {
  if (!raw || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warn(`LM_STREAM_PARAMS: ignoring — not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warn('LM_STREAM_PARAMS: ignoring — expected a JSON object');
    return undefined;
  }
  const src = parsed as Record<string, unknown>;
  const out: StreamParams = {};

  for (const key of Object.keys(src)) {
    if (!(STREAM_PARAM_KEYS as readonly string[]).includes(key)) {
      warn(`LM_STREAM_PARAMS: ignoring unknown key "${key}" (known: ${STREAM_PARAM_KEYS.join(', ')})`);
    }
  }
  const t = src['temperature'];
  if (t !== undefined) {
    if (typeof t === 'number' && Number.isFinite(t)) out.temperature = t;
    else warn('LM_STREAM_PARAMS: ignoring "temperature" — expected a finite number');
  }
  const m = src['maxOutputTokens'];
  if (m !== undefined) {
    if (typeof m === 'number' && Number.isInteger(m) && m > 0) out.maxOutputTokens = m;
    else warn('LM_STREAM_PARAMS: ignoring "maxOutputTokens" — expected a positive integer');
  }
  const s = src['stopSequences'];
  if (s !== undefined) {
    if (Array.isArray(s) && s.every((x) => typeof x === 'string')) out.stopSequences = s as string[];
    else warn('LM_STREAM_PARAMS: ignoring "stopSequences" — expected an array of strings');
  }
  const po = src['providerOptions'];
  if (po !== undefined) {
    if (typeof po === 'object' && po !== null && !Array.isArray(po)) out.providerOptions = po as Record<string, unknown>;
    else warn('LM_STREAM_PARAMS: ignoring "providerOptions" — expected a JSON object');
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
