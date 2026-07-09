import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { MediaPart, TraceAttachment, UserAttachment } from '@lmthing/core';

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

/** Max characters of a text file inlined into the prompt (guards context size). */
const TEXT_FILE_MAX_CHARS = 100_000;

/** Whether a media type is text the model can read directly (so we inline its
 *  content as text rather than sending an unreadable/unsupported file part). */
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

/** The result of turning stored uploads into delegatable attachments + metadata. */
export interface AssembledAttachments {
  /** Image/file attachments (keyed by upload id). A text agent (THING) delegates
   *  each to a vision/file agent; images/binaries carry a `part`, text files carry
   *  decoded `text`. Audio is excluded — it contributes its transcript to the text. */
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
    } else if (isTextMediaType(meta.mediaType)) {
      // Text-based documents: chat providers can't ingest a text/* file *part*
      // (text/plain even throws), so carry the decoded content as text for the
      // files agent to read.
      attachments.push({ ...base, text: Buffer.from(bytes).toString('utf8').slice(0, TEXT_FILE_MAX_CHARS) });
    } else {
      // Binary documents (PDF, etc.): NO chat model reads a raw file *part* (the
      // provider errors, the files agent then loops and returns nothing). Always
      // hand the model TEXT — the server-extracted document text when we have it,
      // else a plain note so the agent can tell the user it couldn't be read.
      const extracted = meta.text?.trim();
      const text = extracted
        ? extracted.slice(0, TEXT_FILE_MAX_CHARS)
        : `[The file "${meta.filename ?? meta.mediaType}" (${meta.mediaType}) could not be read as text on the server — its contents are unavailable.]`;
      attachments.push({ ...base, text });
    }
  }
  return { attachments, traceAttachments, transcripts };
}
