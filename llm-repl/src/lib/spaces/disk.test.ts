import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSpaceFromDisk } from './disk.js';

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'disk-space-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
}

describe('loadSpaceFromDisk', () => {
  it('loads agents, functions, components, knowledge, and flows from a template directory', async () => {
    const sourceDir = join(tmpDir, 'src-space');
    const sessionDir = join(tmpDir, 'session-x');
    await writeTree(sourceDir, {
      'package.json': '{"name":"demo","version":"1.0.0"}',
      'README.md': '# demo space',
      'agents/searcher/config.json': '{"functions":["webSearch"]}',
      'agents/searcher/instruct.md': '---\ntitle: Searcher\n---\nbody',
      'functions/webSearch.ts': 'export const webSearch = () => [];',
      'components/view/Card.tsx': 'export const Card = () => null;',
      'components/form/AskForm.tsx': 'export const AskForm = ({ submit }: { submit?: (d: unknown) => void }) => null;',
      'knowledge/provider/config.json': '{"label":"Providers"}',
      'knowledge/provider/api/config.json': '{"label":"API"}',
      'knowledge/provider/api/brave.md': '---\ntitle: Brave\n---\nBrave entry',
      'knowledge/provider/api/tavily.md': '---\ntitle: Tavily\n---\nTavily entry',
      'flows/deep_research/index.md': 'flow root',
      'flows/deep_research/1.Plan.md': 'plan step',
      'flows/deep_research/2.Search.md': 'search step',
    });

    const trace = makeTrace();
    const loaded = await loadSpaceFromDisk({
      sourceDir,
      sessionDir,
      trace: trace as never,
    });

    expect(loaded.name).toBe('src-space');
    expect(loaded.packageJson).toEqual({ name: 'demo', version: '1.0.0' });
    expect(loaded.readme).toContain('# demo space');

    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]!.slug).toBe('searcher');
    expect(loaded.agents[0]!.instruct).toContain('Searcher');

    expect(loaded.functions.map((f) => f.name).sort()).toEqual(['webSearch']);
    expect(loaded.components.map((c) => `${c.kind}:${c.name}`).sort()).toEqual([
      'form:AskForm',
      'view:Card',
    ]);

    expect(loaded.knowledge).toHaveLength(1);
    const provider = loaded.knowledge[0]!;
    expect(provider.domain).toBe('provider');
    expect(provider.fields).toHaveLength(1);
    expect(provider.fields[0]!.field).toBe('api');
    expect(provider.fields[0]!.options.map((o) => o.option).sort()).toEqual(['brave', 'tavily']);

    expect(loaded.flows).toHaveLength(1);
    expect(loaded.flows[0]!.slug).toBe('deep_research');
    expect(loaded.flows[0]!.steps.map((s) => s.file)).toEqual(['1.Plan.md', '2.Search.md']);

    expect(loaded.handle.agents.searcher).toBeDefined();

    const calls = trace.write.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).toContain('space_disk_load_start');
    expect(calls).toContain('space_disk_load_done');
  });

  it('returns empty collections when source dirs are missing', async () => {
    const sourceDir = join(tmpDir, 'empty');
    await mkdir(sourceDir, { recursive: true });
    const sessionDir = join(tmpDir, 'session-y');
    const trace = makeTrace();

    const loaded = await loadSpaceFromDisk({ sourceDir, sessionDir, trace: trace as never });

    expect(loaded.agents).toEqual([]);
    expect(loaded.functions).toEqual([]);
    expect(loaded.components).toEqual([]);
    expect(loaded.knowledge).toEqual([]);
    expect(loaded.flows).toEqual([]);
    expect(loaded.packageJson).toBeUndefined();
    expect(loaded.readme).toBeUndefined();
  });

  it('honors a custom name override', async () => {
    const sourceDir = join(tmpDir, 'src-space');
    await mkdir(sourceDir, { recursive: true });
    const sessionDir = join(tmpDir, 'session-z');
    const trace = makeTrace();

    const loaded = await loadSpaceFromDisk({
      sourceDir,
      sessionDir,
      trace: trace as never,
      name: 'aliased',
    });

    expect(loaded.name).toBe('aliased');
  });
});
