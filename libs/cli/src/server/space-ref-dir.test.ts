/**
 * space-ref-dir.test.ts — a `spaceRef` must reach the space it names.
 *
 * The bug this pins: `projectSpaceDir` returns `<root>/<project>/spaces/<id>`, and a SYSTEM space is
 * never materialized there — it lives once at `<root>/system/spaces/<id>`. So every `system-*`
 * spaceRef resolved to a directory that does not exist, `loadSpace` produced an empty space, and the
 * agent slug fell through to the flattened merge of all system spaces, where the last space to
 * define that slug wins.
 *
 * It was found when `system-appbuilder` and `system-viewbuilder` shipped side by side: both defined
 * `automator`, `api-author`, `data-modeler` AND a `build_live_project` tasklist, and the viewbuilder
 * sorted later in `SYSTEM_SPACE_NAMES`. A session bound to `system-appbuilder/automator` therefore
 * ran the viewbuilder's agent and tasklist and wrote `.view.json` specs — from a ref that named the
 * appbuilder in as many words.
 *
 * Nothing about it looked wrong: the session ledger recorded the correct `spaceRef`, the run
 * completed, and the app built. It was only visible by running the two builders on the same brief
 * and noticing the outputs were the same medium.
 *
 * The two builders have since merged, so that specific pair no longer collides — which is exactly why
 * these tests use SYNTHETIC space dirs rather than the shipped ones. The bug is about resolution, not
 * about those two spaces, and it reappears the moment any two system spaces share an agent slug.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSpaceDir, resolveSpaceRefDir } from './projects.js';

let root: string;

const makeSpace = (dir: string, agent: string) => {
  mkdirSync(join(dir, 'agents', agent), { recursive: true });
  writeFileSync(join(dir, 'agents', agent, 'instruct.md'), '---\ntitle: X\n---\nbody');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lm-spaceref-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveSpaceRefDir', () => {
  it('THE REGRESSION: a system space resolves to the system dir, not a project path that does not exist', () => {
    makeSpace(join(root, 'system', 'spaces', 'system-appbuilder'), 'automator');
    const resolved = resolveSpaceRefDir(root, 'my-project', 'system-appbuilder');
    expect(resolved).toBe(join(root, 'system', 'spaces', 'system-appbuilder'));
    // …and the old behaviour, which is what silently produced the wrong agent:
    expect(projectSpaceDir(root, 'my-project', 'system-appbuilder')).not.toBe(resolved);
  });

  it('a project copy still WINS, so a user-customized space keeps overriding the shipped one', () => {
    makeSpace(join(root, 'system', 'spaces', 'system-appbuilder'), 'automator');
    makeSpace(join(root, 'my-project', 'spaces', 'system-appbuilder'), 'automator');
    expect(resolveSpaceRefDir(root, 'my-project', 'system-appbuilder')).toBe(projectSpaceDir(root, 'my-project', 'system-appbuilder'));
  });

  it('an ordinary project space is unaffected', () => {
    makeSpace(join(root, 'my-project', 'spaces', 'travel'), 'planner');
    expect(resolveSpaceRefDir(root, 'my-project', 'travel')).toBe(projectSpaceDir(root, 'my-project', 'travel'));
  });

  it('an unknown space keeps the project path — the caller still reports "not found" against the project', () => {
    expect(resolveSpaceRefDir(root, 'my-project', 'nope')).toBe(projectSpaceDir(root, 'my-project', 'nope'));
  });

  it('a dir without agents/ is not a space — an empty placeholder must not shadow the real one', () => {
    mkdirSync(join(root, 'my-project', 'spaces', 'system-appbuilder'), { recursive: true });
    makeSpace(join(root, 'system', 'spaces', 'system-appbuilder'), 'automator');
    expect(resolveSpaceRefDir(root, 'my-project', 'system-appbuilder')).toBe(join(root, 'system', 'spaces', 'system-appbuilder'));
  });
});
