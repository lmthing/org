import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
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
  /** Derived page-image upload ids for a SCANNED PDF — one per page (capped).
   *  A scan has no text layer, so `text` is empty and `readDocument` can only say
   *  "unsupported": without these the file is a DEAD END, since it is routed as a
   *  document and a document carries no image part for a vision model to look at.
   *  Each page is stored as a real image upload, so it flows down the ordinary
   *  image → vision path and can be handed to a specialist by id like any other. */
  pages?: string[];
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

/** Cap on how many pages of a scanned PDF are rasterized for vision. Each page becomes
 *  a real image upload the model may look at, so this bounds both disk and tokens. */
const MAX_SCANNED_PDF_PAGES = 5;
/** Ignore embedded images smaller than this on a side — a logo/rule/artifact, not a page. */
const MIN_PAGE_IMAGE_PX = 200;

/** Encode raw pixels as a PNG. Zero-dependency: PNG is just zlib-deflated scanlines
 *  (each prefixed with filter byte 0) wrapped in IHDR/IDAT/IEND chunks, and Node ships
 *  zlib. This is what lets a scanned page reach a vision model without pulling a native
 *  canvas/image codec into the pod image. */
function encodePng(data: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const colorType = channels === 1 ? 0 : channels === 4 ? 6 : 2; // gray | RGBA | RGB
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = y * width * channels;
    const dst = y * (width * channels + 1);
    raw[dst] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + src, width * channels).copy(raw, dst + 1);
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Rasterize a SCANNED pdf's pages to PNGs. A scanned page is not "text we failed to
 * read" — it is a photograph wrapped in a PDF, so the page content IS an embedded
 * image and `extractImages` hands it straight back (no canvas renderer, no native dep).
 * Returns [] for a PDF that is genuinely text (nothing to rasterize) or unreadable.
 */
export async function extractPdfPageImages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  try {
    const { extractImages, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pageCount = Math.min(pdf.numPages ?? 1, MAX_SCANNED_PDF_PAGES);
    for (let p = 1; p <= pageCount; p++) {
      const images = await extractImages(pdf, p).catch(() => []);
      for (const img of images) {
        const { data, width, height, channels } = img as unknown as {
          data: Uint8Array; width: number; height: number; channels: number;
        };
        if (!data || width < MIN_PAGE_IMAGE_PX || height < MIN_PAGE_IMAGE_PX) continue;
        if (data.length < width * height * channels) continue; // truncated/odd encoding — skip
        out.push(encodePng(data, width, height, channels));
        break; // one image per page: the page itself
      }
    }
  } catch {
    // Corrupt/encrypted PDF, or an encoding we cannot decode — the caller falls back
    // to the "unsupported" note, exactly as before.
  }
  return out;
}

/** Spreadsheet-family media types / extensions SheetJS can parse (Excel, ODS, CSV,
 *  TSV). Detected by mediaType OR filename since browsers often send a generic
 *  `application/octet-stream` for `.ods`/`.csv`. */
function isSpreadsheet(mediaType: string, filename?: string): boolean {
  if (/spreadsheet|ms-excel|excel|officedocument\.spreadsheetml|csv|tab-separated/i.test(mediaType)) return true;
  return /\.(xlsx|xls|xlsm|ods|csv|tsv)$/i.test(filename ?? '');
}

/** Best-effort extract a spreadsheet's data as text — every sheet rendered to CSV
 *  (prefixed with its name when there is more than one), via SheetJS (`xlsx`,
 *  lazily imported; external in tsup, ships in node_modules). Reads Excel
 *  (.xlsx/.xls), OpenDocument (.ods), and delimited (.csv/.tsv) uniformly.
 *  Returns undefined when the workbook can't be parsed or has no cells. */
export async function extractSpreadsheetText(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(bytes, { type: 'buffer' });
    const names = wb.SheetNames ?? [];
    if (names.length === 0) return undefined;
    const parts = names.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]!).trim();
      if (!csv) return '';
      return names.length > 1 ? `# Sheet: ${name}\n${csv}` : csv;
    });
    const joined = parts.filter(Boolean).join('\n\n').trim();
    return joined.length > 0 ? joined : undefined;
  } catch {
    return undefined;
  }
}

/** Office-document media types / extensions officeparser extracts to text — Word
 *  (`docx`), PowerPoint (`pptx`), and their OpenDocument counterparts (`odt`/`odp`).
 *  Spreadsheets (`xlsx`/`ods`) are deliberately excluded (SheetJS handles them with
 *  proper tabular structure) as is PDF (unpdf). Detected by mediaType OR filename
 *  since browsers often send a generic `application/octet-stream`. */
function isOfficeDocument(mediaType: string, filename?: string): boolean {
  if (
    /officedocument\.(wordprocessingml|presentationml)|opendocument\.(text|presentation)|msword|ms-powerpoint/i.test(
      mediaType,
    )
  )
    return true;
  return /\.(docx|doc|pptx|ppt|odt|odp)$/i.test(filename ?? '');
}

/** Best-effort extract an office document's text via officeparser (`officeparser`,
 *  lazily imported; external in tsup, ships in node_modules). Reads Word (.docx),
 *  PowerPoint (.pptx), and OpenDocument text/presentation (.odt/.odp) from the raw
 *  bytes in-memory (yauzl — no temp files). Returns undefined when the document
 *  can't be parsed or yields no text (e.g. an empty or image-only file). */
export async function extractOfficeText(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const { parseOfficeAsync } = await import('officeparser');
    const text = (await parseOfficeAsync(Buffer.from(bytes))).trim();
    return text.length > 0 ? text : undefined;
  } catch {
    // Corrupt / password-protected / unsupported legacy binary (.doc/.ppt) — fall
    // back to the "unsupported" note rather than throwing.
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
  input: {
    bytes: Uint8Array; mediaType: string; filename?: string;
    transcript?: string; text?: string; pages?: string[];
  },
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
    ...(input.pages && input.pages.length > 0 ? { pages: input.pages } : {}),
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
  // Spreadsheet family (Excel/ODS/CSV/TSV) → SheetJS renders every sheet to CSV.
  // Checked BEFORE the text branch so a binary .xlsx/.ods isn't utf8-garbled, and
  // so a .csv sent as octet-stream is still parsed rather than falling to unsupported.
  if (isSpreadsheet(meta.mediaType, meta.filename)) {
    const extracted = await extractSpreadsheetText(bytes);
    if (extracted && extracted.trim()) {
      const text = extracted.slice(0, maxChars);
      return { ok: true, ...common, kind: 'text', text, ...(extracted.length > maxChars ? { truncated: true } : {}) };
    }
    return { ok: false, ...common, kind: 'unsupported', error: 'spreadsheet could not be parsed or is empty' };
  }
  // Plain-text media: decode utf8 directly (capped). Guard against the OOXML/office
  // container family (docx/…), whose media types contain the substring "xml" and so
  // slip past the loose isTextMediaType check even though they are binary zips.
  const isBinaryOffice = /officedocument|opendocument|msword|ms-powerpoint/i.test(meta.mediaType);
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
    // A scan is a PHOTOGRAPH of a document: there is no text to extract, and saying
    // only "unsupported" leaves the agent with nowhere to go. Its pages were stored as
    // image attachments at upload time — name them, so the agent hands THOSE to the
    // vision specialist instead of guessing at the contents or giving up.
    const pages = meta.pages ?? [];
    return {
      ok: false,
      ...common,
      kind: 'unsupported',
      error:
        pages.length > 0
          ? `scanned/image-only PDF — no text to extract. Its ${pages.length} page image(s) are attached: ` +
            `${pages.join(', ')} — look at them with system-vision (pass the page id as an attachment).`
          : 'no extractable text (likely a scanned/image-only PDF)',
    };
  }
  // Office documents (Word/PowerPoint/OpenDocument text+presentation) → officeparser.
  if (isOfficeDocument(meta.mediaType, meta.filename)) {
    const extracted = await extractOfficeText(bytes);
    if (extracted && extracted.trim()) {
      const text = extracted.slice(0, maxChars);
      return { ok: true, ...common, kind: 'text', text, ...(extracted.length > maxChars ? { truncated: true } : {}) };
    }
    return { ok: false, ...common, kind: 'unsupported', error: 'office document could not be parsed or has no text' };
  }
  // Everything else (legacy binary, unknown types) is not yet supported host-side.
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
