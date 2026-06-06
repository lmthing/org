/**
 * Extract all links from an HTML page.
 */
export function extractLinks(html: string, baseUrl?: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1]!.trim();
    const text = match[2]!.replace(/<[^>]+>/g, '').trim();
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      let fullHref = href;
      if (baseUrl && href.startsWith('/')) {
        try {
          const base = new URL(baseUrl);
          fullHref = `${base.protocol}//${base.host}${href}`;
        } catch {
          fullHref = href;
        }
      }
      links.push({ href: fullHref, text: text.slice(0, 100) });
    }
  }
  return links.slice(0, 50);
}
