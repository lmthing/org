import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTOMATOR_INSTRUCT = join(
  __dirname, '..', '..', 'system-spaces', 'system-appbuilder', 'agents', 'automator', 'instruct.md',
);

const instruct = () => readFileSync(AUTOMATOR_INSTRUCT, 'utf8');

/**
 * The automator's `instruct.md` was 781 lines, paid in full on EVERY delegate turn — and in the
 * common case that turn emits one statement (`tasklist('build_live_project', …)`) and touches no
 * writer at all, because `instruct.md` is deliberately NOT injected into a fork/tasklist node
 * (`fork/fork.ts` — it carries ask/delegate/UI prose a fork cannot honor). So every line of
 * hook-authoring, cron-emitter and page-growing detail was charged to a turn that then handed the
 * whole job to a pipeline whose own step prompts carry that detail already.
 *
 * The detail now sits in `app_building/{authoring,automation}/*`. The structural guards are in
 * `agent-prompt-split.test.ts`; what is here is the automator's half of the safety argument —
 * which rules must survive a turn that loads NOTHING. Each is asserted against `instruct.md`
 * alone, never the corpus.
 */
describe('system-appbuilder/automator — what must survive a skipped load', () => {
  /**
   * The decision itself. If the body does not carry the four-job table and the "load before you
   * author" rule, the agent cannot know an aspect exists, and lazy detail becomes no detail.
   */
  it('carries the job decision and tells the automator to load before it authors', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Load in the SAME statement you decide, before you author anything/i);
    // The one job that must NOT load: a first whole-app build answers with the tasklist.
    expect(flat).toMatch(/A FIRST whole-app build/i);
    expect(flat).toMatch(/no loads, no writers/i);
  });

  /**
   * The writer list is the vocabulary. An agent that cannot see `writeProjectComponent` in its
   * always-on body has no reason to load the aspect that tells it when to reach for one — which is
   * exactly how the writer went unused for a whole scenario while it was granted the whole time.
   */
  it('advertises every writer in the always-on body', () => {
    const src = instruct();
    for (const w of [
      'writeProjectTable', 'writeProjectHook', 'writeProjectEvent', 'writeProjectApi',
      'writeProjectPage', 'writeProjectComponent', 'writeProjectFunction',
    ]) {
      expect(src, `${w} must stay advertised in the body — you cannot decide to load detail about a writer you cannot see`).toMatch(new RegExp(`${w}\\(`));
    }
  });

  /**
   * The rules that hold on EVERY write, whatever job it is. Each of these shipped as a real failure
   * into a real user's project, and each is one an agent can commit on a turn that loaded nothing:
   * a fabricated table of believable rows, a "seeded!" report over an empty schema, a home page
   * overwritten into a stub, a second table for a concept that already had one, a hook bound to an
   * event address nothing emits.
   */
  it('keeps the every-write rules in the body, not behind a load', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    // Never reconstruct a source you cannot see. The dangerous failure is the FULL table, not the empty one.
    expect(flat).toMatch(/If you cannot SEE the source, STOP/i);
    expect(flat).toMatch(/An empty table is honest; a fabricated one is a lie/i);
    // Never report a write you did not make — and re-read before you report one you did.
    expect(flat).toMatch(/Never report that you "moved the data in"/i);
    expect(flat).toMatch(/run the write, RE-READ, and report what the row NOW says/i);
    // Surveying is not building.
    expect(flat).toMatch(/SURVEYING IS NOT BUILDING/);
    expect(flat).toMatch(/A repair request naming a missing page is a WRITE, not a diagnosis/i);
    // Never overwrite what the user already has, at page level or column level.
    expect(flat).toMatch(/Never OVERWRITE what the user already has/i);
    // A second run converges rather than doubling.
    expect(flat).toMatch(/Running twice must CONVERGE on the same app, never double it/i);
    // A hook must bind to a REAL event — a fabricated address loads fine and never fires.
    expect(flat).toMatch(/Ground every hook in a REAL event and a REAL action/i);
    // The openable-early ordering rule, which only matters on a turn that runs long.
    expect(flat).toMatch(/Openable first, complete second/i);
  });

  /**
   * The assistant dock is mandatory on every app and is short enough that hiding it behind a load
   * buys nothing — while a build that skips the load ships an app with no way to ask for the next
   * change from inside it.
   */
  it('keeps the mandatory assistant dock in the body', () => {
    const src = instruct();
    expect(src).toMatch(/EVERY app ships the assistant dock/i);
    expect(src).toMatch(/pages\/_layout/);
    expect(src).toMatch(/agent=\\"thing\\"/);
  });
});
