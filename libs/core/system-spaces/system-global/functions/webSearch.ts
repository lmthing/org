/** Search the web. Returns ranked results and an AI answer. `provider` (default `'auto'`):
 *  `'tavily'` requires TAVILY_API_KEY; `'duckduckgo'` scrapes the no-JS HTML endpoint (no key
 *  needed, lower-quality ranking, no `answer`); `'auto'` uses Tavily when the key is set, else
 *  falls back to DuckDuckGo. `topic: 'news'` + `timeRange` bias results toward recent coverage
 *  instead of evergreen pages (Tavily only) — use for "latest developments" angles instead of
 *  faking recency in the query text. */
export async function webSearch(
  query: string,
  opts?: {
    depth?: 'basic' | 'advanced';
    maxResults?: number;
    topic?: 'general' | 'news';
    timeRange?: 'day' | 'week' | 'month' | 'year';
    provider?: 'tavily' | 'duckduckgo' | 'auto';
  },
): Promise<{
  ok: boolean;
  query: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string; score: number }>;
  error?: string;
}> {
  const provider = opts?.provider ?? 'auto';
  const apiKey = process.env['TAVILY_API_KEY'];
  if (provider === 'duckduckgo' || (provider === 'auto' && !apiKey)) {
    return webSearchDuckDuckGo(query, opts?.maxResults ?? 5);
  }
  if (!apiKey) {
    return { ok: false, query, answer: '', results: [], error: 'TAVILY_API_KEY not set in environment' };
  }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: opts?.depth ?? 'basic',
      max_results: opts?.maxResults ?? 5,
      include_answer: true,
      ...(opts?.topic ? { topic: opts.topic } : {}),
      ...(opts?.timeRange ? { time_range: opts.timeRange } : {}),
    }),
  });
  if (!response.ok) {
    return { ok: false, query, answer: '', results: [], error: `Tavily search failed: HTTP ${response.status}` };
  }
  const data = response.json() as {
    query?: string;
    answer?: string;
    results?: Array<{ title: string; url: string; content: string; score: number }>;
  };
  return {
    ok: true,
    query: data.query ?? query,
    answer: data.answer ?? '',
    results: (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
    })),
  };
}

/** Scrape DuckDuckGo's no-JS HTML results page. No API key, no AI-synthesized `answer`,
 *  rank-based `score` only (1.0 down to ~0.1). Dependency-free regex extraction, matching
 *  the rest of this space's HTML handling (see `webFetch.ts`'s `htmlToText`). */
async function webSearchDuckDuckGo(
  query: string,
  maxResults: number,
): Promise<{
  ok: boolean;
  query: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string; score: number }>;
  error?: string;
}> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; lmthing-research/1.0)' },
  });
  if (!response.ok) {
    return { ok: false, query, answer: '', results: [], error: `DuckDuckGo search failed: HTTP ${response.status}` };
  }
  const html = response.text();
  const results: Array<{ title: string; url: string; snippet: string; score: number }> = [];
  // Each result block: a `result__a` title link (href is a `/l/?uddg=<encoded target>` redirect,
  // NOT the real URL — must decode the `uddg` param) followed by a `result__snippet` block.
  const blockRe = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < maxResults) {
    const rawHref = match[1]!;
    const title = decodeHtmlEntities(stripTags(match[2]!));
    const snippet = decodeHtmlEntities(stripTags(match[3]!));
    const url = decodeRedirectUrl(rawHref);
    if (!url || !title) continue;
    results.push({ title, url, snippet, score: Math.max(0.1, 1 - results.length * 0.1) });
  }
  return { ok: true, query, answer: '', results };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
}

/** DuckDuckGo's HTML results wrap targets in `//duckduckgo.com/l/?uddg=<encoded>&rut=...` —
 *  recover the real target from the `uddg` param instead of returning the redirect itself. */
function decodeRedirectUrl(href: string): string {
  const m = href.match(/uddg=([^&]+)/);
  if (!m) return href.startsWith('http') ? href : '';
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return '';
  }
}
