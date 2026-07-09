import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { MediaPart, TraceAttachment, UserAttachment, ReadDocumentResult } from '@lmthing/core';

/** The kind of a user attachment, derived from its IANA media type. Audio is
 *  transcribed to text server-side; images/files are passed to vision/doc models. */
export type AttachmentKind = 'image' | 'audio' | 'file';

/** Persisted metadata for a stored upload (sidecar `<id>.json`). */
export interface UploadMeta {
  id: string;
  kind: AttachmentKind;
  mediaType: string;
  filename?: string;
  /** Transcript text for audio uploads (what the model actually receives). */
  transcript?: string;
  /** Extracted plain text for a binary DOCUMENT (e.g. a PDF) whose bytes a text
   *  model can't ingest as a file part. Populated best-effort at upload time so
   *  the files agent reads real text instead of an unreadable binary part. */
  text?: string;
}

/** What the upload endpoint returns and the chat client sends back on
 *  `sendMessage`. `url` serves the raw bytes for UI rendering. */
export interface AttachmentRef extends UploadMeta {
  url: string;
}

export function classifyKind(mediaType: string): AttachmentKind {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Whether a media type is plain text the host can decode as utf8 directly (vs.
 *  needing a binary extractor like unpdf). Used by the readDocument resolver. */
export function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith('text/') ||
    /(json|xml|yaml|csv|javascript|typescript|markdown|x-sh|toml)/i.test(mediaType)
  );
}

/** Best-effort extract plain text from a binary document so a text model can
 *  read it. Currently handles PDFs (via `unpdf`, lazily imported so it never
 *  costs anything unless a PDF is actually uploaded). Returns undefined when the
 *  type is unsupported or extraction yields nothing (scanned/image-only PDFs). */
export async function extractDocumentText(mediaType: string, bytes: Uint8Array): Promise<string | undefined> {
  if (mediaType !== 'application/pdf') return undefined;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const joined = (Array.isArray(text) ? text.join('\n') : text).trim();
    return joined.length > 0 ? joined : undefined;
  } catch {
    // Corrupt/encrypted/unsupported PDF — fall back to the "unreadable" note.
    return undefined;
  }
}

/** Resolve the uploads directory under the runtime root (falls back to cwd when
 *  the manager is not in project mode). */
export function resolveUploadsDir(root?: string): string {
  return join(root ?? process.cwd(), 'uploads');
}

/** randomUUID shape — the only id form we generate and will read back. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSafeUploadId(id: string): boolean {
  return ID_RE.test(id);
}

/** The public URL an attachment id is served at. */
export function uploadUrl(id: string): string {
  return `/api/uploads/${id}`;
}

export async function saveUpload(
  uploadsDir: string,
  input: { bytes: Uint8Array; mediaType: string; filename?: string; transcript?: string; text?: string },
): Promise<UploadMeta> {
  await mkdir(uploadsDir, { recursive: true });
  const id = randomUUID();
  const meta: UploadMeta = {
    id,
    kind: classifyKind(input.mediaType),
    mediaType: input.mediaType,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.transcript ? { transcript: input.transcript } : {}),
    ...(input.text ? { text: input.text } : {}),
  };
  await writeFile(join(uploadsDir, id), input.bytes);
  await writeFile(join(uploadsDir, `${id}.json`), JSON.stringify(meta), 'utf8');
  return meta;
}

export async function readUploadMeta(uploadsDir: string, id: string): Promise<UploadMeta | null> {
  if (!isSafeUploadId(id)) return null;
  try {
    return JSON.parse(await readFile(join(uploadsDir, `${id}.json`), 'utf8')) as UploadMeta;
  } catch {
    return null;
  }
}

export async function readUploadBytes(uploadsDir: string, id: string): Promise<Uint8Array | null> {
  if (!isSafeUploadId(id)) return null;
  try {
    return await readFile(join(uploadsDir, id));
  } catch {
    return null;
  }
}

/** Default cap for the text `readDocument` returns to an agent (guards context size). */
const READ_DOCUMENT_MAX_CHARS = 100_000;

/**
 * Host implementation of the `readDocument` global (the {@link DocumentResolver}):
 * extract a stored upload's content from the uploads dir — audio → transcript,
 * text media → utf8, PDF → unpdf-extracted text, everything else → unsupported.
 * Server-authoritative: only the id is trusted; bytes/metadata are re-read from
 * disk. Never throws — a bad id / unsupported type resolves to a `kind:'unsupported'`
 * result the agent can relay. Text is capped at `opts.maxChars` (default 100k).
 */
export async function resolveUploadDocument(
  uploadsDir: string,
  attachmentId: string,
  opts?: { maxChars?: number },
): Promise<ReadDocumentResult> {
  const maxChars = opts?.maxChars ?? READ_DOCUMENT_MAX_CHARS;
  if (!isSafeUploadId(attachmentId)) {
    return { ok: false, attachmentId, mediaType: '', kind: 'unsupported', error: 'invalid attachment id' };
  }
  const meta = await readUploadMeta(uploadsDir, attachmentId);
  if (!meta) {
    return { ok: false, attachmentId, mediaType: '', kind: 'unsupported', error: 'attachment not found' };
  }
  const common = { attachmentId, mediaType: meta.mediaType, ...(meta.filename ? { filename: meta.filename } : {}) };
  // Audio is transcribed at upload time — hand back the transcript as text.
  if (meta.kind === 'audio') {
    return { ok: true, ...common, kind: 'text', text: meta.transcript ?? '' };
  }
  // Images belong to the vision specialist, not the document reader.
  if (meta.kind === 'image') {
    return { ok: false, ...common, kind: 'unsupported', error: 'image — use system-vision instead' };
  }
  const bytes = await readUploadBytes(uploadsDir, attachmentId);
  if (!bytes) {
    return { ok: false, ...common, kind: 'unsupported', error: 'attachment bytes not found' };
  }
  // Plain-text media: decode utf8 directly (capped). Guard against the OOXML/office
  // container family (docx/xlsx/…), whose media types contain the substring "xml"
  // and so slip past the loose isTextMediaType check even though they are binary zips.
  const isBinaryOffice = /officedocument|opendocument|ms-excel|msword|ms-powerpoint/i.test(meta.mediaType);
  if (isTextMediaType(meta.mediaType) && !isBinaryOffice) {
    const full = Buffer.from(bytes).toString('utf8');
    const text = full.slice(0, maxChars);
    return { ok: true, ...common, kind: 'text', text, ...(full.length > maxChars ? { truncated: true } : {}) };
  }
  // PDF: extract text via unpdf (reused from the upload path).
  if (meta.mediaType === 'application/pdf') {
    const extracted = await extractDocumentText('application/pdf', bytes);
    if (extracted && extracted.trim()) {
      const text = extracted.slice(0, maxChars);
      return { ok: true, ...common, kind: 'text', text, ...(extracted.length > maxChars ? { truncated: true } : {}) };
    }
    return { ok: false, ...common, kind: 'unsupported', error: 'no extractable text (likely a scanned/image-only PDF)' };
  }
  // Everything else (docx/xlsx/other binary) is not yet supported host-side.
  return { ok: false, ...common, kind: 'unsupported', error: `file type not yet supported: ${meta.mediaType}` };
}

/** The result of turning stored uploads into delegatable attachments + metadata. */
export interface AssembledAttachments {
  /** Image/file attachments (keyed by upload id). A text agent (THING) delegates
   *  each to a vision/file agent; images carry a `part`, files carry only their id
   *  (read on demand via readDocument). Audio is excluded — it contributes its
   *  transcript to the text. */
  attachments: UserAttachment[];
  /** Attachment metadata (with served urls) for the `user_message` trace event. */
  traceAttachments: TraceAttachment[];
  /** Transcribed-AUDIO blocks to append to the user's text (audio → text → THING). */
  transcripts: string[];
}

/** Pure transform: given each requested upload's metadata + bytes (bytes null
 *  for audio, which needs none), build the delegatable attachment list, the
 *  trace-facing attachment list, and the audio transcript blocks. Missing
 *  metadata entries are skipped. Kept free of I/O so it is fully unit-testable. */
export function assembleParts(
  items: Array<{ meta: UploadMeta | null; bytes: Uint8Array | null }>,
): AssembledAttachments {
  const attachments: UserAttachment[] = [];
  const traceAttachments: TraceAttachment[] = [];
  const transcripts: string[] = [];
  for (const { meta, bytes } of items) {
    if (!meta) continue;
    traceAttachments.push({
      kind: meta.kind,
      url: uploadUrl(meta.id),
      mediaType: meta.mediaType,
      ...(meta.filename ? { filename: meta.filename } : {}),
      ...(meta.transcript ? { transcript: meta.transcript } : {}),
    });
    if (meta.kind === 'audio') {
      // Audio is transcribed to text upstream and handled by the text model directly.
      if (meta.transcript) transcripts.push(`[Transcript of ${meta.filename ?? 'audio'}]:\n${meta.transcript}`);
      continue;
    }
    if (!bytes) continue;
    const base = { id: meta.id, kind: meta.kind, mediaType: meta.mediaType, ...(meta.filename ? { filename: meta.filename } : {}) };
    if (meta.kind === 'image') {
      const dataUrl = `data:${meta.mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
      attachments.push({ ...base, part: { type: 'image', image: dataUrl, mediaType: meta.mediaType } });
    } else {
      // Files (text, pdf, docx, xlsx, …): carry ONLY the id + metadata — no bytes,
      // no inlined text, no file part. The delegated files agent fetches the
      // content itself via `readDocument(id)`, which extracts it host-side (unpdf
      // for PDF, utf8 for text). This keeps THING's context small and routes ALL
      // files through one uniform, agent-driven extraction path.
      attachments.push({ ...base });
    }
  }
  return { attachments, traceAttachments, transcripts };
}
