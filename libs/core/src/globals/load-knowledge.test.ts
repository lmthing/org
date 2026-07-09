import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadKnowledgeFile } from './load-knowledge.js';

describe('loadKnowledgeFile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kn-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns a body-less markdown option file VERBATIM (no YAML mangling)', async () => {
    // This exact content used to be parsed as YAML: `- **MMLU-Pro**: 75.9` reads as an
    // ambiguous alias, emitting [BAD_ALIAS] warnings and returning garbage instead of text.
    const md = [
      '# Benchmarks',
      '',
      '- **MMLU-Pro**: 75.9 (vs Claude 3.5 Sonnet 78.0)',
      '- **MATH-500**: 90.2 (vs GPT-4o 74.6)',
    ].join('\n');
    const p = join(dir, 'overview.md');
    writeFileSync(p, md, 'utf8');
    const out = await loadKnowledgeFile(p);
    expect(typeof out).toBe('string');
    expect(out).toBe(md.trim());
    expect(out as string).toContain('**MMLU-Pro**: 75.9');
  });

  it('splits frontmatter + body when present', async () => {
    const p = join(dir, 'index.md');
    writeFileSync(p, '---\nvariable: foo\ndefault: overview\n---\n\nHello body.', 'utf8');
    const out = await loadKnowledgeFile(p) as { frontmatter: { variable: string }; body: string };
    expect(out.frontmatter.variable).toBe('foo');
    expect(out.body).toBe('Hello body.');
  });

  // On-demand loads arrive as `loadKnowledge(domain, field, option)`; the host
  // reconstructs the path from the OPTION SLUG, which has no extension. The resolver
  // must fall back to `<path>.md` (option file) then `<path>/index.md` (field/domain).
  it('resolves an extension-less option path to <path>.md', async () => {
    writeFileSync(join(dir, 'word.md'), '---\ndescription: Word docs.\n---\n\n# Word body', 'utf8');
    const out = await loadKnowledgeFile(join(dir, 'word')) as { frontmatter: { description: string }; body: string };
    expect(out.frontmatter.description).toBe('Word docs.');
    expect(out.body).toContain('# Word body');
  });

  it('resolves an extension-less field path to <path>/index.md', async () => {
    const { mkdirSync } = await import('node:fs');
    const fieldDir = join(dir, 'formats');
    mkdirSync(fieldDir, { recursive: true });
    writeFileSync(join(fieldDir, 'index.md'), '---\nvariable: fmt\n---\n\nField overview.', 'utf8');
    const out = await loadKnowledgeFile(fieldDir) as { frontmatter: { variable: string }; body: string };
    expect(out.frontmatter.variable).toBe('fmt');
    expect(out.body).toBe('Field overview.');
  });

  it('still throws for a path that resolves to nothing', async () => {
    await expect(loadKnowledgeFile(join(dir, 'nope'))).rejects.toThrow(/cannot read/);
  });
});
