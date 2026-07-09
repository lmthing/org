/** Search the web. Returns ranked results and (Tavily only) an AI answer. `provider`
 *  (default `'auto'`): `'tavily'` requires TAVILY_API_KEY; `'google'` renders Google's
 *  results page with JavaScript via the in-cluster headless-browser service
 *  (RENDER_SERVICE_URL) and scrapes it — no key, real rendered DOM, no `answer`;
 *  `'duckduckgo'` scrapes the no-JS HTML endpoint (no key, lower-quality ranking, no
 *  `answer`); `'auto'` tries the best available in order — Tavily (when keyed) → Google
 *  (when RENDER_SERVICE_URL is set) → DuckDuckGo — returning the first with results.
 *  `topic: 'news'` + `timeRange` bias results toward recent coverage instead of evergreen
 *  pages (Tavily only) — use for "latest developments" angles instead of faking recency in
 *  the query text. */
export async function webSearch(
  query: string,
  opts?: {
    depth?: 'basic' | 'advanced';
    maxResults?: number;
    topic?: 'general' | 'news';
    timeRange?: 'day' | 'week' | 'month' | 'year';
    provider?: 'tavily' | 'google' | 'duckduckgo' | 'auto';
  },
): Promise<{
  ok: boolean;
  query: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string; score: number }>;
  error?: string;
}> {
  const provider = opts?.provider ?? 'auto';
  const maxResults = opts?.maxResults ?? 5;
  const apiKey = process.env['TAVILY_API_KEY'];

  if (provider === 'google') return webSearchGoogle(query, maxResults);
  if (provider === 'duckduckgo') return webSearchDuckDuckGo(query, maxResults);

  if (provider === 'auto') {
    // Ordered fallback: Tavily (when keyed) → Google (when rendered) → DuckDuckGo. Tavily is
    // authoritative whenever its call succeeds — it can return an AI `answer` with few/no
    // results, so don't gate it on result count. The scrapers only "win" when they actually
    // yield results, so a missing key, an unset render service, or an empty/blocked Google
    // page each fall through to the next option (DuckDuckGo is the always-available last resort).
    if (apiKey) {
      const t = await webSearchTavily(query, opts, apiKey);
      if (t.ok) return t;
    }
    const g = await webSearchGoogle(query, maxResults);
    if (g.ok && g.results.length > 0) return g;
    return webSearchDuckDuckGo(query, maxResults);
  }

  // provider === 'tavily'
  if (!apiKey) {
    return { ok: false, query, answer: '', results: [], error: 'TAVILY_API_KEY not set in environment' };
  }
  return webSearchTavily(query, opts, apiKey);
}

type WebSearchResult = {
  ok: boolean;
  query: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string; score: number }>;
  error?: string;
};

/** Tavily API search — the only provider with an AI-synthesized `answer`. Requires a key. */
async function webSearchTavily(
  query: string,
  opts: { depth?: 'basic' | 'advanced'; maxResults?: number; topic?: 'general' | 'news'; timeRange?: 'day' | 'week' | 'month' | 'year' } | undefined,
  apiKey: string,
): Promise<WebSearchResult> {
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

/** Render Google's results page WITH JavaScript executed (via the in-cluster headless-browser
 *  service at RENDER_SERVICE_URL) and scrape the rendered DOM. No API key, no AI-synthesized
 *  `answer`, rank-based `score` only. The render service is reachable only from inside the
 *  cluster and is authenticated with RENDER_SERVICE_TOKEN. When RENDER_SERVICE_URL is unset
 *  (e.g. local dev) this returns `{ ok: false }` so `provider:'auto'` falls through to
 *  DuckDuckGo. Dependency-free regex extraction, matching the rest of this space. */
async function webSearchGoogle(query: string, maxResults: number): Promise<WebSearchResult> {
  const base = process.env['RENDER_SERVICE_URL'];
  if (!base) {
    return { ok: false, query, answer: '', results: [], error: 'RENDER_SERVICE_URL not set in environment' };
  }
  const token = process.env['RENDER_SERVICE_TOKEN'] ?? '';
  // Ask for a few extra results — Google interleaves non-organic blocks we skip below.
  const searchUrl =
    `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults + 5}&hl=en&gl=us`;
  const endpoint = `${base.replace(/\/$/, '')}/content${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  let response: { ok: boolean; status: number; text: () => string };
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: searchUrl }),
    });
  } catch (e) {
    return { ok: false, query, answer: '', results: [], error: `Render service unreachable: ${String(e)}` };
  }
  if (!response.ok) {
    return { ok: false, query, answer: '', results: [], error: `Google render failed: HTTP ${response.status}` };
  }
  const html = response.text();
  const results: Array<{ title: string; url: string; snippet: string; score: number }> = [];
  const seen = new Set<string>();
  // Rendered Google wraps each organic result in an <a href="..."> that contains an <h3>
  // title. Match the anchor's href then its inner <h3>, using an anchor-scoped negative
  // lookahead so a lazy match can't cross into the next result's anchor.
  const blockRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?<h3\b[^>]*>([\s\S]*?)<\/h3>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeGoogleRedirect(match[1]!);
    const title = decodeHtmlEntities(stripTags(match[2]!));
    if (!url || !title || isInternalGoogleHost(url) || seen.has(url)) continue;
    seen.add(url);
    // Best-effort snippet: the readable text immediately following the result anchor.
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 800);
    const snippet = decodeHtmlEntities(stripTags(after)).replace(/\s+/g, ' ').trim().slice(0, 300);
    results.push({ title, url, snippet, score: Math.max(0.1, 1 - results.length * 0.1) });
  }
  return { ok: true, query, answer: '', results };
}

/** Google sometimes links results through a `/url?q=<encoded>&sa=...` redirect and sometimes
 *  with a direct absolute href. Recover the real target in both cases; reject relative
 *  in-page (`/search`, `/preferences`, …) links by returning ''. */
function decodeGoogleRedirect(href: string): string {
  if (href.startsWith('/url?')) {
    const m = href.match(/[?&]q=([^&]+)/);
    if (!m) return '';
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return '';
    }
  }
  return /^https?:\/\//.test(href) ? href : '';
}

/** Google's own chrome (nav, images, cache, accounts, "more results" links) shouldn't be
 *  returned as organic results — filter those hosts out. */
function isInternalGoogleHost(url: string): boolean {
  return /^https?:\/\/(?:[^/]*\.)?(?:google\.[a-z.]+|gstatic\.com|googleusercontent\.com)(?:[/:]|$)/i.test(url)
    || /accounts\.google|webcache\.googleusercontent|\/search\?/i.test(url);
}

/** Scrape DuckDuckGo's no-JS HTML results page. No API key, no AI-synthesized `answer`,
 *  rank-based `score` only (1.0 down to ~0.1). Dependency-free regex extraction, matching
 *  the rest of this space's HTML handling (see `webFetch.ts`'s `htmlToText`). */
async function webSearchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult> {
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
