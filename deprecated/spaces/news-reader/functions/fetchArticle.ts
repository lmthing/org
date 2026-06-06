/**
 * Fetch a news article URL and return its main content as clean markdown.
 *
 * Uses Mozilla Readability + Turndown for HTML articles, with a configurable
 * byte budget to keep context usage predictable. Falls back to Jina Reader
 * if the key is available.
 */

export interface FetchArticleOpts {
  /** Max bytes of extracted content (default 40000). */
  byteBudget?: number;
  /** Byte offset for pagination. */
  offset?: number;
  /** Byte limit from offset. Overrides byteBudget when set. */
  limit?: number;
  /** Use Jina Reader (r.jina.ai). Default: auto if JINA_API_KEY set. */
  useJinaReader?: boolean;
  /** Fetch timeout in ms (default 20000). */
  timeoutMs?: number;
  /** Extract author and publish date from metadata. */
  extractMetadata?: boolean;
}

export interface ArticleMetadata {
  author?: string;
  publishedDate?: string;
  modifiedDate?: string;
  siteName?: string;
  wordCount?: number;
  readingTimeMinutes?: number;
}

export interface FetchArticleResult {
  url: string;
  finalUrl: string;
  title: string;
  markdown: string;
  truncated: boolean;
  totalBytes: number;
  metadata: ArticleMetadata;
  source: "jina" | "readability";
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lmthing-news/1.0";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchViaJina(url: string, opts: FetchArticleOpts): Promise<FetchArticleResult> {
  const headers: Record<string, string> = {
    "Accept": "text/markdown, text/plain;q=0.9",
    "X-Return-Format": "markdown",
  };
  if (process.env.JINA_API_KEY) headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
  const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers }, opts.timeoutMs ?? 20000);
  if (!res.ok) throw new Error(`jina ${res.status}`);
  const md = await res.text();

  const titleMatch = /^Title:\s*(.+)$/m.exec(md);
  const urlMatch = /^URL Source:\s*(.+)$/m.exec(md);
  const body = md.replace(/^Title:.+\n+URL Source:.+\n+(Markdown Content:\n+)?/m, "");

  const totalBytes = body.length;
  const limit = opts.limit ?? opts.byteBudget ?? 40000;
  const offset = opts.offset ?? 0;
  const sliced = body.slice(offset, offset + limit);
  const words = sliced.split(/\s+/).length;

  return {
    url,
    finalUrl: urlMatch?.[1]?.trim() ?? url,
    title: titleMatch?.[1]?.trim() ?? url,
    markdown: sliced,
    truncated: offset + limit < totalBytes,
    totalBytes,
    metadata: { wordCount: words, readingTimeMinutes: Math.ceil(words / 230) },
    source: "jina",
  };
}

async function fetchViaReadability(url: string, opts: FetchArticleOpts): Promise<FetchArticleResult> {
  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");
  const TurndownService = (await import("turndown")).default;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    },
    opts.timeoutMs ?? 20000,
  );
  if (!res.ok) throw new Error(`fetchArticle ${res.status} ${url}`);
  const html = await res.text();
  const finalUrl = res.url || url;

  const dom = new JSDOM(html, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error(`fetchArticle: could not extract content from ${url}`);
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.remove(["script", "style", "noscript", "iframe", "form", "nav", "footer", "aside"]);

  const markdown = turndown.turndown(article.content).trim();
  const totalBytes = markdown.length;
  const limit = opts.limit ?? opts.byteBudget ?? 40000;
  const offset = opts.offset ?? 0;
  const sliced = markdown.slice(offset, offset + limit);
  const words = sliced.split(/\s+/).length;

  const metadata: ArticleMetadata = { wordCount: words, readingTimeMinutes: Math.ceil(words / 230) };

  if (opts.extractMetadata !== false) {
    metadata.author = article.byline ?? undefined;
    metadata.siteName = article.siteName ?? undefined;
    const doc = dom.window.document;
    const datePublished = doc.querySelector("meta[property='article:published_time']")?.getAttribute("content")
      ?? doc.querySelector("time[datetime]")?.getAttribute("datetime")
      ?? undefined;
    metadata.publishedDate = datePublished;
  }

  return {
    url,
    finalUrl,
    title: article.title ?? finalUrl,
    markdown: sliced,
    truncated: offset + limit < totalBytes,
    totalBytes,
    metadata,
    source: "readability",
  };
}

export async function fetchArticle(
  url: string,
  opts: FetchArticleOpts = {},
): Promise<FetchArticleResult> {
  const useJina = opts.useJinaReader ?? !!process.env.JINA_API_KEY;
  if (useJina) {
    try {
      return await fetchViaJina(url, opts);
    } catch {
      return await fetchViaReadability(url, opts);
    }
  }
  return await fetchViaReadability(url, opts);
}
