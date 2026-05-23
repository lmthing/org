/**
 * Unified web search across configured providers.
 *
 * Providers are auto-detected from env vars. Pass `providers: [...]` to
 * restrict; default is "all configured". Missing keys cause that provider
 * to be skipped silently. Calling a single provider directly throws if its
 * key is missing.
 *
 * Returns a deduped, ranked list of { title, url, snippet, source, score }.
 * Page bodies are NEVER fetched here — that's `fetchPage`'s job.
 */

export type SearchProvider =
  | "tavily"
  | "brave"
  | "serper"
  | "serpapi"
  | "exa"
  | "perplexity"
  | "kagi"
  | "you"
  | "google_cse"
  | "bing"
  | "duckduckgo";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: SearchProvider;
  score: number;
  publishedAt?: string;
}

export interface WebSearchOpts {
  providers?: SearchProvider[];
  topK?: number;
  freshness?: "day" | "week" | "month" | "year" | "all";
  /** Domains to exclude */
  exclude?: string[];
  /** Bias result type — relevant to Exa, Tavily */
  topic?: "general" | "news" | "academic";
}

const PROVIDER_ENV: Record<SearchProvider, string[]> = {
  tavily: ["TAVILY_API_KEY"],
  brave: ["BRAVE_SEARCH_API_KEY"],
  serper: ["SERPER_API_KEY"],
  serpapi: ["SERPAPI_API_KEY"],
  exa: ["EXA_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  kagi: ["KAGI_API_KEY"],
  you: ["YOU_API_KEY"],
  google_cse: ["GOOGLE_CSE_API_KEY", "GOOGLE_CSE_CX"],
  bing: ["BING_SEARCH_API_KEY"],
  duckduckgo: [],
};

function hasKeys(p: SearchProvider): boolean {
  return PROVIDER_ENV[p].every((k) => !!process.env[k]);
}

function requireKey(p: SearchProvider): void {
  const missing = PROVIDER_ENV[p].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`[research:webSearch] provider "${p}" needs env var(s): ${missing.join(", ")}`);
  }
}

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    for (const k of Array.from(u.searchParams.keys())) {
      if (k.startsWith("utm_") || k === "fbclid" || k === "gclid") u.searchParams.delete(k);
    }
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

// ── Per-provider callers ──

async function searchTavily(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("tavily");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: q,
      max_results: opts.topK ?? 8,
      topic: opts.topic === "news" ? "news" : "general",
      search_depth: "advanced",
      time_range: opts.freshness === "day" ? "d" : opts.freshness === "week" ? "w" : opts.freshness === "month" ? "m" : opts.freshness === "year" ? "y" : undefined,
      exclude_domains: opts.exclude,
    }),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const data = (await res.json()) as { results: Array<{ title: string; url: string; content: string; score: number; published_date?: string }> };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    source: "tavily",
    score: r.score,
    publishedAt: r.published_date,
  }));
}

async function searchBrave(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("brave");
  const params = new URLSearchParams({ q, count: String(opts.topK ?? 8) });
  if (opts.freshness === "day") params.set("freshness", "pd");
  else if (opts.freshness === "week") params.set("freshness", "pw");
  else if (opts.freshness === "month") params.set("freshness", "pm");
  else if (opts.freshness === "year") params.set("freshness", "py");
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description: string; age?: string }> } };
  return (data.web?.results ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: "brave",
    score: 1 - i / 100,
    publishedAt: r.age,
  }));
}

async function searchSerper(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("serper");
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ q, num: opts.topK ?? 8 }),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const data = (await res.json()) as { organic?: Array<{ title: string; link: string; snippet: string; date?: string }> };
  return (data.organic ?? []).map((r, i) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: "serper",
    score: 1 - i / 100,
    publishedAt: r.date,
  }));
}

async function searchSerpapi(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("serpapi");
  const params = new URLSearchParams({
    q,
    api_key: process.env.SERPAPI_API_KEY!,
    num: String(opts.topK ?? 8),
    engine: "google",
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string; date?: string }> };
  return (data.organic_results ?? []).map((r, i) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: "serpapi",
    score: 1 - i / 100,
    publishedAt: r.date,
  }));
}

async function searchExa(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("exa");
  const body: Record<string, unknown> = {
    query: q,
    numResults: opts.topK ?? 8,
    type: opts.topic === "academic" ? "neural" : "auto",
    contents: { highlights: true },
  };
  if (opts.freshness && opts.freshness !== "all") {
    const days = { day: 1, week: 7, month: 30, year: 365 }[opts.freshness];
    const start = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    body.startPublishedDate = start;
  }
  if (opts.exclude?.length) body.excludeDomains = opts.exclude;
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": process.env.EXA_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`exa ${res.status}`);
  const data = (await res.json()) as { results: Array<{ title: string; url: string; score: number; publishedDate?: string; highlights?: string[]; text?: string }> };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.highlights?.join(" … ") ?? r.text?.slice(0, 300) ?? "",
    source: "exa",
    score: r.score,
    publishedAt: r.publishedDate,
  }));
}

async function searchPerplexity(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("perplexity");
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: q }],
      return_citations: true,
      search_recency_filter:
        opts.freshness === "day" ? "day"
        : opts.freshness === "week" ? "week"
        : opts.freshness === "month" ? "month"
        : opts.freshness === "year" ? "year"
        : undefined,
    }),
  });
  if (!res.ok) throw new Error(`perplexity ${res.status}`);
  const data = (await res.json()) as { citations?: string[]; choices?: Array<{ message?: { content?: string } }> };
  const summary = data.choices?.[0]?.message?.content ?? "";
  return (data.citations ?? []).slice(0, opts.topK ?? 8).map((url, i) => ({
    title: url,
    url,
    snippet: summary.slice(0, 240),
    source: "perplexity",
    score: 1 - i / 100,
  }));
}

async function searchKagi(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("kagi");
  const params = new URLSearchParams({ q, limit: String(opts.topK ?? 8) });
  const res = await fetch(`https://kagi.com/api/v0/search?${params}`, {
    headers: { "Authorization": `Bot ${process.env.KAGI_API_KEY}` },
  });
  if (!res.ok) throw new Error(`kagi ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ t: number; url?: string; title?: string; snippet?: string; published?: string }> };
  return (data.data ?? [])
    .filter((r) => r.t === 0 && r.url)
    .map((r, i) => ({
      title: r.title ?? r.url!,
      url: r.url!,
      snippet: r.snippet ?? "",
      source: "kagi" as const,
      score: 1 - i / 100,
      publishedAt: r.published,
    }));
}

async function searchYou(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("you");
  const params = new URLSearchParams({ query: q, num_web_results: String(opts.topK ?? 8) });
  const res = await fetch(`https://api.ydc-index.io/search?${params}`, {
    headers: { "X-API-Key": process.env.YOU_API_KEY! },
  });
  if (!res.ok) throw new Error(`you ${res.status}`);
  const data = (await res.json()) as { hits?: Array<{ title: string; url: string; description: string }> };
  return (data.hits ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: "you",
    score: 1 - i / 100,
  }));
}

async function searchGoogleCse(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("google_cse");
  const params = new URLSearchParams({
    key: process.env.GOOGLE_CSE_API_KEY!,
    cx: process.env.GOOGLE_CSE_CX!,
    q,
    num: String(Math.min(opts.topK ?? 8, 10)),
  });
  if (opts.freshness === "day") params.set("dateRestrict", "d1");
  else if (opts.freshness === "week") params.set("dateRestrict", "w1");
  else if (opts.freshness === "month") params.set("dateRestrict", "m1");
  else if (opts.freshness === "year") params.set("dateRestrict", "y1");
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!res.ok) throw new Error(`google_cse ${res.status}`);
  const data = (await res.json()) as { items?: Array<{ title: string; link: string; snippet: string }> };
  return (data.items ?? []).map((r, i) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: "google_cse",
    score: 1 - i / 100,
  }));
}

async function searchBing(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  requireKey("bing");
  const params = new URLSearchParams({ q, count: String(opts.topK ?? 8) });
  if (opts.freshness === "day") params.set("freshness", "Day");
  else if (opts.freshness === "week") params.set("freshness", "Week");
  else if (opts.freshness === "month") params.set("freshness", "Month");
  const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": process.env.BING_SEARCH_API_KEY! },
  });
  if (!res.ok) throw new Error(`bing ${res.status}`);
  const data = (await res.json()) as { webPages?: { value?: Array<{ name: string; url: string; snippet: string; dateLastCrawled?: string }> } };
  return (data.webPages?.value ?? []).map((r, i) => ({
    title: r.name,
    url: r.url,
    snippet: r.snippet,
    source: "bing",
    score: 1 - i / 100,
    publishedAt: r.dateLastCrawled,
  }));
}

async function searchDuckDuckGo(q: string, opts: WebSearchOpts): Promise<SearchResult[]> {
  // DuckDuckGo Instant Answer API — no key, very limited. For real search,
  // a serverless scrape is needed; we use the IA API as a best-effort fallback.
  const params = new URLSearchParams({ q, format: "json", no_html: "1", no_redirect: "1" });
  const res = await fetch(`https://api.duckduckgo.com/?${params}`);
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const out: SearchResult[] = [];
  if (data.AbstractURL) {
    out.push({
      title: data.Heading ?? data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText ?? "",
      source: "duckduckgo",
      score: 1,
    });
  }
  for (const [i, t] of (data.RelatedTopics ?? []).entries()) {
    if (t.FirstURL && t.Text) {
      out.push({
        title: t.Text,
        url: t.FirstURL,
        snippet: t.Text,
        source: "duckduckgo",
        score: 0.9 - i / 100,
      });
    }
  }
  return out.slice(0, opts.topK ?? 8);
}

const CALLERS: Record<SearchProvider, (q: string, opts: WebSearchOpts) => Promise<SearchResult[]>> = {
  tavily: searchTavily,
  brave: searchBrave,
  serper: searchSerper,
  serpapi: searchSerpapi,
  exa: searchExa,
  perplexity: searchPerplexity,
  kagi: searchKagi,
  you: searchYou,
  google_cse: searchGoogleCse,
  bing: searchBing,
  duckduckgo: searchDuckDuckGo,
};

export async function webSearch(query: string, opts: WebSearchOpts = {}): Promise<SearchResult[]> {
  // Be forgiving about provider selection:
  //   - drop names not in our CALLERS table (LLMs sometimes invent provider names)
  //   - drop providers whose env vars are missing
  // We swallow these silently and fall through to whatever IS configured.
  const known = new Set(Object.keys(CALLERS) as SearchProvider[]);
  const requestedRaw = opts.providers ?? (Object.keys(CALLERS) as SearchProvider[]);
  const requested = requestedRaw.filter((p): p is SearchProvider => known.has(p) && hasKeys(p));

  if (requested.length === 0) {
    throw new Error(
      `[research:webSearch] no providers available. Set one of: ${Object.entries(PROVIDER_ENV)
        .filter(([, vars]) => vars.length)
        .map(([p, vars]) => `${p} (${vars.join("+")})`)
        .join(", ")}`,
    );
  }

  const settled = await Promise.allSettled(
    requested.map((p) => CALLERS[p](query, opts)),
  );

  const all: SearchResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const excludes = new Set(opts.exclude ?? []);
  const seen = new Map<string, SearchResult>();
  for (const r of all) {
    const url = canonicalize(r.url);
    if (excludes.size && [...excludes].some((d) => url.includes(d))) continue;
    const existing = seen.get(url);
    if (!existing || r.score > existing.score) seen.set(url, { ...r, url });
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK ?? 8);
}
