import type { YieldRequest } from '../eval/yield.js';

/**
 * The result of a `readDocument()` call — the host-extracted content of a stored
 * upload. `kind:'text'` carries the decoded/extracted `text`; `kind:'unsupported'`
 * carries a human-readable `error` explaining why (image, scanned PDF, unhandled
 * binary type, missing/invalid id). Mirrors the shape of a ConnectionResponse: a
 * plain, serializable object the sandbox can branch on.
 */
export interface ReadDocumentResult {
  ok: boolean;
  attachmentId: string;
  mediaType: string;
  filename?: string;
  kind: 'text' | 'unsupported';
  /** Extracted/decoded document text (present when kind==='text'). */
  text?: string;
  /** Set when the text was capped at `opts.maxChars`. */
  truncated?: boolean;
  /** Present when !ok or kind==='unsupported'. */
  error?: string;
}

/**
 * Resolve a `readDocument()` yield — extract a stored upload's content in Node
 * (unpdf for PDF, utf8 passthrough for text/csv, transcript for audio). Host-
 * supplied (libs/cli, where the uploads dir is known); absent outside a pod/CLI
 * with an uploads dir, in which case a `readDocument` yield rejects with a clear,
 * retryable error. Exactly the ConnectionResolver pattern, but for local uploads.
 * @param attachmentId The upload id from the user message's attachment list.
 * @param opts         `maxChars` caps the returned text (default 100_000).
 */
export type DocumentResolver = (
  attachmentId: string,
  opts?: { maxChars?: number },
) => Promise<ReadDocumentResult>;

/**
 * Create the `readDocument` global — the agent/space-function entry to a stored
 * upload's text. Value-yielding, exactly like `callConnection`/`fetch`: it ends
 * the current turn and resumes once the host resolver reads + extracts the file.
 * Injected UNIVERSALLY (like `fetch`, never gated) so any agent/fork/delegate can
 * read an attachment by id. The host resolver is threaded through the yield router
 * (`YieldRouterContext.documentResolver`); if absent (no uploads dir configured)
 * the yield rejects with a clear, retryable error rather than binding undefined.
 *
 * The bytes never enter the sandbox: the sandbox supplies only the `attachmentId`
 * (+ optional `maxChars`); the host reads the file from the uploads dir and hands
 * back the extracted text.
 */
export function createReadDocumentGlobal(
  pushYield: (req: YieldRequest) => void,
): (attachmentId: string, opts?: { maxChars?: number }) => Promise<ReadDocumentResult> {
  return function readDocument(
    attachmentId: string,
    opts?: { maxChars?: number },
  ): Promise<ReadDocumentResult> {
    return new Promise<ReadDocumentResult>((resolve, reject) => {
      pushYield({
        kind: 'readDocument',
        args: [attachmentId, opts],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
