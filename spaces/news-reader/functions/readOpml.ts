/**
 * Parse an OPML file (XML) into a list of RSS feed URLs.
 *
 * OPML is the standard format for exporting/importing RSS subscription lists.
 * Supports both local file paths and URLs.
 */

export interface OpmlOutline {
  title: string;
  text: string;
  xmlUrl: string;
  htmlUrl?: string;
  category?: string;
}

export interface OpmlResult {
  title: string;
  outlines: OpmlOutline[];
}

export async function readOpml(source: string): Promise<OpmlResult> {
  let xml: string;

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source, {
      headers: { "User-Agent": "LMThing-NewsReader/1.0" },
    });
    if (!res.ok) throw new Error(`readOpml fetch ${source} → ${res.status}`);
    xml = await res.text();
  } else {
    const { readFile } = await import("node:fs/promises");
    xml = await readFile(source, "utf-8");
  }

  const outlines: OpmlOutline[] = [];
  let title = "Imported Feeds";

  const titleMatch = /<title>([^<]*)<\/title>/i.exec(xml);
  if (titleMatch) title = titleMatch[1]!.trim();

  const outlineRegex = /<outline[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = outlineRegex.exec(xml)) !== null) {
    const tag = match[0];
    const getAttr = (name: string): string => {
      const m = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
      return m?.[1] ?? "";
    };
    const xmlUrl = getAttr("xmlUrl");
    if (!xmlUrl) continue;
    outlines.push({
      title: getAttr("title") || getAttr("text"),
      text: getAttr("text") || getAttr("title"),
      xmlUrl,
      htmlUrl: getAttr("htmlUrl") || undefined,
      category: getAttr("category") || undefined,
    });
  }

  return { title, outlines };
}
