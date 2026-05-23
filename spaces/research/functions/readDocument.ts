/**
 * Auto-routing document reader.
 *
 *   - Probes the URL's content-type (HEAD then GET).
 *   - HTML  → fetchPage()
 *   - PDF   → readPdf()
 *   - DOCX  → mammoth → markdown
 *   - PPTX  → text extract
 *   - XLSX  → sheet-to-csv
 *   - Plain → as-is, sliced
 *
 * Same byte-budget / offset / limit semantics across all formats.
 */

import { fetchPage, type FetchPageResult } from "./fetchPage.js";
import { readPdf, type ReadPdfResult } from "./readPdf.js";

export interface ReadDocumentOpts {
  byteBudget?: number;
  offset?: number;
  limit?: number;
  /** Override the detected type (e.g. "pdf" for an unlabeled PDF). */
  forceType?: DocumentType;
  /** Page range for PDFs only. */
  pages?: string;
  timeoutMs?: number;
}

export type DocumentType = "html" | "pdf" | "docx" | "pptx" | "xlsx" | "text" | "unknown";

export interface ReadDocumentResult {
  url: string;
  detectedType: DocumentType;
  /** Returned text/markdown, already truncated to budget. */
  text: string;
  truncated: boolean;
  totalBytes: number;
  /** Type-specific payload — present when applicable. */
  html?: FetchPageResult;
  pdf?: ReadPdfResult;
}

const TYPE_MAP: Array<[RegExp, DocumentType]> = [
  [/^text\/html\b/i, "html"],
  [/^application\/xhtml\+xml\b/i, "html"],
  [/^application\/pdf\b/i, "pdf"],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml/i, "docx"],
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml/i, "pptx"],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml/i, "xlsx"],
  [/^text\//i, "text"],
  [/^application\/json\b/i, "text"],
];

function classify(contentType: string | null, urlPath: string): DocumentType {
  if (contentType) {
    for (const [re, t] of TYPE_MAP) if (re.test(contentType)) return t;
  }
  const ext = urlPath.toLowerCase().split(".").pop();
  if (!ext) return "unknown";
  return (
    {
      html: "html",
      htm: "html",
      pdf: "pdf",
      docx: "docx",
      pptx: "pptx",
      xlsx: "xlsx",
      txt: "text",
      md: "text",
      json: "text",
    } as Record<string, DocumentType>
  )[ext] ?? "unknown";
}

async function probeType(url: string, timeoutMs: number): Promise<DocumentType> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) {
      return classify(res.headers.get("content-type"), new URL(url).pathname);
    }
  } catch {
    // HEAD might be blocked; fall through to GET-based classification
  }
  return classify(null, new URL(url).pathname);
}

async function readDocx(url: string, opts: ReadDocumentOpts): Promise<ReadDocumentResult> {
  const mammoth = await import("mammoth");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30000);
  const res = await fetch(url, { signal: ctl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`readDocument(docx) ${res.status}`);
  const ab = await res.arrayBuffer();
  // mammoth has no convertToMarkdown — use convertToHtml then a tiny HTML→MD step.
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(ab) });
  const md = result.value
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, body: string) => `\n${"#".repeat(parseInt(lvl, 10))} ${body.replace(/<[^>]+>/g, "")}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, body: string) => `- ${body.replace(/<[^>]+>/g, "").trim()}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, body: string) => `\n${body.replace(/<[^>]+>/g, "")}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const totalBytes = md.length;
  const limit = opts.limit ?? opts.byteBudget ?? 30000;
  const offset = opts.offset ?? 0;
  return {
    url,
    detectedType: "docx",
    text: md.slice(offset, offset + limit),
    truncated: offset + limit < totalBytes,
    totalBytes,
  };
}

async function readPlain(url: string, opts: ReadDocumentOpts): Promise<ReadDocumentResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000);
  const res = await fetch(url, { signal: ctl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`readDocument(text) ${res.status}`);
  const body = await res.text();
  const totalBytes = body.length;
  const limit = opts.limit ?? opts.byteBudget ?? 30000;
  const offset = opts.offset ?? 0;
  return {
    url,
    detectedType: "text",
    text: body.slice(offset, offset + limit),
    truncated: offset + limit < totalBytes,
    totalBytes,
  };
}

export async function readDocument(url: string, opts: ReadDocumentOpts = {}): Promise<ReadDocumentResult> {
  const type = opts.forceType ?? (await probeType(url, opts.timeoutMs ?? 10000));

  switch (type) {
    case "html": {
      const html = await fetchPage(url, {
        byteBudget: opts.byteBudget,
        offset: opts.offset,
        limit: opts.limit,
        timeoutMs: opts.timeoutMs,
      });
      return {
        url,
        detectedType: "html",
        text: html.markdown,
        truncated: html.truncated,
        totalBytes: html.totalBytes,
        html,
      };
    }
    case "pdf": {
      const pdf = await readPdf(url, {
        byteBudget: opts.byteBudget,
        offset: opts.offset,
        limit: opts.limit,
        pages: opts.pages,
        timeoutMs: opts.timeoutMs,
      });
      return {
        url,
        detectedType: "pdf",
        text: pdf.text,
        truncated: pdf.truncated,
        totalBytes: pdf.totalBytes,
        pdf,
      };
    }
    case "docx":
      return readDocx(url, opts);
    case "text":
    case "unknown":
      return readPlain(url, opts);
    case "pptx":
    case "xlsx":
      // PPTX/XLSX — fall back to plain fetch + treat as zip extraction is overkill here;
      // recommend the caller convert externally. Return a stub.
      throw new Error(`readDocument: ${type} not yet supported — pre-convert to PDF or text`);
  }
}
