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

export interface StreamOpts {
  system: string;
  messages: StreamMessage[];
  /** Optional model spec/alias override for this request. Forks set this from
   *  their role (see modelForRole); the provider layer resolves it, falling back
   *  to the session default when unset. */
  model?: string;
}

export interface StreamSession {
  textStream: AsyncIterable<string>;
  abort(): void;
  /** Resolves with token usage after the stream finishes. Optional — providers
   *  that don't support it simply omit this field. */
  usage?: Promise<{ promptTokens: number; completionTokens: number }>;
}
