/** Fetch a URL and return its body. By default the HTML is reduced to readable text
 *  (tags stripped, entities decoded); pass `{ format: 'html' }` for the raw source. */
export function webFetch(
  url: string,
  opts?: { maxChars?: number; format?: 'text' | 'html' },
): { ok: boolean; status: number; content: string; truncated: boolean; error?: string } {
  const max = opts?.maxChars ?? 20000;
  const format = opts?.format ?? 'text';
  const response = fetch(url);
  if (!response.ok) {
    return { ok: false, status: response.status, content: '', truncated: false, error: `HTTP ${response.status}` };
  }
  let content = response.text();
  // Extract readable text by default — raw HTML is unusable for reading/summarizing.
  // The cap then applies to useful text rather than to markup. format:'html' opts out.
  if (format === 'text') content = htmlToText(content);
  let truncated = false;
  if (content.length > max) {
    content = content.slice(0, max);
    truncated = true;
  }
  return { ok: true, status: response.status, content, truncated };
}

/** Minimal, dependency-free HTML→text: drop script/style/comments, turn block-level
 *  tag boundaries into newlines, strip remaining tags, decode common entities, and
 *  collapse whitespace. Plain (tagless) text passes through essentially unchanged. */
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|ul|ol|table|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
