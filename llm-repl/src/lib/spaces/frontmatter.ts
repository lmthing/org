/**
 * Tiny YAML frontmatter parser for space markdown files — agents/<slug>/instruct.md,
 * flows/<slug>/<file>.md, knowledge/<domain>/<field>/<option>.md.
 *
 * Supports the small schema this project uses:
 *   - scalar key:value pairs   `key: value`
 *   - list items               `key:` then `  - item`
 *   - list of inline mappings  `key:` then `  - id: foo` ` ` `    label: bar`
 *
 * Anything more complex should use a real YAML library. This avoids adding
 * a runtime dep for the modest schema we own.
 */

export interface ParsedFrontmatter {
  /** Parsed key/value tree. Values are strings, string arrays, or arrays of maps. */
  data: Record<string, unknown>;
  /** Body text after the closing `---`. */
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(content);
  if (!match) return { data: {}, body: content };

  const [, fm, body] = match;
  const data = parseFrontmatterBlock(fm!);
  return { data, body: body ?? '' };
}

export function parseFrontmatterBlock(fm: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = fm.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1]!;
    const rest = m[2]!;
    if (rest.trim().length > 0) {
      data[key] = coerce(rest.trim());
      i++;
      continue;
    }
    // Empty value → could be a list or nested map starting next line
    i++;
    const block: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!;
      if (next.trim() === '') { block.push(next); i++; continue; }
      if (/^\s/.test(next)) { block.push(next); i++; continue; }
      break;
    }
    data[key] = parseBlock(block);
  }
  return data;
}

function parseBlock(lines: string[]): unknown {
  const cleaned = lines.filter((l) => l.trim().length > 0);
  if (cleaned.length === 0) return '';
  // List form
  if (cleaned.every((l) => /^\s*-\s/.test(l))) {
    const items: unknown[] = [];
    let buf: string[] = [];
    for (const l of cleaned) {
      const m = /^(\s*)-\s+(.*)$/.exec(l);
      if (!m) { buf.push(l); continue; }
      if (buf.length > 0) items.push(parseListItem(buf));
      buf = [m[2]!];
    }
    if (buf.length > 0) items.push(parseListItem(buf));
    return items;
  }
  // Nested map
  const dedented = dedent(cleaned).join('\n');
  return parseFrontmatterBlock(dedented);
}

function parseListItem(lines: string[]): unknown {
  if (lines.length === 1) {
    const v = lines[0]!.trim();
    if (v.includes(': ')) {
      // inline mapping head, e.g. "id: foo"
      const map: Record<string, unknown> = {};
      const m = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(v);
      if (m) map[m[1]!] = coerce(m[2]!.trim());
      return map;
    }
    return coerce(v);
  }
  // Multi-line list item: first line may have inline key:value, subsequent lines have more keys
  const map: Record<string, unknown> = {};
  for (const raw of lines) {
    const m = /^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(raw);
    if (m) map[m[1]!] = coerce(m[2]!.trim());
  }
  return map;
}

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => /^(\s*)/.exec(l)![1]!.length);
  const min = Math.min(...indents);
  return lines.map((l) => l.slice(min));
}

function coerce(v: string): unknown {
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '') return '';
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  // Strip surrounding quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  // Inline array: [a, b, c]
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => coerce(item.trim()));
  }
  return t;
}
