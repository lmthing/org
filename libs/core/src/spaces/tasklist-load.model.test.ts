import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTasklist } from './tasklist-load.js';

/**
 * Per-node `model:` (tasklist frontmatter) — the authoring surface for pinning one
 * expensive step to a strong model while the rest of the tasklist runs the pod
 * default. Core treats the value as an OPAQUE string (an alias like `l`, or a full
 * `provider:modelId` spec); the provider layer resolves it. The same validator serves
 * md nodes and code nodes.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** Write `{ filename: contents }` into a temp tasklist dir and load it. */
async function loadFiles(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-taskmodel-'));
  tmpDirs.push(dir);
  const paths: string[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const p = join(dir, name);
    await writeFile(p, contents, 'utf8');
    paths.push(p);
  }
  return loadTasklist(dir, paths);
}

describe('TaskNode.model (tasklist frontmatter `model:`)', () => {
  it('parses a frontmatter model into TaskNode.model, and leaves it undefined when absent', async () => {
    const tasks = await loadFiles({
      '01-plan.md': `---\nid: plan\nmodel: some-model\noutput:\n  v: string\n---\n\nPlan it.`,
      '02-run.md': `---\nid: run\noutput:\n  v: string\n---\n\nRun it.`,
    });
    expect(tasks['plan']?.model).toBe('some-model');
    expect(tasks['run']?.model).toBeUndefined();
  });

  it('keeps a provider-qualified spec verbatim (opaque to core) and trims surrounding space', async () => {
    const tasks = await loadFiles({
      '01-judge.md': `---\nid: judge\nmodel: "  lmthingcloud:DeepSeek-V4-Flash  "\noutput:\n  ok: boolean\n---\n\nJudge it.`,
    });
    expect(tasks['judge']?.model).toBe('lmthingcloud:DeepSeek-V4-Flash');
  });

  it('reads `model` from a CODE node static metadata literal through the same validator', async () => {
    const tasks = await loadFiles({
      '01-emit.ts':
        `export const node = { id: 'emit', model: 'code-node-model', output: { v: 'string' } };\n` +
        `export async function run(ctx, inputs) { return { v: 'x' }; }\n`,
    });
    expect(tasks['emit']?.model).toBe('code-node-model');
  });

  it('REJECTS an empty model (a silently-ignored typo would look pinned while it was not)', async () => {
    await expect(
      loadFiles({ '01-plan.md': `---\nid: plan\nmodel: "   "\noutput:\n  v: string\n---\n\nPlan it.` }),
    ).rejects.toThrow(/"model" must be a non-empty string/);
  });

  it('REJECTS a non-string model', async () => {
    await expect(
      loadFiles({ '01-plan.md': `---\nid: plan\nmodel:\n  - a\n  - b\noutput:\n  v: string\n---\n\nPlan it.` }),
    ).rejects.toThrow(/"model" must be a non-empty string/);
  });
});
