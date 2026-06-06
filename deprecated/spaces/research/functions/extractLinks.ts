/**
 * Pull outbound links from a page, with filtering and lightweight ranking.
 *
 *   - Returns absolute URLs only.
 *   - Deduplicates and canonicalizes.
 *   - Filters by `sameOrigin`, `includes`, `excludes` patterns.
 *   - Returns at most `topK` links (default 50).
 */

export interface ExtractLinksOpts {
  topK?: number;
  sameOrigin?: boolean;
  includes?: string[];
  excludes?: string[];
  timeoutMs?: number;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export async function extractLinks(url: string, opts: ExtractLinksOpts = {}): Promise<ExtractedLink[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20000);
  const res = await fetch(url, {
    headers: { "Accept": "text/html" },
    signal: ctl.signal,
    redirect: "follow",
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`extractLinks ${res.status} ${url}`);
  const html = await res.text();
  const base = new URL(res.url || url);

  const out = new Map<string, ExtractedLink>();
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (opts.sameOrigin && abs.origin !== base.origin) continue;
    const u = abs.toString();
    if (opts.includes?.length && !opts.includes.some((p) => u.includes(p))) continue;
    if (opts.excludes?.some((p) => u.includes(p))) continue;
    const text = m[4]!.replace(/<[^>]+>/g, "").trim().slice(0, 200);
    if (!out.has(u)) out.set(u, { url: u, text });
  }

  return [...out.values()].slice(0, opts.topK ?? 50);
}
