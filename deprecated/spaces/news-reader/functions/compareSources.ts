/**
 * Compare how different news sources cover the same story.
 *
 * Given a topic or event query, fetches multiple sources and produces a
 * structured comparison showing headline differences, framing, emphasis,
 * and factual alignment/divergence.
 */

export interface SourceCoverage {
  source: string;
  url: string;
  title: string;
  snippet: string;
  framing: "neutral" | "positive" | "negative" | "sensational" | "critical";
  keyClaims: string[];
  entities: string[];
}

export interface CompareResult {
  query: string;
  coverages: SourceCoverage[];
  commonClaims: string[];
  divergentClaims: Array<{ claim: string; sources: string[] }>;
  summary: string;
}

export interface CompareSourcesOpts {
  /** Max sources to compare (default 5). */
  maxSources?: number;
  /** Specific domains to include. */
  domains?: string[];
  /** How many sentences per source to include as snippet (default 3). */
  snippetSentences?: number;
  /** Fetch timeout per source in ms (default 15000). */
  timeoutMs?: number;
}

function extractSentences(text: string, count: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences.slice(0, count).join(" ").trim();
}

function extractClaims(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences
    .filter((s) => s.trim().length > 20)
    .map((s) => s.trim())
    .slice(0, 8);
}

export async function compareSources(
  query: string,
  opts: CompareSourcesOpts = {},
): Promise<CompareResult> {
  const maxSources = opts.maxSources ?? 5;
  const snippetCount = opts.snippetSentences ?? 3;
  const timeout = opts.timeoutMs ?? 15000;

  const params = new URLSearchParams({ q: query, count: String(maxSources) });
  if (opts.domains?.length) {
    // No domain filtering for this basic implementation
  }

  const searchHeaders: Record<string, string> = { "Accept": "application/json" };
  if (process.env.BRAVE_SEARCH_API_KEY) {
    searchHeaders["X-Subscription-Token"] = process.env.BRAVE_SEARCH_API_KEY;
  }

  let urls: Array<{ title: string; url: string; snippet: string; source: string }> = [];

  if (process.env.BRAVE_SEARCH_API_KEY) {
    const res = await fetch(`https://api.search.brave.com/res/v1/news/search?${params}`, {
      headers: searchHeaders,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{ title: string; url: string; description: string; meta_url?: { domain?: string } }>;
      };
      urls = (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? "",
        source: r.meta_url?.domain ?? new URL(r.url).hostname,
      }));
    }
  }

  if (urls.length === 0 && process.env.BING_SEARCH_API_KEY) {
    const bingParams = new URLSearchParams({ q: query, count: String(maxSources) });
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/news/search?${bingParams}`, {
      headers: { "Ocp-Apim-Subscription-Key": process.env.BING_SEARCH_API_KEY },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        value?: Array<{ name: string; url: string; description: string; provider?: Array<{ name?: string }> }>;
      };
      urls = (data.value ?? []).map((r) => ({
        title: r.name,
        url: r.url,
        snippet: r.description ?? "",
        source: r.provider?.[0]?.name ?? new URL(r.url).hostname,
      }));
    }
  }

  const coverages: SourceCoverage[] = [];
  for (const item of urls.slice(0, maxSources)) {
    const text = item.snippet;
    const claims = extractClaims(text);
    const framing: SourceCoverage["framing"] =
      /shock|breaking|bombshell|explosive|outrage|slam/i.test(text) ? "sensational"
      : /criticiz|blame|fail|scandal|corrupt|danger/i.test(text) ? "critical"
      : /win|success|boost|growth|triumph|praise/i.test(text) ? "positive"
      : /crash|loss|decline|threat|risk|warn/i.test(text) ? "negative"
      : "neutral";

    coverages.push({
      source: item.source,
      url: item.url,
      title: item.title,
      snippet: extractSentences(text, snippetCount),
      framing,
      keyClaims: claims,
      entities: [],
    });
  }

  const allClaims = coverages.flatMap((c) => c.keyClaims);
  const claimSources = new Map<string, string[]>();
  for (const claim of allClaims) {
    const existing = claimSources.get(claim) ?? [];
    for (const c of coverages) {
      if (c.keyClaims.includes(claim) && !existing.includes(c.source)) {
        existing.push(c.source);
      }
    }
    claimSources.set(claim, existing);
  }

  const commonClaims = [...claimSources.entries()]
    .filter(([, srcs]) => srcs.length >= 2)
    .map(([claim]) => claim);

  const divergentClaims = [...claimSources.entries()]
    .filter(([, srcs]) => srcs.length === 1)
    .map(([claim, srcs]) => ({ claim, sources: srcs }));

  return {
    query,
    coverages,
    commonClaims,
    divergentClaims,
    summary: `Compared ${coverages.length} sources for "${query}". ${commonClaims.length} common claims, ${divergentClaims.length} divergent claims.`,
  };
}
