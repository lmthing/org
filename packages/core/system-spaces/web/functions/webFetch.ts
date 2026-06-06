/** Fetch a URL and return its body as text (capped). Use for reading a specific page. */
export function webFetch(
  url: string,
  opts?: { maxChars?: number },
): { ok: boolean; status: number; content: string; truncated: boolean; error?: string } {
  const max = opts?.maxChars ?? 20000;
  const response = fetch(url);
  if (!response.ok) {
    return { ok: false, status: response.status, content: '', truncated: false, error: `HTTP ${response.status}` };
  }
  let content = response.text();
  let truncated = false;
  if (content.length > max) {
    content = content.slice(0, max);
    truncated = true;
  }
  return { ok: true, status: response.status, content, truncated };
}
