import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectFunctions, scopeProjectFunctions } from './project-functions-load.js';
import { loadSpace } from './load.js';
import { buildOverlay } from '../typecheck/overlay.js';

const tmpDirs: string[] = [];

/** Build a throwaway project root on disk and return its dir. */
async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-projfns-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('loadProjectFunctions', () => {
  it('loads .ts and .tsx from <projectRoot>/functions, keyed by basename', async () => {
    const root = await makeProject({
      'functions/greet.ts': '/** Greet */\nexport function greet(name: string): string { return `hi ${name}`; }',
      'functions/card.tsx': '/** Card */\nexport function card(): unknown { return <div />; }',
      // A non-source file in functions/ is ignored.
      'functions/README.md': 'not a function',
    });
    const { functions, functionsBundled } = await loadProjectFunctions(root);
    expect(Object.keys(functions).sort()).toEqual(['card', 'greet']);
    expect(functions['greet']).toContain('export function greet');
    // No node_modules ⇒ no bundled output (parity with space function loading).
    expect(functionsBundled).toEqual({});
  });

  it('returns empty maps when there is no functions/ dir', async () => {
    const root = await makeProject({ 'database/notes.json': '{}' });
    const { functions, functionsBundled } = await loadProjectFunctions(root);
    expect(functions).toEqual({});
    expect(functionsBundled).toEqual({});
  });

  it('produces bundled ESM when the project ships node_modules (esbuild variant)', async () => {
    const root = await makeProject({
      'functions/sum.ts': '/** Sum */\nexport function sum(a: number, b: number): number { return a + b; }',
      // Presence of node_modules/ flips on the bundled build (mirrors loadSpace).
      'node_modules/.keep': '',
    });
    const { functions, functionsBundled } = await loadProjectFunctions(root);
    expect(functions['sum']).toContain('export function sum');
    expect(functionsBundled['sum']).toBeTruthy();
    expect(functionsBundled['sum']).toContain('function sum');
  });

  it('is byte-for-byte identical to a SPACE loading the same functions/ (scope parity)', async () => {
    const src = '/** Greet */\nexport function greet(): string { return "hi"; }';
    const projectRoot = await makeProject({ 'functions/greet.ts': src });
    const spaceDir = await makeProject({
      'agents/a/instruct.md': '---\nfunctions:\n  - greet\n---\nbody',
      'functions/greet.ts': src,
    });
    const project = await loadProjectFunctions(projectRoot);
    const space = await loadSpace(spaceDir);
    expect(project.functions).toEqual({ greet: space.functions['greet'] });
  });

  it('the loaded functions compose into a DTS overlay fragment (declare function)', async () => {
    const root = await makeProject({
      'functions/greet.ts': '/** Greet a user */\nexport function greet(name: string): string { return `hi ${name}`; }',
    });
    const { functions } = await loadProjectFunctions(root);
    const overlay = buildOverlay(functions, { view: {}, form: {} });
    expect(overlay).toMatch(/declare function greet\(name: string\)/);
  });
});

describe('scopeProjectFunctions (space/system wins)', () => {
  const project = {
    functions: { greet: 'src-greet', unique: 'src-unique' },
    functionsBundled: { greet: 'bundled-greet', unique: 'bundled-unique' },
  };

  it('drops a project function whose name is reserved by a higher scope + warns', () => {
    const shadowed: string[] = [];
    const scoped = scopeProjectFunctions(project, ['greet'], (n) => shadowed.push(n));
    expect(Object.keys(scoped.functions)).toEqual(['unique']);
    expect(scoped.functionsBundled).toEqual({ unique: 'bundled-unique' });
    expect(shadowed).toEqual(['greet']);
  });

  it('keeps everything (disjoint) when no names collide', () => {
    const scoped = scopeProjectFunctions(project, ['other']);
    expect(Object.keys(scoped.functions).sort()).toEqual(['greet', 'unique']);
  });

  it('carries a name into functionsBundled only when the source has one', () => {
    const scoped = scopeProjectFunctions(
      { functions: { a: 'src-a' }, functionsBundled: {} },
      [],
    );
    expect(scoped.functions).toEqual({ a: 'src-a' });
    expect(scoped.functionsBundled).toEqual({});
  });
});
