/**
 * Enumerate a site's structure via sitemap.xml (preferred) or a shallow crawl fallback.
 *
 *   - Resolves /sitemap.xml and any nested sitemap index entries.
 *   - Falls back to crawling links from the root page (depth 1) if no sitemap.
 *   - Returns at most `maxUrls` (default 500) entries.
 */

import { extractLinks } from "./extractLinks.js";

export interface SiteMapOpts {
  maxUrls?: number;
  /** Skip the sitemap.xml lookup and just crawl. */
  forceCrawl?: boolean;
  timeoutMs?: number;
}

export interface SiteMapEntry {
  url: string;
  lastmod?: string;
  source: "sitemap" | "crawl";
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseSitemapXml(xml: string): Array<{ loc: string; lastmod?: string }> {
  const out: Array<{ loc: string; lastmod?: string }> = [];
  const urlRe = /<url>([\s\S]*?)<\/url>/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(xml)) !== null) {
    const block = m[1]!;
    const loc = /<loc>([^<]+)<\/loc>/i.exec(block)?.[1]?.trim();
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/i.exec(block)?.[1]?.trim();
    if (loc) out.push({ loc, lastmod });
  }
  return out;
}

function parseSitemapIndex(xml: string): string[] {
  const out: string[] = [];
  const re = /<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]!.trim());
  return out;
}

export async function siteMap(url: string, opts: SiteMapOpts = {}): Promise<SiteMapEntry[]> {
  const max = opts.maxUrls ?? 500;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const origin = new URL(url).origin;
  const out: SiteMapEntry[] = [];

  if (!opts.forceCrawl) {
    const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const c of candidates) {
      const xml = await fetchText(c, timeoutMs);
      if (xml) queue.push(c);
      if (queue.length) break;
    }
    while (queue.length && out.length < max) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const xml = await fetchText(next, timeoutMs);
      if (!xml) continue;
      if (xml.includes("<sitemapindex")) {
        for (const child of parseSitemapIndex(xml)) queue.push(child);
      } else {
        for (const u of parseSitemapXml(xml)) {
          out.push({ url: u.loc, lastmod: u.lastmod, source: "sitemap" });
          if (out.length >= max) break;
        }
      }
    }
    if (out.length) return out;
  }

  // Fallback: depth-1 crawl
  const links = await extractLinks(url, { sameOrigin: true, topK: max, timeoutMs });
  return links.map((l) => ({ url: l.url, source: "crawl" }));
}
