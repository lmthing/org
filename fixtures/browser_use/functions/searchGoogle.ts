/**
 * Search Google and return the results using curl.
 * Returns search result snippets without visiting each page.
 */
export function searchGoogle(query: string, numResults: number = 5): Array<{ title: string; url: string; snippet: string }> {
  const encodedQuery = encodeURIComponent(query);
  const result = execShell(`curl -s -L -A "Mozilla/5.0 (compatible; research-bot/1.0)" --max-time 10 "https://www.google.com/search?q=${encodedQuery}&num=${numResults}" 2>/dev/null`);

  if (!result.ok) return [];

  const html = result.stdout;
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Extract search results (simplified parsing)
  const resultBlocks = html.match(/class="[^"]*tF2Cxc[^"]*"[\s\S]*?(?=class="[^"]*tF2Cxc[^"]*"|$)/g) ?? [];
  for (const block of resultBlocks.slice(0, numResults)) {
    const titleMatch = block.match(/<h3[^>]*>([^<]+)<\/h3>/);
    const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
    const snippetMatch = block.match(/class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/span>/);

    if (titleMatch && urlMatch) {
      results.push({
        title: titleMatch[1]!.replace(/<[^>]+>/g, '').trim(),
        url: urlMatch[1]!,
        snippet: snippetMatch ? snippetMatch[1]!.replace(/<[^>]+>/g, '').trim() : '',
      });
    }
  }

  return results;
}

declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string };
