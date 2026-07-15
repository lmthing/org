import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteKnowledgeGlobal } from './write-knowledge.js';

describe('writeKnowledge global', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'writeknow-'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('writes an option file at knowledge/<domain>/<field>/<option>.md and mkdir -ps', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    const res = writeKnowledge('zanzibar', 'insurance', 'coverage-window', '# 92 days');
    expect(res.ok).toBe(true);
    expect(res.path).toBe(join(base, 'zanzibar', 'insurance', 'coverage-window.md'));
    expect(readFileSync(res.path, 'utf8')).toBe('# 92 days');
  });

  it('strips a trailing .md from the option slug', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    const res = writeKnowledge('a', 'b', 'note.md', 'body');
    expect(res.path).toBe(join(base, 'a', 'b', 'note.md'));
    expect(existsSync(join(base, 'a', 'b', 'note.md.md'))).toBe(false);
  });

  it('reserves the option slug "index"', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    const res = writeKnowledge('a', 'b', 'index', 'body');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reserved/);
  });

  it('requires domain, field, option, and a string body', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    expect(writeKnowledge('', 'b', 'o', 'x').ok).toBe(false);
    expect(writeKnowledge('a', '', 'o', 'x').ok).toBe(false);
    expect(writeKnowledge('a', 'b', '', 'x').ok).toBe(false);
    // @ts-expect-error — deliberately wrong body type
    expect(writeKnowledge('a', 'b', 'o', 123).ok).toBe(false);
  });

  it('prepends a provenance blockquote when opts.source is set', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    const user = writeKnowledge('a', 'b', 'u', 'the fact', { source: 'user' });
    expect(readFileSync(user.path, 'utf8')).toBe('> source: from the user\n\nthe fact');
    const researched = writeKnowledge('a', 'b', 'r', 'the fact', { source: 'researched' });
    expect(readFileSync(researched.path, 'utf8')).toMatch(/^> source: researched\n\n/);
  });

  it('writes no provenance line when opts is omitted', () => {
    const writeKnowledge = createWriteKnowledgeGlobal(base);
    const res = writeKnowledge('a', 'b', 'plain', 'just markdown');
    expect(readFileSync(res.path, 'utf8')).toBe('just markdown');
  });
});
