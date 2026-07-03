import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSpace } from './load.js';

const tmpDirs: string[] = [];

/** Build a throwaway space on disk and return its dir. */
async function makeSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-space-'));
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

describe('loadSpace reference validation', () => {
  it('throws when an agent declares a function with no backing file', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\nfunctions:\n  - missingFn\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/requires function "missingFn"/);
  });

  it('throws when an agent declares a component with no backing dir', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\ncomponents:\n  - GhostWidget\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/requires component "GhostWidget"/);
  });

  it('throws when an agent references a knowledge domain that does not exist', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\nknowledge:\n  - nope/field\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/domain "nope" was not found/);
  });

  it('throws when an agent references a knowledge field that does not exist', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\nknowledge:\n  - things/missing\n---\nbody',
      'knowledge/things/present/index.md': '---\ntype: string\n---\n',
      'knowledge/things/present/opt.md': 'content',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/field "missing" was not found in domain "things"/);
  });

  it('loads a valid space whose refs all resolve', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md':
        '---\nfunctions:\n  - greet\ncomponents:\n  - Box\nknowledge:\n  - things/present\n---\nbody',
      'functions/greet.ts': 'export function greet() { return "hi"; }',
      'components/view/Box.tsx': 'export default function Box() { return null; }',
      'knowledge/things/present/index.md': '---\ntype: string\n---\n',
      'knowledge/things/present/opt.md': 'content',
    });
    const space = await loadSpace(dir);
    expect(Object.keys(space.agents)).toEqual(['a']);
  });

  it('propagates a malformed-YAML error from an agent instruct.md', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\ntitle: [unclosed\n  : : :\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/Invalid YAML frontmatter/);
  });
});

describe('loadSpace agent-frontmatter allow-list gate', () => {
  it('throws on an unknown top-level frontmatter key', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\ntitle: A\nbogusKey: 1\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/disallowed frontmatter key\(s\): bogusKey/);
  });

  it('accepts every existing frontmatter key (back-compat)', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md':
        '---\ntitle: A\ndefaultAction: go\ncanDelegateTo: ["*"]\ndependencies: []\nactions:\n  - id: go\n    label: Go\n    description: d\n    tasklist: tl\n---\nbody',
      'tasklists/tl/00-x.md': 'step',
    });
    const space = await loadSpace(dir);
    expect(space.agents['a']!.capabilities).toEqual({});
  });

  it('parses capabilities and attaches AppCapabilities to the agent', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md':
        '---\ntitle: A\ncapabilities:\n  - db:schema\n  - pages:write\n  - api:call: { allow: [markRead] }\n---\nbody',
    });
    const space = await loadSpace(dir);
    expect(space.agents['a']!.capabilities).toEqual({
      'db:schema': {},
      'pages:write': true,
      'api:call': { allow: ['markRead'] },
    });
  });

  it('fails loud on a bad capability (bare api:call)', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\ncapabilities:\n  - api:call\n---\nbody',
    });
    await expect(loadSpace(dir)).rejects.toThrow(/"api:call" requires a config/);
  });

  it('checks db table existence against knownTables when supplied', async () => {
    const dir = await makeSpace({
      'agents/a/instruct.md': '---\ncapabilities:\n  - db:read: { tables: [ghost] }\n---\nbody',
    });
    await expect(loadSpace(dir, { knownTables: ['sources'] })).rejects.toThrow(
      /names table\(s\) not in the project's database/,
    );
    // Defers (no throw) when knownTables is omitted.
    const space = await loadSpace(dir);
    expect(space.agents['a']!.capabilities).toEqual({ 'db:read': { tables: ['ghost'] } });
  });
});
