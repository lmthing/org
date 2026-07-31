import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THING_INSTRUCT = join(
  __dirname, '..', '..', 'system-spaces', 'user-thing', 'agents', 'thing', 'instruct.md',
);

const instruct = () => readFileSync(THING_INSTRUCT, 'utf8');

/**
 * THING's `instruct.md` was one 1270-line file: every routing decision AND the full detail of every
 * route, on every turn, whether or not the turn went near that route — including the whole team
 * surface, which a personal workspace can never use. It is now split, with the detail behind
 * `loadKnowledge('playbooks', field, aspect)`.
 *
 * The STRUCTURAL guards for that split — every load point resolves, every aspect is reachable,
 * every field is declared, and the body does not grow back — are in `agent-prompt-split.test.ts`,
 * which runs them over every split agent. What lives HERE is the part that is specific to THING:
 * which rules must survive a SKIPPED load.
 *
 * That distinction is the whole safety argument for the split. Prose telling the model to load is
 * advisory, never host-enforced, so a load it decides not to spend a turn on has to degrade into
 * "acted without the rationale", never "acted without the rule". Every claim below is therefore
 * asserted against `instruct.md` ALONE, never the corpus: a rule that only holds once a file has
 * been loaded is not always on, and asserting it on the corpus would pass while it silently stopped
 * being true.
 */
describe('user-thing/thing — what must survive a skipped load', () => {
  /**
   * A load costs a turn, so the body must say when to spend it — otherwise THING either loads
   * nothing (and runs a route without its failure modes) or loads on every turn (and pays the
   * turn on the path that needs it least, which is the plain answer that is most messages).
   */
  it('tells THING when to load, and that the plain-answer path needs no load', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Load in the SAME statement you decide/i);
    expect(flat).toMatch(/needs no load at all/i);
    expect(flat).toMatch(/Load the playbook before you act on the path, not after it went wrong/i);
  });

  /**
   * Answering in the user's own language was never written down ANYWHERE — not in the pre-split
   * body, not in an aspect. `06-tanzania` step 11 asserts it (a Greek message about a permit
   * deposit must come back in Greek), and a pre-split run passed it emergently: the model mirrors
   * the language it is written in, and the always-on body happened to say the word "Greek" three
   * times while explaining that ROUTING is language-independent.
   *
   * The split moved that prose into `writing/personal-facts`, and run 56 — which did not load that
   * aspect — wrote the row correctly and answered in ENGLISH. Whether the lost priming caused it is
   * not provable from one run. What IS clear is that an expectation the product is measured on was
   * resting on emergence plus an accident of wording, which is not a thing a split can be expected
   * to preserve. So it is now a rule, in the body, where a rule belongs.
   */
  it('tells THING to reply in the language it was written to in', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Reply in the language the user wrote to you in/i);
    // And that this is about the REPLY, not routing — the two were previously conflated, which is
    // how the reply half ended up unstated.
    expect(flat).toMatch(/Routing does not change/i);
  });

  /**
   * The team surface is the largest thing the split moved, and the one where "the model can just
   * load it" is most dangerous: in a team EVERY reply lands in a permanent shared log read by
   * people who did not ask, so a turn that never reaches for `('playbooks','team','conduct')` must
   * still be safe. These four are therefore ALWAYS ON — and the moment one drifts into `conduct.md`
   * it stops holding on the turns that skip the load. Everything ELSE about teams (the directory,
   * the readers, the writers, the ten-point conduct) is correctly behind the load: it is needed
   * only once a request reaches past the thread it was asked in.
   */
  it('keeps the four always-on team rules in the body, not behind the load', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    // No teamContext in the types ⇒ no team. Without this a personal workspace reaches for globals
    // that are not merely inert but ABSENT — the grants are dropped at parse time off a team pod.
    expect(flat).toMatch(/no `teamContext` in your types ⇒ there is no team/i);
    // Permanent + shared, so nothing internal reaches it. This is the failure a load cannot undo.
    expect(flat).toMatch(/permanent, shared, and read by people who did not ask/i);
    // display() already posts here; teamPost is for elsewhere.
    expect(flat).toMatch(/Your normal reply is not a `teamPost`/i);
    // The role governs, and a declined request still owes an answer.
    expect(flat).toMatch(/asker's ROLE governs every change you make on their behalf/i);
    expect(flat).toMatch(/never a turn that neither did it nor said so/i);
  });
});
