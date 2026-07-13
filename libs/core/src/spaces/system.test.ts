import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadSystemSpaces,
  systemFunctionNames,
  systemFunctionSources,
  defaultSystemSpaceDirs,
} from './system.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/spaces → libs/core/system-spaces
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const GLOBAL_DIR = join(SYSTEM_SPACES_ROOT, 'system-global');
const ARCHITECT_DIR = join(SYSTEM_SPACES_ROOT, 'system-architect');

describe('system spaces', () => {
  it('loads the system-global system space (no agents/ required)', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    expect(spaces.length).toBe(1);
    const global = spaces[0]!;
    // The generic fs wrappers (readFile/writeFile/editFile/listDir/glob/grep) were REMOVED
    // from system-global (they mis-rooted at the caller's space dir). They now live only in
    // system-engineer/functions, scoped to the engineer + jailed to a scratch sandbox.
    expect(Object.keys(global.functions).sort()).toEqual([
      'forget', 'recall', 'recallAll', 'remember',
      'todoRead', 'todoWrite', 'webFetch', 'webSearch',
    ]);
  });

  it('exposes system-global function names universally', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    const names = systemFunctionNames(spaces);
    expect(names.has('webSearch')).toBe(true);
    expect(names.has('remember')).toBe(true);
    // the generic fs wrappers are no longer universal — they moved to system-engineer.
    expect(names.has('readFile')).toBe(false);
    expect(names.has('grep')).toBe(false);
  });

  it('ONLY system-global functions are universal — agent-bearing spaces stay scoped', async () => {
    // system-global + system-architect loaded together: the toolkit is universal, but
    // the architect's own functions are NOT (they reach the architect via its frontmatter).
    const spaces = await loadSystemSpaces([GLOBAL_DIR, ARCHITECT_DIR]);
    const universal = systemFunctionSources(spaces);
    expect('webSearch' in universal).toBe(true);
    expect('remember' in universal).toBe(true);
    // fs wrappers are engineer-scoped now, not universal.
    expect('readFile' in universal).toBe(false);
    expect('writeTaskFile' in universal).toBe(false);
    expect('writeAgentFile' in universal).toBe(false);
    expect('validateSpace' in universal).toBe(false);
  });

  it('defaultSystemSpaceDirs points under libs/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/system-global'))).toBe(true);
    expect(dirs.length).toBe(10);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-research'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-appbuilder'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-vision'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-files'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-store'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-google'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-slack'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-github'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-memory'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-thing'))).toBe(true);
  });

  it('defaultSystemSpaceDirs resolves to dirs that actually exist (dist + src layouts)', () => {
    // Probing both layouts means the path is real whether run from dist/ or src/.
    const dirs = defaultSystemSpaceDirs();
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-global'))!)).toBe(true);
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-architect'))!)).toBe(true);
  });

  // ── THING's shipped judgment: the propose/consent contract ───────────────────────
  //
  // Live-prod evidence (scenario 06, baseline run): handed five documents and "I can't keep
  // this straight — can you help me get on top of it?", THING read every file correctly and
  // then did NOTHING — no offer, no spaces, no app. A bare "Yes please." (23s) and even an
  // explicit "Is it ready? Can I open it yet?" (33s) produced zero tables and zero spaces,
  // and the turn's final display() was a bare character count ("24872") rather than a reply.
  //
  // The cause was entirely in the prompt: it taught RESTRAINT (never scaffold an app on a
  // vague request) with no counterweight telling THING to PROPOSE, and never said that the
  // last thing it displays is the only thing the user reads. Users do not know an app is on
  // the menu, so if THING never offers, it is never asked. These assertions pin the three
  // load-bearing promises into CI so a future edit cannot quietly delete them again.
  it('THING is told to PROPOSE (offer→consent), to build the parts, and to end on a real reply', async () => {
    const spaces = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'user-thing')]);
    const thing = spaces[0]?.agents['thing'];
    expect(thing, 'user-thing must ship a "thing" agent').toBeDefined();
    const instruct = thing!.instructBody;

    // 1. It must OFFER unasked when handed material + an ongoing need — and wait, not build.
    expect(instruct).toMatch(/OFFER — do not wait to be asked/);
    expect(instruct).toMatch(/Do not author anything on the same turn as the offer/);

    // 2. A bare "yes" to its OWN offer is the consent path 4 requires (no re-spec, no re-offer).
    expect(instruct).toMatch(/A bare yes to YOUR OWN offer is CONSENT/);

    // 3. Distinct parts of the material get their own spaces — THING's call, never the user's.
    expect(instruct).toMatch(/When the material splits into distinct PARTS, build the spaces too/);
    expect(instruct).toMatch(/must\s+never be asked to name one/);

    // 4. A turn may never end on a raw artifact (the "24872" failure).
    expect(instruct).toMatch(/LAST `display\(\)` is the only thing the user actually reads/);

    // …and the restraint it counterbalances must SURVIVE: propose, but still never scaffold
    // an app onto a vague opener. Losing this would trade one failure mode for the other.
    expect(instruct).toMatch(/Do NOT scaffold an app on a vague or exploratory request/);
  });
});
