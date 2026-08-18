import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDshAgent, compileFunction } from './space-loader.js';

/** Write a minimal but valid lmthing space with one agent and one function. */
function writeSpace(root: string): void {
  const agent = join(root, 'agents', 'thing');
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'charter.md'), 'You are THING.');
  writeFileSync(
    join(agent, 'instruct.md'),
    ['---', 'title: Thing', 'functions:', '  - double', '---', 'Help the user by doubling numbers.'].join('\n'),
  );
  const fns = join(root, 'functions');
  mkdirSync(fns, { recursive: true });
  writeFileSync(join(fns, 'double.ts'), '// Double the x field\nexport default (a: { x: number }) => a.x * 2;\n');
}

describe('loadDshAgent', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-space-'));
    writeSpace(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('derives the persona from charter + instruct body', async () => {
    const spec = await loadDshAgent(root, 'thing');
    expect(spec.persona).toContain('You are THING.');
    expect(spec.persona).toContain('Help the user by doubling numbers.');
    expect(spec.persona).not.toContain('title: Thing'); // frontmatter excluded
  });

  it('exposes the agent-declared functions as tool specs', async () => {
    const spec = await loadDshAgent(root, 'thing');
    expect(spec.functions.map((f) => f.name)).toEqual(['double']);
    expect(spec.functions[0]?.description).toContain('Double the x field');
    expect(spec.functions[0]?.source).toContain('export default');
  });

  it('returns an empty spec for an unknown agent', async () => {
    const spec = await loadDshAgent(root, 'nope');
    expect(spec).toEqual({ persona: '', functions: [] });
  });
});

describe('compileFunction', () => {
  it('compiles an export-default TS function and runs it', async () => {
    const fn = await compileFunction('export default (a: { x: number }) => a.x * 2;');
    expect(fn({ x: 21 })).toBe(42);
  });

  it('throws when there is no default-exported function', async () => {
    await expect(compileFunction('export const notDefault = 1;')).rejects.toThrow(/default-exported function/);
  });
});
