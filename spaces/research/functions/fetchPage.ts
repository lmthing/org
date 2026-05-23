/**
 * Fetch an HTML page and return its main content as markdown.
 *
 * Context-efficient by default:
 *   - Mozilla Readability strips chrome (nav, footer, sidebar, scripts, ads).
 *   - Output is markdown, not HTML.
 *   - Truncates to `byteBudget` bytes (default 30 KB ≈ ~7-8K tokens).
 *   - `{ offset, limit }` lets you page through long documents.
 *
 * If `JINA_API_KEY` is set OR you pass `useJinaReader: true`, defers to
 * Jina's r.jina.ai service (already returns clean markdown). Otherwise
 * uses local jsdom + @mozilla/readability + turndown.
 */

export interface FetchPageOpts {
  /** Max bytes of extracted content to return (default 30000). */
  byteBudget?: number;
  /** Pagination — byte offset into the extracted markdown. */
  offset?: number;
  /** Pagination — byte limit from offset. Overrides byteBudget when set. */
  limit?: number;
  /** Use Jina Reader (r.jina.ai). Default: auto if JINA_API_KEY set. */
  useJinaReader?: boolean;
  /** Custom user-agent. */
  userAgent?: string;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** Fetch timeout in ms (default 20000). */
  timeoutMs?: number;
}

export interface FetchPageResult {
  url: string;
  finalUrl: string;
  title: string;
  byline?: string;
  markdown: string;
  truncated: boolean;
  totalBytes: number;
  source: "jina" | "readability";
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lmthing-research/1.0";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

function sliceBytes(markdown: string, offset: number, limit: number): string {
  // Slice on character boundary closest to byte offset.
  // For simplicity and predictability we slice by UTF-16 code units —
  // most byte budgets are approximate anyway.
  return markdown.slice(offset, offset + limit);
}

async function fetchViaJina(url: string, opts: FetchPageOpts): Promise<FetchPageResult> {
  const headers: Record<string, string> = {
    "Accept": "text/markdown, text/plain;q=0.9",
    "X-Return-Format": "markdown",
  };
  if (process.env.JINA_API_KEY) headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
  const res = await fetchWithTimeout(
    `https://r.jina.ai/${url}`,
    { headers },
    opts.timeoutMs ?? 20000,
  );
  if (!res.ok) throw new Error(`jina r.jina.ai ${res.status}`);
  const md = await res.text();

  // Jina embeds title/url metadata at the top — best-effort parse.
  const titleMatch = /^Title:\s*(.+)$/m.exec(md);
  const urlMatch = /^URL Source:\s*(.+)$/m.exec(md);
  const body = md.replace(/^Title:.+\n+URL Source:.+\n+(Markdown Content:\n+)?/m, "");

  const totalBytes = body.length;
  const limit = opts.limit ?? opts.byteBudget ?? 30000;
  const offset = opts.offset ?? 0;
  const sliced = sliceBytes(body, offset, limit);
  return {
    url,
    finalUrl: urlMatch?.[1]?.trim() ?? url,
    title: titleMatch?.[1]?.trim() ?? url,
    markdown: sliced,
    truncated: offset + limit < totalBytes,
    totalBytes,
    source: "jina",
  };
}

async function fetchViaReadability(url: string, opts: FetchPageOpts): Promise<FetchPageResult> {
  // Lazy import — jsdom + readability + turndown are heavy.
  // The space loader is expected to provide a runtime where these are available
  // (or the agent runtime resolves them via require()).
  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");
  const TurndownService = (await import("turndown")).default;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": opts.userAgent ?? DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml",
        ...(opts.headers ?? {}),
      },
      redirect: "follow",
    },
    opts.timeoutMs ?? 20000,
  );
  if (!res.ok) throw new Error(`fetchPage ${res.status} ${url}`);
  const html = await res.text();
  const finalUrl = res.url || url;

  const dom = new JSDOM(html, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error(`fetchPage: Readability could not extract content from ${url}`);
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.remove(["script", "style", "noscript", "iframe", "form"]);

  const markdown = turndown.turndown(article.content).trim();
  const totalBytes = markdown.length;
  const limit = opts.limit ?? opts.byteBudget ?? 30000;
  const offset = opts.offset ?? 0;
  const sliced = sliceBytes(markdown, offset, limit);

  return {
    url,
    finalUrl,
    title: article.title ?? finalUrl,
    byline: article.byline ?? undefined,
    markdown: sliced,
    truncated: offset + limit < totalBytes,
    totalBytes,
    source: "readability",
  };
}

export async function fetchPage(url: string, opts: FetchPageOpts = {}): Promise<FetchPageResult> {
  const useJina = opts.useJinaReader ?? !!process.env.JINA_API_KEY;
  if (useJina) {
    try {
      return await fetchViaJina(url, opts);
    } catch (e) {
      // Fall back to local readability on jina failure
      return await fetchViaReadability(url, opts);
    }
  }
  return await fetchViaReadability(url, opts);
}
