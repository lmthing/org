import { parse as parseYaml } from 'yaml';

/**
 * Parse YAML frontmatter from a markdown file.
 * Frontmatter is delimited by --- on its own line.
 */
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }

  const yamlText = match[1]!;
  const body = match[2]!.trim();

  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid YAML — return empty data
  }

  return { data, body };
}
