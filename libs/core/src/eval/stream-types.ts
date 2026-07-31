/** A non-text attachment on a user message.
 *
 *  To support vision (images) and documents (PDFs, etc.), a user message can
 *  carry attachments alongside its text `content`. Field names mirror the AI SDK
 *  v5 user-message content parts: images/files carry a `mediaType` (IANA type,
 *  e.g. `image/png`, `application/pdf`). Audio is transcribed to text upstream
 *  (see the server upload handler), so it never appears as an attachment here.
 *  The provider layer (`libs/cli/src/stream/stream.ts`) merges `content` +
 *  `attachments` into the SDK's `ModelMessage` content.
 */
export interface ImagePart {
  type: 'image';
  /** A URL, a `data:` URL, or a raw base64 string of the image bytes. */
  image: string;
  /** IANA media type, e.g. `image/png`. Optional — the provider can sniff it. */
  mediaType?: string;
}
export interface FilePart {
  type: 'file';
  /** A URL, a `data:` URL, or a raw base64 string of the file bytes. */
  data: string;
  /** IANA media type, e.g. `application/pdf`. Required by the SDK for files. */
  mediaType: string;
  /** Original filename, surfaced to the model when the provider supports it. */
  filename?: string;
}
export type MediaPart = ImagePart | FilePart;

export interface StreamMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Multimodal attachments (images/files) for this message. Only user messages
   *  carry these; the provider layer merges them with `content`. */
  attachments?: MediaPart[];
}

/** Per-request provider knobs (sampling + output cap), passed straight through to
 *  the provider call. The runtime is 100% code emission, so these are not cosmetic:
 *  a low `temperature` and an explicit `maxOutputTokens` bound both the quality and
 *  the cost of a turn — the loop aborts the stream on every yield/typecheck/eval
 *  error, and a cheap OpenAI-compatible endpoint often keeps generating (and
 *  billing) after the socket drops.
 *
 *  Field names mirror the AI SDK v5 `CallSettings` shape (`maxOutputTokens`, not
 *  v4's `maxTokens`), so the provider layer can spread them verbatim.
 *
 *  Nothing populates this from a per-model table yet — that is the `ModelProfile`
 *  seam. Today the CLI fills it from the `LM_STREAM_PARAMS` env var
 *  (`parseStreamParams` in `libs/cli/src/stream/stream.ts`); a future
 *  `profileFor(resolvedSpec)` slots in at the same place. */
export interface StreamParams {
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  /** Provider-namespaced extras, e.g. `{ openai: { reasoningEffort: 'low' } }`. */
  providerOptions?: Record<string, unknown>;
}

/** Why the provider stopped generating. Mirrors the AI SDK v5 `FinishReason`
 *  union; `'length'` means the response hit the output cap and is TRUNCATED. */
export type StreamFinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error'
  | 'other'
  | 'unknown';

export interface StreamOpts {
  system: string;
  messages: StreamMessage[];
  /** Optional model spec/alias override for this request. Forks set this from
   *  their role (see modelForRole); the provider layer resolves it, falling back
   *  to the session default when unset. */
  model?: string;
  /** Optional sampling/limit knobs for this request. The provider layer spreads
   *  them into the model call; omitted fields keep the provider's defaults. */
  params?: StreamParams;
}

export interface StreamSession {
  textStream: AsyncIterable<string>;
  abort(): void;
  /** Resolves with token usage after the stream finishes. Optional — providers
   *  that don't support it simply omit this field. */
  usage?: Promise<{ promptTokens: number; completionTokens: number }>;
  /** Why the provider stopped, captured from the stream's terminal `finish` part.
   *  Unlike `usage` this is NOT a promise: it is set synchronously while the
   *  textStream is consumed, so it is readable the instant the iterator ends and
   *  can never hang the turn. It stays `undefined` when the stream was aborted
   *  (no `finish` part arrives) or when the provider omits the field. Read it only
   *  AFTER the textStream is exhausted. The turn loop treats `'length'` as a
   *  truncation — a retryable stream-level failure, not a completion. */
  finishReason?: StreamFinishReason;
}
