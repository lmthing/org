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
 * The detail now sits in `app_building/{model,authoring}/*`. The structural guards are in
 * `agent-prompt-split.test.ts`; what is here is the automator's half of the safety argument —
 * which rules must survive a turn that loads NOTHING. Each is asserted against `instruct.md`
 * alone, never the corpus.
 *
 * There is now exactly ONE builder and its pages are SPECS, so the rules below are the SPEC
 * builder's always-on set. The old TSX-only ones (a dangling import, a `{ type, props }` return, a
 * surface token used as text) are gone from this file because that whole fault class cannot be
 * authored here at all.
 */
describe('system-appbuilder/automator — what must survive a skipped load', () => {
  /**
   * The decision itself. If the body does not carry the job decision and the "load before you
   * author" rule, the agent cannot know an aspect exists, and lazy detail becomes no detail.
   */
  it('carries the job decision and tells the automator to load before it authors', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Load in the SAME statement you decide, before you author anything/i);
    // The one job that must NOT load: a first whole-app build answers with the tasklist and
    // nothing else — no aspect is worth a turn when the next statement hands the job over.
    expect(flat).toMatch(/A FIRST whole-app build/i);
    expect(flat).toMatch(/A first whole-app build needs NONE of them — it goes straight to the tasklist/i);
  });

  /**
   * The writer list is the vocabulary. An agent that cannot see `writeProjectViewComponent` in its
   * always-on body has no reason to load the aspect that tells it when to reach for one — which is
   * exactly how the writer went unused for a whole scenario while it was granted the whole time.
   */
  it('advertises every writer in the always-on body', () => {
    const src = instruct();
    for (const w of [
      'writeProjectTable', 'writeProjectHook', 'writeProjectEvent', 'writeProjectApi',
      'writeProjectView', 'writeProjectViewComponent', 'writeProjectViewShell', 'writeProjectFunction',
    ]) {
      expect(src, `${w} must stay advertised in the body — you cannot decide to load detail about a writer you cannot see`).toMatch(new RegExp(`${w}\\(`));
    }
  });

  /**
   * The two TSX writers are named ONLY to say they are absent, and to say WHY they are absent —
   * because the capability profile does not carry them, so the call is a typecheck error rather
   * than a rule. A model that is merely ASKED not to write TSX writes TSX; one whose DTS lacks
   * `writeProjectPage` cannot. Naming the mechanism is what stops the agent hunting for the writer
   * it half-remembers, and it must survive a turn that loads nothing.
   */
  it('explains that the TSX writers are absent by CAPABILITY, not by instruction', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/You do not have `writeProjectPage` or `writeProjectComponent`/);
    expect(flat).toMatch(/not in your capability profile[^.]*not injected[^.]*not in your type declarations/i);
    expect(flat).toMatch(/typecheck error, not a rule you could bend/i);
    // And no writer list may advertise them as available.
    expect(instruct()).not.toMatch(/^- `writeProjectPage\(/m);
    expect(instruct()).not.toMatch(/^- `writeProjectComponent\(/m);
  });

  /**
   * The rules that hold on EVERY turn, whatever job it is — each one a failure an agent can commit
   * on a turn that loaded nothing:
   *  - authoring a surface the closed vocabulary cannot express by forcing it into the nearest
   *    section kind (there is no second builder to hand it to any more, so the escape hatch that
   *    used to exist is now a lie);
   *  - putting a computation on the page, which has no `.map`, no ternary and no `${…}`;
   *  - fabricating a pipeline outcome after the envelope binding was lost;
   *  - re-running the whole pipeline on a lost envelope and burning the budget;
   *  - growing an app with tables and no page, so the user sees nothing new.
   */
  it('keeps the every-turn rules in the body, not behind a load', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    // The vocabulary is a CEILING, and an honest refusal is the deliverable.
    expect(flat).toMatch(/When the vocabulary genuinely cannot express a surface, SAY SO/i);
    expect(flat).toMatch(/there is no other builder to hand it to/i);
    expect(flat).toMatch(/Forcing the surface into the nearest section kind is the one failure this builder is measured on/i);
    // A page has no client code, so every value it shows is the endpoint's job.
    expect(flat).toMatch(/The endpoint must return everything the section shows/i);
    expect(flat).toMatch(/Values are \*\*paths, never expressions\*\*/i);
    // One statement, resolved in the same statement — a binding does not survive a turn boundary.
    expect(flat).toMatch(/never bind the envelope to a name and resolve it in a later statement/i);
    // Never invent an outcome you did not see, and never re-run the pipeline to recover one.
    expect(flat).toMatch(/written from memory is a FABRICATION/);
    expect(flat).toMatch(/Do NOT call `tasklist\('build_live_project', …\)` a second time/i);
    // The openable-early ordering rule, which only matters on a turn that runs long.
    expect(flat).toMatch(/GROWING an app is not done until the new data serves a PAGE/i);
    expect(flat).toMatch(/Openable first, complete second/i);
    // The reader-field trap that aborts a turn before any write lands.
    expect(flat).toMatch(/Field names differ by reader/i);
  });

  /**
   * The assistant dock is mandatory on every app, and in a spec app it is part of the SHELL — one
   * writer call, advertised in the always-on body, so a build that loads nothing still knows the
   * app needs a way to ask for the next change from inside it.
   */
  it('says the shell writer is NAVIGATION, and that the dock is not the model’s to author', () => {
    const src = instruct();
    expect(src).toMatch(/writeProjectViewShell\(shell\)[^\n]*NAVIGATION/i);
    // The dock is renderer chrome: present on every page of every app. A body that told the model
    // to author one would be teaching it to remember something it cannot forget — and the measured
    // failure of the old shape was exactly forgetting it.
    expect(src).toMatch(/renderer chrome/i);
    expect(src).not.toMatch(/pages\/_layout/);
  });
});
