/**
 * Fetch and parse an RSS 2.0, Atom, or JSON Feed URL.
 *
 * Returns a normalised array of feed items with title, link, date, and
 * optional content snippet. Handles XML parsing server-side so the
 * sandbox never deals with raw markup.
 */

export interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  content: string;
  author?: string;
  categories: string[];
  guid?: string;
  imageUrl?: string;
}

export interface FetchRSSOpts {
  /** Max items to return (default 25). */
  maxItems?: number;
  /** Include full content if available (default false — description only). */
  includeContent?: boolean;
  /** Fetch timeout in ms (default 15000). */
  timeoutMs?: number;
  /** Only items published after this ISO date string. */
  since?: string;
}

interface ParsedFeed {
  title: string;
  items: RSSItem[];
}

function xmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function extractText(parent: Element, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  if (!el) return "";
  return xmlDecode(el.textContent ?? "");
}

function extractAttr(parent: Element, tag: string, attr: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  return el?.getAttribute(attr) ?? "";
}

function parseRSS2(xml: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const channel = doc.getElementsByTagName("channel")[0];
  const feedTitle = channel ? extractText(channel, "title") : "Untitled Feed";

  const items: RSSItem[] = [];
  const xmlItems = doc.getElementsByTagName("item");

  for (let i = 0; i < xmlItems.length; i++) {
    const el = xmlItems[i]!;
    const link = extractText(el, "link") || extractAttr(el, "enclosure", "url");
    const description = extractText(el, "description");
    const content = extractText(el, "content:encoded") || description;
    items.push({
      title: extractText(el, "title") || link,
      link,
      pubDate: extractText(el, "pubDate") || extractText(el, "dc:date") || "",
      description: stripHtml(description).slice(0, 500),
      content: stripHtml(content).slice(0, 5000),
      author: extractText(el, "dc:creator") || extractText(el, "author") || undefined,
      categories: Array.from(el.getElementsByTagName("category")).map(
        (c) => c.textContent ?? "",
      ).filter(Boolean),
      guid: extractText(el, "guid") || link,
      imageUrl: extractAttr(el, "enclosure", "url") || extractAttr(el, "media:content", "url") || undefined,
    });
  }
  return { title: feedTitle, items };
}

function parseAtom(xml: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const feedEl = doc.getElementsByTagName("feed")[0];
  const feedTitle = feedEl ? extractText(feedEl, "title") : "Untitled Feed";

  const items: RSSItem[] = [];
  const entries = doc.getElementsByTagName("entry");

  for (let i = 0; i < entries.length; i++) {
    const el = entries[i]!;
    const linkEl = el.getElementsByTagName("link")[0];
    const link = linkEl?.getAttribute("href") ?? "";
    const summary = extractText(el, "summary");
    const content = extractText(el, "content");
    const updated = extractText(el, "updated") || extractText(el, "published") || "";
    items.push({
      title: extractText(el, "title") || link,
      link,
      pubDate: updated,
      description: stripHtml(summary).slice(0, 500),
      content: stripHtml(content).slice(0, 5000),
      author: extractText(el, "name") || undefined,
      categories: Array.from(el.getElementsByTagName("category")).map(
        (c) => c.getAttribute("term") ?? "",
      ).filter(Boolean),
      guid: el.getAttribute("id") || link,
      imageUrl: undefined,
    });
  }
  return { title: feedTitle, items };
}

function parseJSONFeed(json: string): ParsedFeed {
  const data = JSON.parse(json) as {
    title?: string;
    items?: Array<{
      title?: string;
      url?: string;
      date_published?: string;
      content_text?: string;
      content_html?: string;
      summary?: string;
      authors?: Array<{ name?: string }>;
      tags?: string[];
      id?: string;
      image?: string;
    }>;
  };
  return {
    title: data.title ?? "Untitled Feed",
    items: (data.items ?? []).map((item) => ({
      title: item.title ?? item.url ?? "",
      link: item.url ?? "",
      pubDate: item.date_published ?? "",
      description: stripHtml(item.summary ?? item.content_text ?? "").slice(0, 500),
      content: stripHtml(item.content_html ?? item.content_text ?? "").slice(0, 5000),
      author: item.authors?.[0]?.name,
      categories: item.tags ?? [],
      guid: item.id ?? item.url ?? "",
      imageUrl: item.image,
    })),
  };
}

function parseFeed(text: string, contentType: string): ParsedFeed {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseJSONFeed(trimmed);
  if (contentType.includes("atom") || trimmed.includes("<feed") || trimmed.includes("xmlns:atom")) {
    return parseAtom(trimmed);
  }
  return parseRSS2(trimmed);
}

export async function fetchRSS(
  url: string,
  opts: FetchRSSOpts = {},
): Promise<ParsedFeed> {
  const timeout = opts.timeoutMs ?? 15000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LMThing-NewsReader/1.0)",
        "Accept": "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.1",
      },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`fetchRSS ${url} → ${res.status}`);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const feed = parseFeed(text, contentType);

    let items = feed.items;
    if (opts.since) {
      const since = new Date(opts.since).getTime();
      items = items.filter((item) => {
        const d = new Date(item.pubDate).getTime();
        return !isNaN(d) && d >= since;
      });
    }
    if (opts.maxItems) {
      items = items.slice(0, opts.maxItems);
    }
    if (!opts.includeContent) {
      items = items.map(({ content: _c, ...rest }) => rest);
    }
    return { ...feed, items };
  } finally {
    clearTimeout(t);
  }
}
