import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { MediaPart, TraceAttachment } from '@lmthing/core';

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
  input: { bytes: Uint8Array; mediaType: string; filename?: string; transcript?: string },
): Promise<UploadMeta> {
  await mkdir(uploadsDir, { recursive: true });
  const id = randomUUID();
  const meta: UploadMeta = {
    id,
    kind: classifyKind(input.mediaType),
    mediaType: input.mediaType,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.transcript ? { transcript: input.transcript } : {}),
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

/** The result of turning stored uploads into model input + UI-facing metadata. */
export interface AssembledAttachments {
  /** Image/file parts to attach to the model message. Audio is excluded — it
   *  contributes its transcript to the text instead. */
  mediaParts: MediaPart[];
  /** Attachment metadata (with served urls) for the `user_message` trace event. */
  traceAttachments: TraceAttachment[];
  /** Transcribed-audio blocks to append to the user's text. */
  transcripts: string[];
}

/** Pure transform: given each requested upload's metadata + bytes (bytes null
 *  for audio, which needs none), build the model parts, the trace-facing
 *  attachment list, and the transcript text blocks. Missing metadata entries are
 *  skipped. Kept free of I/O so it is fully unit-testable. */
export function assembleParts(
  items: Array<{ meta: UploadMeta | null; bytes: Uint8Array | null }>,
): AssembledAttachments {
  const mediaParts: MediaPart[] = [];
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
      if (meta.transcript) transcripts.push(`[Transcript of ${meta.filename ?? 'audio'}]:\n${meta.transcript}`);
      continue;
    }
    if (!bytes) continue;
    const dataUrl = `data:${meta.mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
    if (meta.kind === 'image') {
      mediaParts.push({ type: 'image', image: dataUrl, mediaType: meta.mediaType });
    } else {
      mediaParts.push({ type: 'file', data: dataUrl, mediaType: meta.mediaType, ...(meta.filename ? { filename: meta.filename } : {}) });
    }
  }
  return { mediaParts, traceAttachments, transcripts };
}
