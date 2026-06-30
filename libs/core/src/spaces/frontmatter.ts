import { parse as parseYaml } from 'yaml';

/**
 * Parse YAML frontmatter from a markdown file.
 * Frontmatter is delimited by --- on its own line.
 *
 * Throws on malformed YAML (rather than silently producing empty data) so an
 * author gets a loud error instead of a mysteriously default-configured agent.
 * `source` is an optional file path included in the error message for context.
 */
export function parseFrontmatter(
  raw: string,
  source?: string,
): { data: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }

  const yamlText = match[1]!;
  const body = match[2]!.trim();

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (e) {
    const where = source ? ` in ${source}` : '';
    throw new Error(
      `Invalid YAML frontmatter${where}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let data: Record<string, unknown> = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    data = parsed as Record<string, unknown>;
  }

  return { data, body };
}
