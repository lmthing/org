import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace } from './load.js';

/**
 * There is NO generic filesystem on any agent's model surface — `readFile`/`writeFile`/`listDir`/
 * `glob`/`grep` are absent from every DTS (the typed-only-fs redesign). "Not granted ⇒ not injected
 * AND absent from the DTS", so a guess at one is a *typecheck* error, not a runtime throw.
 *
 * That is a good security property with one sharp edge: a model that has never been TOLD the
 * filesystem is gone will keep reaching for it, and each guess burns a whole retry before it has
 * written anything. This was measured on a live run — the Architect's `explore` forks produced a
 * repeating `Cannot find name 'glob' / 'grep' / 'listDir'` retry storm while scaffolding a space.
 *
 * The Architect runs most of its work in FORKS, and a fork sees `charter.md`, not `instruct.md`
 * (see `context/system-block.ts` — the charter is injected into forks, the instruct body is
 * top-level/delegate only). So the rule has to live in the CHARTER or a fork never sees it.
 *
 * This test is the regression guard: it fails if the guidance is ever dropped back out of the
 * fork-visible text.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES = join(__dirname, '..', '..', 'system-spaces');

/** The generic-fs names a model is most likely to guess at when it wants to look around. */
const ABSENT_FS_GLOBALS = ['readFile', 'writeFile', 'listDir', 'glob', 'grep'];

describe('fork-visible fs guidance (system-architect)', () => {
  it('injects the "there is no generic filesystem" rule into EVERY fork via charter.md', async () => {
    const space = await loadSpace(join(SYSTEM_SPACES, 'system-architect'));
    const architect = space.agents['architect'];
    expect(architect, 'system-architect must ship an `architect` agent').toBeTruthy();

    const charter = architect!.charterBody;
    expect(charter, 'the architect must have a charter — it is the only text its forks see').toBeTruthy();

    // The rule must name the absent globals explicitly. A vague "use the typed writers" does not
    // stop a model from *trying* `glob` first; naming them is what makes it stop.
    for (const g of ABSENT_FS_GLOBALS) {
      expect(
        charter,
        `charter.md must name \`${g}\` as absent, or an explore fork will keep guessing at it and burn a retry`,
      ).toContain(g);
    }

    // And it must say WHY guessing is not free — that is the part that changes behaviour.
    expect(charter.toLowerCase()).toMatch(/typecheck|not there|do not exist|does not exist/);
  });

  it('does not actually grant the architect any generic-fs function (the prompt matches reality)', async () => {
    const space = await loadSpace(join(SYSTEM_SPACES, 'system-architect'));
    const architect = space.agents['architect'];
    const granted = architect!.config.functions ?? [];

    // The charter's claim has to stay TRUE. If someone ever grants a generic-fs function, the
    // charter becomes a lie and this test says so.
    for (const g of ABSENT_FS_GLOBALS) {
      expect(granted, `the charter tells forks \`${g}\` does not exist — it must not be granted`).not.toContain(g);
    }
    // The typed readers it DOES have are the ones the charter points at instead.
    expect(granted).toContain('readSpaceFile');
    expect(granted).toContain('listSpaceDir');
  });
});
