export function searchWeb(query: string, limit: number = 5): Array<{ title: string; url: string; snippet: string }> {
  // Simulated search results
  const results = [
    { title: `${query} - Overview`, url: `https://example.com/${query.toLowerCase().replace(/\s/g, '-')}`, snippet: `A comprehensive overview of ${query} covering key aspects and recent developments.` },
    { title: `${query} Research Papers`, url: `https://scholar.example.com/search?q=${encodeURIComponent(query)}`, snippet: `Academic research on ${query} with citations and methodology.` },
    { title: `Latest News: ${query}`, url: `https://news.example.com/${query.toLowerCase().replace(/\s/g, '-')}`, snippet: `Recent news and updates about ${query} from trusted sources.` },
    { title: `${query} Statistics 2024`, url: `https://stats.example.com/${query.toLowerCase().replace(/\s/g, '-')}`, snippet: `Current statistics and data about ${query} for 2024.` },
    { title: `Expert Analysis: ${query}`, url: `https://analysis.example.com/${query.toLowerCase().replace(/\s/g, '-')}`, snippet: `Expert opinions and in-depth analysis of ${query} trends.` },
  ];
  return results.slice(0, limit);
}
