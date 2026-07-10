/** Search the web. Returns ranked results and (Tavily only) an AI answer. `provider`
 *  (default `'auto'`): `'tavily'` requires TAVILY_API_KEY; `'bing'` renders Bing's
 *  results page with JavaScript via the in-cluster headless-browser service
 *  (RENDER_SERVICE_URL) and scrapes it — no key, real rendered DOM, no `answer`;
 *  `'duckduckgo'` scrapes the no-JS HTML endpoint (no key, lower-quality ranking, no
 *  `answer`); `'auto'` tries the best available in order — Tavily (when keyed) → Bing
 *  (when RENDER_SERVICE_URL is set) → DuckDuckGo — returning the first with results.
 *  (Bing rather than Google: Google serves datacenter IPs a consent/bot redirect loop that
 *  never renders, whereas Bing renders cleanly.) `topic: 'news'` + `timeRange` bias results
 *  toward recent coverage instead of evergreen pages (Tavily only) — use for "latest
 *  developments" angles instead of faking recency in the query text. */
export async function webSearch(
  query: string,
  opts?: {
    depth?: 'basic' | 'advanced';
    maxResults?: number;
    topic?: 'general' | 'news';
    timeRange?: 'day' | 'week' | 'month' | 'year';
    provider?: 'tavily' | 'bing' | 'duckduckgo' | 'auto';
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

  if (provider === 'bing') return webSearchBing(query, maxResults);
  if (provider === 'duckduckgo') return webSearchDuckDuckGo(query, maxResults);

  if (provider === 'auto') {
    // Ordered fallback: Tavily (when keyed) → Bing (when rendered) → DuckDuckGo. Tavily is
    // authoritative whenever its call succeeds — it can return an AI `answer` with few/no
    // results, so don't gate it on result count. The scrapers only "win" when they actually
    // yield results, so a missing key, an unset render service, or an empty/blocked Bing
    // page each fall through to the next option (DuckDuckGo is the always-available last resort).
    if (apiKey) {
      const t = await webSearchTavily(query, opts, apiKey);
      if (t.ok) return t;
    }
    const b = await webSearchBing(query, maxResults);
    if (b.ok && b.results.length > 0) return b;
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

/** Render Bing's results page WITH JavaScript executed (via the in-cluster headless-browser
 *  service at RENDER_SERVICE_URL) and scrape the rendered DOM. No API key, no AI-synthesized
 *  `answer`, rank-based `score` only. The render service is reachable only from inside the
 *  cluster and is authenticated with RENDER_SERVICE_TOKEN. When RENDER_SERVICE_URL is unset
 *  (e.g. local dev) this returns `{ ok: false }` so `provider:'auto'` falls through to
 *  DuckDuckGo. Bing (not Google) because Google serves datacenter IPs a consent/bot redirect
 *  loop that never renders. Dependency-free regex extraction, matching the rest of this space. */
async function webSearchBing(query: string, maxResults: number): Promise<WebSearchResult> {
  const base = process.env['RENDER_SERVICE_URL'];
  if (!base) {
    return { ok: false, query, answer: '', results: [], error: 'RENDER_SERVICE_URL not set in environment' };
  }
  const token = process.env['RENDER_SERVICE_TOKEN'] ?? '';
  const searchUrl =
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults + 5}&setlang=en&cc=us`;
  const endpoint = `${base.replace(/\/$/, '')}/content${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  let response: { ok: boolean; status: number; text: () => string };
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `domcontentloaded` returns as soon as the results DOM is parsed instead of waiting for
      // every tracker/beacon to settle (the default `load` can hang ~30s on a search page).
      body: JSON.stringify({ url: searchUrl, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 } }),
    });
  } catch (e) {
    return { ok: false, query, answer: '', results: [], error: `Render service unreachable: ${String(e)}` };
  }
  if (!response.ok) {
    return { ok: false, query, answer: '', results: [], error: `Bing render failed: HTTP ${response.status}` };
  }
  const html = response.text();
  const results: Array<{ title: string; url: string; snippet: string; score: number }> = [];
  const seen = new Set<string>();
  // Rendered Bing wraps each organic result in `<li class="b_algo">`; the title is an
  // `<h2><a href="…">` and the snippet the block's first `<p>`. Split on the block marker,
  // then extract the anchor + first paragraph per block.
  const blocks = html.split('<li class="b_algo"');
  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i]!;
    const am = block.match(/<h2\b[^>]*>\s*<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!am) continue;
    const url = decodeBingRedirect(decodeHtmlEntities(am[1]!));
    const title = decodeHtmlEntities(stripTags(am[2]!));
    if (!url || !title || isInternalBingHost(url) || seen.has(url)) continue;
    seen.add(url);
    const pm = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/);
    const snippet = pm ? decodeHtmlEntities(stripTags(pm[1]!)).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    results.push({ title, url, snippet, score: Math.max(0.1, 1 - results.length * 0.1) });
  }
  return { ok: true, query, answer: '', results };
}

/** Bing links every result through a `bing.com/ck/a?…&u=a1<base64url>` redirect — the real
 *  target is the base64url payload after the `a1` scheme marker. A direct (non-ck) absolute
 *  href is returned as-is; anything else (or a bing.com host) yields ''. */
function decodeBingRedirect(href: string): string {
  const m = href.match(/[?&]u=a1([^&]+)/);
  if (m) {
    const decoded = base64UrlDecode(m[1]!);
    return /^https?:\/\//.test(decoded) ? decoded : '';
  }
  return /^https?:\/\//.test(href) && !/^https?:\/\/(?:[^/]*\.)?bing\.com/i.test(href) ? href : '';
}

/** Bing's own chrome (its /ck redirector once decoded to a bing host, translate/maps links)
 *  shouldn't be returned as organic results. */
function isInternalBingHost(url: string): boolean {
  return /^https?:\/\/(?:[^/]*\.)?(?:bing\.com|go\.microsoft\.com|microsofttranslator\.com)(?:[/:]|$)/i.test(url);
}

/** Minimal, dependency-free base64url → string decoder (no atob/Buffer, which the sandbox
 *  may not expose). URLs are ASCII, so the Latin1 byte string this yields is the target URL
 *  verbatim (any non-ASCII stays percent-encoded, as it already is in the href). */
function base64UrlDecode(s: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const c of normalized) {
    if (c === '=') break;
    const idx = chars.indexOf(c);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
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
