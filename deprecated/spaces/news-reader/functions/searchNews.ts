/**
 * News-specific web search across multiple providers.
 *
 * Optimised for news retrieval: supports freshness filters, source
 * restrictions, and returns structured results with publication dates.
 * Falls back through Brave → Bing → Google CSE based on available API keys.
 */

export interface NewsSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  imageUrl?: string;
  provider: "brave" | "bing" | "google_cse" | "gnews" | "newsapi";
}

export interface SearchNewsOpts {
  /** Max results to return (default 10). */
  topK?: number;
  /** Recency filter. */
  freshness?: "hour" | "day" | "week" | "month" | "year" | "all";
  /** Restrict to these domains (e.g. ["reuters.com", "apnews.com"]). */
  domains?: string[];
  /** Exclude these domains. */
  excludeDomains?: string[];
  /** Language code (default "en"). */
  language?: string;
  /** Country code for localised results (e.g. "us", "gb", "de"). */
  country?: string;
  /** Bias towards news-specific search endpoints. */
  topic?: "general" | "politics" | "technology" | "business" | "science" | "health" | "sports" | "entertainment";
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

async function searchBraveNews(q: string, opts: SearchNewsOpts): Promise<NewsSearchResult[]> {
  if (!process.env.BRAVE_SEARCH_API_KEY) return [];
  const params = new URLSearchParams({ q, count: String(opts.topK ?? 10) });
  if (opts.freshness === "hour") params.set("freshness", "ph");
  else if (opts.freshness === "day") params.set("freshness", "pd");
  else if (opts.freshness === "week") params.set("freshness", "pw");
  else if (opts.freshness === "month") params.set("freshness", "pm");
  if (opts.country) params.set("country", opts.country);
  const res = await fetch(`https://api.search.brave.com/res/v1/news/search?${params}`, {
    headers: {
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`brave news ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      title: string;
      url: string;
      description: string;
      age?: string;
      meta_url?: { domain?: string };
      thumbnail?: { src?: string };
    }>;
  };
  return (data.results ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
    source: r.meta_url?.domain ?? new URL(r.url).hostname,
    publishedAt: r.age,
    imageUrl: r.thumbnail?.src,
    provider: "brave" as const,
  }));
}

async function searchBingNews(q: string, opts: SearchNewsOpts): Promise<NewsSearchResult[]> {
  if (!process.env.BING_SEARCH_API_KEY) return [];
  const params = new URLSearchParams({ q, count: String(opts.topK ?? 10) });
  if (opts.freshness === "day") params.set("freshness", "Day");
  else if (opts.freshness === "week") params.set("freshness", "Week");
  else if (opts.freshness === "month") params.set("freshness", "Month");
  if (opts.market) params.set("mkt", `${opts.language ?? "en"}-${(opts.country ?? "us").toUpperCase()}`);
  const res = await fetch(`https://api.bing.microsoft.com/v7.0/news/search?${params}`, {
    headers: { "Ocp-Apim-Subscription-Key": process.env.BING_SEARCH_API_KEY },
  });
  if (!res.ok) throw new Error(`bing news ${res.status}`);
  const data = (await res.json()) as {
    value?: Array<{
      name: string;
      url: string;
      description: string;
      datePublished?: string;
      provider?: Array<{ name?: string }>;
      image?: { thumbnail?: { contentUrl?: string } };
    }>;
  };
  return (data.value ?? []).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: r.description ?? "",
    source: r.provider?.[0]?.name ?? new URL(r.url).hostname,
    publishedAt: r.datePublished,
    imageUrl: r.image?.thumbnail?.contentUrl,
    provider: "bing" as const,
  }));
}

async function searchGoogleCSE(q: string, opts: SearchNewsOpts): Promise<NewsSearchResult[]> {
  if (!process.env.GOOGLE_CSE_API_KEY || !process.env.GOOGLE_CSE_CX) return [];
  const params = new URLSearchParams({
    key: process.env.GOOGLE_CSE_API_KEY,
    cx: process.env.GOOGLE_CSE_CX,
    q: opts.domains?.length ? `${q} site:${opts.domains.join(" OR site:")}` : q,
    num: String(Math.min(opts.topK ?? 10, 10)),
    sort: opts.freshness && opts.freshness !== "all" ? "date" : "",
  });
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!res.ok) throw new Error(`google_cse ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{
      title: string;
      link: string;
      snippet: string;
      pagemap?: { metatags?: Array<{ articlepublished_time?: string; "og:image"?: string }> };
    }>;
  };
  return (data.items ?? []).map((r, i) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? "",
    source: new URL(r.link).hostname,
    publishedAt: r.pagemap?.metatags?.[0]?.articlepublished_time,
    imageUrl: r.pagemap?.metatags?.[0]?.["og:image"],
    provider: "google_cse" as const,
  }));
}

async function searchGNews(q: string, opts: SearchNewsOpts): Promise<NewsSearchResult[]> {
  if (!process.env.GNEWS_API_KEY) return [];
  const params = new URLSearchParams({
    q,
    max: String(opts.topK ?? 10),
    token: process.env.GNEWS_API_KEY,
    lang: opts.language ?? "en",
    country: opts.country ?? "us",
  });
  if (opts.freshness && opts.freshness !== "all") {
    const days: Record<string, number> = { hour: 0, day: 1, week: 7, month: 30, year: 365 };
    params.set("from", new Date(Date.now() - (days[opts.freshness] ?? 30) * 86400e3).toISOString());
  }
  const res = await fetch(`https://gnews.io/api/v4/search?${params}`);
  if (!res.ok) throw new Error(`gnews ${res.status}`);
  const data = (await res.json()) as {
    articles?: Array<{
      title: string;
      url: string;
      description: string;
      publishedAt: string;
      source?: { name?: string };
      image?: string;
    }>;
  };
  return (data.articles ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
    source: r.source?.name ?? new URL(r.url).hostname,
    publishedAt: r.publishedAt,
    imageUrl: r.image,
    provider: "gnews" as const,
  }));
}

async function searchNewsApi(q: string, opts: SearchNewsOpts): Promise<NewsSearchResult[]> {
  if (!process.env.NEWSAPI_API_KEY) return [];
  const params = new URLSearchParams({
    q,
    apiKey: process.env.NEWSAPI_API_KEY,
    pageSize: String(opts.topK ?? 10),
    language: opts.language ?? "en",
  });
  if (opts.domains?.length) params.set("domains", opts.domains.join(","));
  if (opts.excludeDomains?.length) params.set("excludeDomains", opts.excludeDomains.join(","));
  if (opts.freshness && opts.freshness !== "all") {
    const days: Record<string, number> = { hour: 0, day: 1, week: 7, month: 30, year: 365 };
    params.set("from", new Date(Date.now() - (days[opts.freshness] ?? 30) * 86400e3).toISOString());
  }
  const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
  if (!res.ok) throw new Error(`newsapi ${res.status}`);
  const data = (await res.json()) as {
    articles?: Array<{
      title: string;
      url: string;
      description?: string;
      publishedAt?: string;
      source?: { name?: string };
      urlToImage?: string;
    }>;
  };
  return (data.articles ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url,
    snippet: r.description ?? "",
    source: r.source?.name ?? new URL(r.url).hostname,
    publishedAt: r.publishedAt,
    imageUrl: r.urlToImage,
    provider: "newsapi" as const,
  }));
}

export async function searchNews(
  query: string,
  opts: SearchNewsOpts = {},
): Promise<NewsSearchResult[]> {
  const callers = [searchBraveNews, searchBingNews, searchGoogleCSE, searchGNews, searchNewsApi];
  const settled = await Promise.allSettled(callers.map((fn) => fn(query, opts)));

  const all: NewsSearchResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const excludeSet = new Set(opts.excludeDomains ?? []);
  const seen = new Map<string, NewsSearchResult>();
  for (const r of all) {
    const url = canonicalize(r.url);
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (excludeSet.size && [...excludeSet].some((d) => host.includes(d))) continue;
    if (opts.domains?.length && !opts.domains.some((d) => host.includes(d))) continue;
    const existing = seen.get(url);
    if (!existing) seen.set(url, { ...r, url });
  }

  return [...seen.values()].slice(0, opts.topK ?? 10);
}
