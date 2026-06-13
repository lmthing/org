export async function tavilySearch(query: string, searchDepth: 'basic' | 'advanced' = 'basic', maxResults: number = 5): Promise<{
  query: string;
  results: Array<{ title: string; url: string; content: string; score: number }>;
  answer?: string;
  error?: string;
}> {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) {
    // Never throw — return a graceful empty result so the caller can resolve with a note.
    return { query, results: [], error: 'TAVILY_API_KEY not set in environment' };
  }

  // Retry transient failures (rate limit / 5xx) a couple of times with backoff. A 432
  // ("exceeds your plan's set usage limit") is a hard quota stop — do not waste retries.
  const maxAttempts = 3;
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // fetch is injected as a synchronous shim by the LMThing runtime.
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
      }),
    });

    if (response.ok) {
      const data = response.json() as {
        query: string;
        results: Array<{ title: string; url: string; content: string; score: number }>;
        answer?: string;
      };
      return {
        query: data.query ?? query,
        results: data.results ?? [],
        answer: data.answer,
      };
    }

    lastError = `Tavily search failed: ${response.status}`;
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === maxAttempts) break;
    // Backoff between transient retries using the synchronous host shell, if available.
    try {
      const sh = (globalThis as unknown as { execShell?: (cmd: string) => unknown }).execShell;
      if (typeof sh === 'function') sh(`sleep ${attempt}`);
    } catch { /* no shell available — retry immediately */ }
  }

  // Graceful degradation: return an empty result carrying the error so the research
  // tasklist can still resolve (with a note) instead of failing the whole run.
  return { query, results: [], error: lastError };
}
