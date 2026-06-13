export async function tavilySearch(query: string, searchDepth: 'basic' | 'advanced' = 'basic', maxResults: number = 5): Promise<{
  query: string;
  results: Array<{ title: string; url: string; content: string; score: number }>;
  answer?: string;
}> {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) throw new Error('TAVILY_API_KEY not set in environment');

  // fetch is injected as a synchronous shim by the LMThing runtime
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

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

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
