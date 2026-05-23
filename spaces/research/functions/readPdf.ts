/**
 * Stream-parse a PDF from a URL (or local path) and return text in a context-efficient slice.
 *
 *   - `pages: "1-5"` reads only those pages.
 *   - `byteBudget` caps the returned text length (default 30 KB).
 *   - `offset`/`limit` lets you page through within the rendered text.
 *
 * Uses `pdf-parse` (Node) — light, no headless browser. For OCR-only PDFs
 * a downstream OCR step is needed; we expose `hasText` so the caller can
 * detect and route to OCR.
 */

import { readFile as nodeReadFile } from "node:fs/promises";

export interface ReadPdfOpts {
  /** e.g. "1-5" or "3" or "10-20" — 1-indexed inclusive. */
  pages?: string;
  byteBudget?: number;
  offset?: number;
  limit?: number;
  timeoutMs?: number;
}

export interface PdfPage {
  page: number;
  text: string;
}

export interface ReadPdfResult {
  url: string;
  title?: string;
  numPages: number;
  pagesReturned: number[];
  pages: PdfPage[];
  /** Concatenated text of the returned pages, sliced by byteBudget/offset/limit. */
  text: string;
  truncated: boolean;
  totalBytes: number;
  /** False if the PDF appears to be scanned (no extractable text). Route to OCR if needed. */
  hasText: boolean;
}

function parsePageRange(spec: string, total: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim())) {
    if (!part) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (m) {
      const a = Math.max(1, parseInt(m[1]!, 10));
      const b = Math.min(total, parseInt(m[2]!, 10));
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) out.add(n);
    }
  }
  return out;
}

async function loadBuffer(urlOrPath: string, timeoutMs: number): Promise<Buffer> {
  if (/^https?:\/\//.test(urlOrPath)) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(urlOrPath, { signal: ctl.signal });
      if (!res.ok) throw new Error(`readPdf fetch ${res.status} ${urlOrPath}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(t);
    }
  }
  return await nodeReadFile(urlOrPath);
}

export async function readPdf(urlOrPath: string, opts: ReadPdfOpts = {}): Promise<ReadPdfResult> {
  // Lazy import — pdf-parse is heavy.
  const pdfParse = (await import("pdf-parse")).default;

  const buf = await loadBuffer(urlOrPath, opts.timeoutMs ?? 30000);

  // pdf-parse exposes per-page text via a pagerender callback.
  const pageTexts: string[] = [];
  const parsed = await pdfParse(buf, {
    pagerender: async (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
      pageTexts.push(text);
      return text;
    },
  });

  const numPages = parsed.numpages;
  const wanted = opts.pages ? parsePageRange(opts.pages, numPages) : new Set<number>(Array.from({ length: numPages }, (_, i) => i + 1));

  const selected: PdfPage[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const p = i + 1;
    if (wanted.has(p)) selected.push({ page: p, text: pageTexts[i] ?? "" });
  }

  const fullText = selected.map((s) => `\n\n--- page ${s.page} ---\n${s.text}`).join("");
  const totalBytes = fullText.length;
  const limit = opts.limit ?? opts.byteBudget ?? 30000;
  const offset = opts.offset ?? 0;
  const sliced = fullText.slice(offset, offset + limit);

  const hasText = pageTexts.some((t) => t.length > 20);

  return {
    url: urlOrPath,
    title: parsed.info?.Title,
    numPages,
    pagesReturned: selected.map((s) => s.page),
    pages: selected,
    text: sliced,
    truncated: offset + limit < totalBytes,
    totalBytes,
    hasText,
  };
}
