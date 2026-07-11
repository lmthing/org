import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTasklist, extractCodeNodeMeta } from './tasklist-load.js';
import { loadSpace } from './load.js';

/**
 * Code-node loading (plan step S2): a `NN-<id>.ts` file beside the `.md` nodes is
 * a `kind:'code'` TaskNode whose `node` metadata is extracted STATICALLY (no
 * import/execution — core stays free of any transpile/worker runtime). Its
 * id/dependsOn/condition/forEach/output behave identically to an md node's.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-codeload-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(tl, name), contents, 'utf8');
  }
  return dir;
}

describe('extractCodeNodeMeta', () => {
  it('reads the `node` object literal and confirms a `run` export without executing it', () => {
    const src = `
      import { anything } from './nope.js';
      export const node = {
        id: 'summarize',
        dependsOn: ['fetch'],
        condition: "fetch.ok == true",
        forEach: 'fetch.items',
        output: { summary: 'string', count: 'number' },
      };
      export async function run(ctx, inputs) {
        throw new Error('run must NOT be called during load');
      }
    `;
    const { node, hasRun } = extractCodeNodeMeta(src, '/x/01-summarize.ts');
    expect(hasRun).toBe(true);
    expect(node).toEqual({
      id: 'summarize',
      dependsOn: ['fetch'],
      condition: 'fetch.ok == true',
      forEach: 'fetch.items',
      output: { summary: 'string', count: 'number' },
    });
  });

  it('accepts an arrow-function `run` and a node without export keyword', () => {
    const src = `const node = { output: { v: 'number' } };\nconst run = async (ctx, inputs) => ({ v: 1 });\nexport { node, run };`;
    const { node, hasRun } = extractCodeNodeMeta(src, '/x/01-a.ts');
    expect(hasRun).toBe(true);
    expect(node).toEqual({ output: { v: 'number' } });
  });

  it('reports hasRun=false when no run function is exported', () => {
    const { hasRun } = extractCodeNodeMeta(`export const node = {};`, '/x/01-a.ts');
    expect(hasRun).toBe(false);
  });

  it('throws when a metadata value is not a static literal', () => {
    const src = `export const node = { output: someComputedThing() };\nexport function run() {}`;
    expect(() => extractCodeNodeMeta(src, '/x/01-a.ts')).toThrow(/static literals/);
  });
});

describe('loadTasklist with code nodes', () => {
  it('loads a mixed md + ts DAG: md node is kind:agent, ts node is kind:code with an absolute codeModulePath', async () => {
    const dir = await makeTasklistSpace({
      '01-fetch.md': `---\nid: fetch\noutput:\n  items: array\n---\n\nFETCH_T: gather items.`,
      '02-reduce.ts': `export const node = {\n  dependsOn: ['fetch'],\n  output: { total: 'number' },\n};\nexport async function run(ctx, inputs) {\n  return { total: inputs.fetch.items.length };\n}\n`,
    });
    const tl = join(dir, 'tasklists', 'flow');
    const tasks = await loadTasklist(tl, [join(tl, '01-fetch.md'), join(tl, '02-reduce.ts')]);

    expect(tasks['fetch']!.kind).toBe('agent');
    expect(tasks['fetch']!.codeModulePath).toBeUndefined();

    const reduce = tasks['reduce']!;
    expect(reduce.kind).toBe('code');
    // id derived from filename (numeric prefix stripped) exactly like md nodes.
    expect(reduce.id).toBe('reduce');
    expect(reduce.dependsOn).toEqual(['fetch']);
    expect(reduce.output).toEqual({ total: 'number' });
    expect(reduce.instruction).toBe('');
    expect(reduce.codeModulePath).toBe(resolve(join(tl, '02-reduce.ts')));
  });

  it('honours an explicit `id` in the node metadata (overriding the filename)', async () => {
    const dir = await makeTasklistSpace({
      '01-x.ts': `export const node = { id: 'custom', output: { v: 'number' } };\nexport async function run() { return { v: 1 }; }`,
    });
    const tl = join(dir, 'tasklists', 'flow');
    const tasks = await loadTasklist(tl, [join(tl, '01-x.ts')]);
    expect(Object.keys(tasks)).toEqual(['custom']);
    expect(tasks['custom']!.kind).toBe('code');
  });

  it('throws when a .ts node has no run export', async () => {
    const dir = await makeTasklistSpace({
      '01-broken.ts': `export const node = { output: { v: 'number' } };`,
    });
    const tl = join(dir, 'tasklists', 'flow');
    await expect(loadTasklist(tl, [join(tl, '01-broken.ts')])).rejects.toThrow(/must export an async `run/);
  });

  it('discovers .ts nodes (and their connections gate) through loadSpace → tasklists', async () => {
    const dir = await makeTasklistSpace({
      'index.md': `---\ninput:\n  topic: string\nconnections:\n  - slack\n---\n\nThe flow.`,
      '01-a.md': `---\nid: a\noutput:\n  v: number\n---\n\nA_T: work.`,
      '02-b.ts': `export const node = { dependsOn: ['a'], output: { v: 'number' } };\nexport async function run() { return { v: 2 }; }`,
    });
    const space = await loadSpace(dir);
    const flow = space.tasklists['flow']!;
    // Both node files are present, sorted by NN prefix (md + ts interleaved).
    expect(flow.files.map((f) => f.split('/').pop())).toEqual(['01-a.md', '02-b.ts']);
    // Tasklist-level connections gate parsed as typed data (no enforcement in core).
    expect(flow.connections).toEqual(['slack']);
  });
});
