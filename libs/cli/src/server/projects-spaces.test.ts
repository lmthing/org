/**
 * Project spaces listing — keyless, in-process. Proves SessionManager
 * .listProjectSpaces() summarizes every immediate sub-directory of
 * `<root>/<projectId>/spaces/` into a SpaceMeta (name, agents, actions,
 * counts), skips unreadable dirs, and returns [] when none exist.
 *
 * No API keys — it only exercises the on-disk summary path (loadSpace),
 * not the model turn loop.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs, SpaceMeta } from './session-manager.js';

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** A no-op manager — listing never builds a session or streams, so streamFn
 *  and buildSession are stubs that throw if reached. Cast keeps the opts shape
 *  honest without dragging in a real mock provider. */
function makeManager(root: string): SessionManager {
  const opts = {
    lmthingRoot: root,
    snapshotsDir: join(root, '.snaps'),
    streamFn: () => Promise.reject(new Error('streamFn should not be called for listing')),
    buildSession: (_args: BuildSessionArgs) => {
      throw new Error('buildSession should not be called for listing');
    },
  } as unknown as ConstructorParameters<typeof SessionManager>[0];
  return new SessionManager(opts);
}

async function writeAgent(
  spaceDir: string,
  slug: string,
  body: string,
): Promise<void> {
  const file = join(spaceDir, 'agents', slug, 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}

describe('SessionManager.listProjectSpaces (keyless, on-disk)', () => {
  it('lists synthesized spaces with agents, actions, and counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-projspaces-'));
    tmpDirs.push(root);

    // Space 1: one agent with an action + a function + knowledge.
    const sauceDir = join(root, 'user', 'spaces', 'sauce-master');
    await writeAgent(
      sauceDir,
      'sauce-master',
      [
        '---',
        'title: SauceMaster',
        'actions:',
        '  - id: recommend',
        '    label: Recommend a sauce',
        '    tasklist: recommend',
        '---',
        'A global sauce technique specialist.',
      ].join('\n') + '\n',
    );
    await mkdir(join(sauceDir, 'functions'), { recursive: true });
    await writeFile(join(sauceDir, 'functions', 'pickSauce.ts'), 'export const pickSauce = () => 1;', 'utf8');
    await mkdir(join(sauceDir, 'knowledge', 'cuisines', 'region'), { recursive: true });
    // The action references a tasklist — provide one so loadSpace accepts it.
    await mkdir(join(sauceDir, 'tasklists', 'recommend'), { recursive: true });
    await writeFile(join(sauceDir, 'tasklists', 'recommend', '1.pick.md'), '# Pick\n', 'utf8');

    // Space 2: an agent with no extras.
    const pairDir = join(root, 'user', 'spaces', 'sommelier');
    await writeAgent(pairDir, 'sommelier', '---\ntitle: Sommelier\n---\nPairs wine with food.\n');

    const manager = makeManager(root);
    const spaces: SpaceMeta[] = await manager.listProjectSpaces('user');

    expect(spaces.map((s) => s.id)).toEqual(['sauce-master', 'sommelier']);

    const sauce = spaces.find((s) => s.id === 'sauce-master')!;
    expect(sauce.name).toBe('SauceMaster');
    expect(sauce.description).toBe('A global sauce technique specialist.');
    expect(sauce.agents).toHaveLength(1);
    expect(sauce.agents[0]!.actions.map((a) => a.id)).toEqual(['recommend']);
    expect(sauce.functionCount).toBe(1);
    expect(sauce.hasKnowledge).toBe(true);

    const pair = spaces.find((s) => s.id === 'sommelier')!;
    expect(pair.name).toBe('Sommelier');
    expect(pair.functionCount).toBe(0);
    expect(pair.hasKnowledge).toBe(false);
    expect(pair.agents[0]!.actions).toEqual([]);
  });

  it('returns [] when the project has no spaces dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-projspaces-empty-'));
    tmpDirs.push(root);
    const manager = makeManager(root);
    await expect(manager.listProjectSpaces('user')).resolves.toEqual([]);
  });

  it('skips an unreadable space dir instead of failing the whole list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-projspaces-skip-'));
    tmpDirs.push(root);

    // A valid space alongside a junk dir whose package.json is invalid JSON —
    // loadSpace throws, so the listing skips it rather than failing outright.
    await writeAgent(join(root, 'user', 'spaces', 'good'), 'good', '---\ntitle: Good\n---\nFine.\n');
    await mkdir(join(root, 'user', 'spaces', 'junk'), { recursive: true });
    await writeFile(join(root, 'user', 'spaces', 'junk', 'package.json'), '{ not valid json', 'utf8');

    const manager = makeManager(root);
    const spaces = await manager.listProjectSpaces('user');
    expect(spaces.map((s) => s.id)).toEqual(['good']);
  });

  it('rejects an invalid project id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-projspaces-badid-'));
    tmpDirs.push(root);
    const manager = makeManager(root);
    await expect(manager.listProjectSpaces('../escape')).rejects.toThrow(/invalid project id/);
  });
});

describe('SessionManager.listProjects — synthetic system project', () => {
  it('surfaces system/user spaces under a synthetic "system" project, browsable + listable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-sysproj-'));
    tmpDirs.push(root);

    // A real user project.
    await writeAgent(join(root, 'user', 'spaces', 'mine'), 'mine', '---\ntitle: Mine\n---\nUser space.\n');
    await writeFile(join(root, 'user', 'project.json'), JSON.stringify({ id: 'user', name: 'Personal', createdAt: 5 }), 'utf8');

    // System spaces live under <root>/system/spaces/ (as materialized on init).
    await writeAgent(join(root, 'system', 'spaces', 'user-thing'), 'thing', '---\ntitle: THING\n---\nThe main agent.\n');
    await writeAgent(join(root, 'system', 'spaces', 'system-global'), 'g', '---\ntitle: Global\n---\nPlatform toolkit.\n');

    const manager = makeManager(root);

    // listProjects prepends the synthetic system project.
    const projects = await manager.listProjects();
    const ids = projects.map((p) => p.id);
    expect(ids).toContain('system');
    expect(ids).toContain('user');
    expect(ids[0]).toBe('system'); // prepended

    // Its spaces resolve from <root>/system/spaces/.
    const sysSpaces = await manager.listProjectSpaces('system');
    expect(sysSpaces.map((s) => s.id).sort()).toEqual(['system-global', 'user-thing']);
  });

  it('labels a store-installed project from its `title` when `name` is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-installed-'));
    tmpDirs.push(root);

    // Store-installed apps synthesize project.json with `title` (no `name`),
    // and omit `createdAt` to stay hash-deterministic — see ensureProjectJson
    // in server/routes/apps.ts. The switcher reads `name`, so listProjects must
    // fall back name→title→id or the project renders with a blank label.
    await writeAgent(join(root, 'blog', 'spaces', 'writer'), 'writer', '---\ntitle: Writer\n---\nWrites.\n');
    await writeFile(
      join(root, 'blog', 'project.json'),
      JSON.stringify({ id: 'blog', title: 'Blog', description: 'A blog app', icon: null }),
      'utf8',
    );

    const manager = makeManager(root);
    const projects = await manager.listProjects();
    const blog = projects.find((p) => p.id === 'blog');
    expect(blog).toBeDefined();
    expect(blog?.name).toBe('Blog'); // falls back to title, not blank
    expect(typeof blog?.createdAt).toBe('number'); // defaulted from mtime
  });

  it('omits the synthetic system project when there are no system spaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-sysproj-empty-'));
    tmpDirs.push(root);
    await mkdir(join(root, 'user'), { recursive: true });
    await writeFile(join(root, 'user', 'project.json'), JSON.stringify({ id: 'user', name: 'Personal', createdAt: 5 }), 'utf8');
    const manager = makeManager(root);
    const ids = (await manager.listProjects()).map((p) => p.id);
    expect(ids).not.toContain('system');
  });

  it('refuses to delete the synthetic system project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-sysproj-del-'));
    tmpDirs.push(root);
    await writeAgent(join(root, 'system', 'spaces', 'user-thing'), 'thing', '---\ntitle: THING\n---\nMain.\n');
    const manager = makeManager(root);
    await expect(manager.deleteProject('system')).rejects.toThrow(/system project cannot be deleted/);
  });
});
