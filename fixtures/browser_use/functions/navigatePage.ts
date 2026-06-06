/**
 * Navigate to a URL using Chromium headless and return the page's DOM content.
 * Uses chromium-browser --headless --dump-dom for JavaScript-rendered pages.
 */
export function navigatePage(url: string): { url: string; html: string; title: string; success: boolean } {
  const result = execShell(`timeout 15 chromium-browser --headless --disable-gpu --no-sandbox --dump-dom '${url.replace(/'/g, "'\\''")}' 2>/dev/null`);
  const html = result.stdout;
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1] ?? url;
  return { url, html: html.slice(0, 50000), title, success: result.ok && html.length > 0 };
}

declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string };
