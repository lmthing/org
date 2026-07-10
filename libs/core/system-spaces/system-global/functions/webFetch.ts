/** Fetch a URL and return its body. By default the HTML is reduced to readable text
 *  (tags stripped, entities decoded); pass `{ format: 'markdown' }` to keep structure
 *  (headings, links, lists, bold/italic, code) as Markdown instead of flattening it —
 *  better for research synthesis, where "what links to what" and section structure
 *  matter; pass `{ format: 'html' }` for the raw source.
 *
 *  A plain `fetch` returns only server-sent HTML, so a **client-rendered (SPA / JS-heavy)**
 *  page comes back as an empty shell with no usable content. `render` controls the fallback to
 *  the in-cluster headless-browser render service (the same one `webSearch` uses), which
 *  executes JavaScript and returns the rendered DOM: `'auto'` (default) re-fetches through the
 *  render service only when the plain fetch looks dynamic (thin content + an app-shell/JS-gated
 *  page) or was bot-walled (403/429), and keeps whichever yields more readable text; `'force'`
 *  always renders; `'off'` never does (plain fetch only). The fallback is a no-op when
 *  RENDER_SERVICE_URL is unset (e.g. local dev). `rendered` reports whether the returned content
 *  came from the render service. */
export async function webFetch(
  url: string,
  opts?: { maxChars?: number; format?: 'text' | 'html' | 'markdown'; render?: 'auto' | 'force' | 'off' },
): Promise<{ ok: boolean; status: number; content: string; truncated: boolean; rendered?: boolean; error?: string }> {
  const max = opts?.maxChars ?? 20000;
  const format = opts?.format ?? 'text';
  const render = opts?.render ?? 'auto';

  // render:'force' — go straight to the render service; fall back to a plain fetch only if the
  // service is unset/unreachable, so a missing RENDER_SERVICE_URL never breaks webFetch.
  if (render === 'force') {
    const r = await renderViaService(url);
    if (r.ok) return { ok: true, status: r.status, ...reduce(r.html, format, max), rendered: true };
    // fall through to a plain fetch below
  }

  const response = await fetch(url);

  if (!response.ok) {
    // render:'auto' — a bot-wall (403/429) on a bare fetch often clears when a real browser
    // makes the request, so try the render service once before surfacing the error.
    if (render === 'auto' && (response.status === 403 || response.status === 429)) {
      const r = await renderViaService(url);
      if (r.ok) return { ok: true, status: r.status, ...reduce(r.html, format, max), rendered: true };
    }
    return { ok: false, status: response.status, content: '', truncated: false, error: `HTTP ${response.status}` };
  }

  const rawHtml = response.text();
  const plain = reduce(rawHtml, format, max);

  // render:'auto' — the plain fetch succeeded but the page looks client-rendered (thin readable
  // text on an app shell / JS-gated page), so re-fetch through the render service and keep the
  // richer of the two. `looksDynamic` is measured on the readable text, not raw HTML, so an
  // `html` format request still triggers rendering when the underlying page is dynamic.
  if (render === 'auto' && looksDynamic(rawHtml, htmlToText(rawHtml))) {
    const r = await renderViaService(url);
    if (r.ok) {
      const rendered = reduce(r.html, format, max);
      if (rendered.content.length > plain.content.length) {
        return { ok: true, status: r.status, ...rendered, rendered: true };
      }
    }
  }

  return { ok: true, status: response.status, ...plain };
}

/** Reduce a fetched HTML body to the requested format and apply the char cap. `format:'html'`
 *  keeps the raw source; `text`/`markdown` extract readable content so the cap applies to useful
 *  content rather than to markup. */
function reduce(html: string, format: 'text' | 'html' | 'markdown', max: number): { content: string; truncated: boolean } {
  let content = html;
  if (format === 'text') content = htmlToText(content);
  else if (format === 'markdown') content = htmlToMarkdown(content);
  if (content.length > max) return { content: content.slice(0, max), truncated: true };
  return { content, truncated: false };
}

/** Fetch a URL through the in-cluster headless-browser render service (browserless `/content`),
 *  which executes JavaScript and returns the rendered DOM as HTML — the same service and request
 *  shape `webSearch`'s Bing provider uses. Reads RENDER_SERVICE_URL/RENDER_SERVICE_TOKEN
 *  defensively (a no-op returning `ok:false` when unset, e.g. local dev, so `webFetch` degrades to
 *  the plain fetch). `response.text()` is host-synchronous in the sandbox, so this only runs
 *  through the runtime, not plain Node. */
async function renderViaService(url: string): Promise<{ ok: boolean; status: number; html: string }> {
  const base = typeof process !== 'undefined' ? process.env['RENDER_SERVICE_URL'] : undefined;
  if (!base) return { ok: false, status: 0, html: '' };
  const token = (typeof process !== 'undefined' ? process.env['RENDER_SERVICE_TOKEN'] : undefined) ?? '';
  const endpoint = `${base.replace(/\/$/, '')}/content${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  let response: { ok: boolean; status: number; text: () => string };
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `domcontentloaded` returns as soon as the DOM is parsed instead of waiting for every
      // tracker/beacon to settle (the default `load` can hang ~30s on heavy pages).
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 } }),
    });
  } catch {
    return { ok: false, status: 0, html: '' };
  }
  if (!response.ok) return { ok: false, status: response.status, html: '' };
  return { ok: true, status: response.status, html: response.text() };
}

/** Heuristic: does this plain-fetched page look client-rendered (so the render service would
 *  help)? Only pages whose readable text is **thin** are candidates (a content-rich page is
 *  returned as-is). Among those it's dynamic when the raw HTML shows JS builds the real content:
 *   - a known SPA root element (`id="root"|"app"|"__next"`, `data-reactroot`, `ng-app`), or
 *   - a `<noscript>`/"enable JavaScript" notice, or
 *   - a near-empty body (<50 chars) with any `<script>`, or
 *   - **inline-script dominance** — the bytes inside `<script>…</script>` far outweigh the
 *     visible text (e.g. a data/templating page like `quotes.toscrape.com/js/`: ~100 chars of
 *     chrome, ~4KB of inline quote data that JS renders into the DOM).
 *  A bare external analytics `<script src>` (no inline bytes) on an otherwise short static page
 *  does NOT trigger — rendering it would add nothing. Correctness doesn't hinge on this being
 *  perfect: the caller only ADOPTS the rendered result when it yields more text, so an
 *  over-trigger merely wastes one render, never returns worse content. */
function looksDynamic(rawHtml: string, reducedText: string): boolean {
  if (reducedText.length >= 200) return false;
  if (/\bid=["'](?:root|app|__next)["']|data-reactroot|\bng-app\b/i.test(rawHtml)) return true;
  if (/<noscript\b|enable\s+JavaScript/i.test(rawHtml)) return true;
  if (reducedText.length < 50 && /<script\b/i.test(rawHtml)) return true;
  const inlineScriptBytes = (rawHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? [])
    .reduce((n, s) => n + s.length, 0);
  if (inlineScriptBytes >= 1000 && inlineScriptBytes > reducedText.length * 4) return true;
  return false;
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

/** Minimal, dependency-free HTML→Markdown: same strip-first pass as `htmlToText`, but
 *  converts headings/links/lists/bold/italic/code to Markdown syntax instead of
 *  flattening everything to plain text. Lossy for deeply nested markup (nested
 *  lists, tables) — good enough for reading, not a faithful re-render. */
function htmlToMarkdown(html: string): string {
  const stripInnerTags = (s: string): string => s.replace(/<[^>]+>/g, '').trim();
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => `\n\`\`\`\n${stripInnerTags(inner)}\n\`\`\`\n`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripInnerTags(inner)}\``)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => `**${stripInnerTags(inner)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => `*${stripInnerTags(inner)}*`)
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const cleanText = stripInnerTags(text);
      return cleanText ? `[${cleanText}](${decodeEntities(href)})` : '';
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${stripInnerTags(inner)}\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|li|tr|ul|ol|table|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
