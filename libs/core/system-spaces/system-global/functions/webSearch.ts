/** Search the web via Tavily. Returns ranked results and an AI answer. Requires TAVILY_API_KEY. */
export function webSearch(
  query: string,
  opts?: { depth?: 'basic' | 'advanced'; maxResults?: number },
): {
  ok: boolean;
  query: string;
  answer: string;
  results: Array<{ title: string; url: string; snippet: string; score: number }>;
  error?: string;
} {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) {
    return { ok: false, query, answer: '', results: [], error: 'TAVILY_API_KEY not set in environment' };
  }
  const response = fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: opts?.depth ?? 'basic',
      max_results: opts?.maxResults ?? 5,
      include_answer: true,
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
