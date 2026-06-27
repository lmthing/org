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
});
