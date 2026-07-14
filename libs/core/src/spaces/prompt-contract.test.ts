import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES = join(__dirname, '..', '..', 'system-spaces');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

describe('system-appbuilder/automator — the empty-app failure', () => {
  /**
   * A big first build (many tables, a large attached file) can burn the whole turn on SEEDING and
   * leave the agent reporting "all tables created and seeded!" with no page ever written. Observed
   * live: THING delegated an explicit app build ("a trip overview page ... per-country sections"),
   * and the automator returned 8 tables and ZERO pages — `/app/<id>/` 404'd. A direct probe on a
   * SMALL app (3 tables) authored index + detail + _layout + 2 API routes and served 200, which is
   * what isolates the cause: not a missing gate, but a missing ORDERING rule. The existing gate says
   * a page is required; it did not say to write it EARLY, before the data can eat the turn.
   */
  it('tells the builder to make the app OPENABLE EARLY, not to leave the page until after the data', () => {
    const instruct = readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'), 'utf8');

    // The page-required gate (the quality rule).
    expect(instruct).toMatch(/not done until it serves at least one PAGE/i);

    // The ordering rule (the one that survives running out of turn) — this is the regression guard.
    expect(
      instruct,
      'the automator must be told to author the home page EARLY (right after the first table), or a large seed run will consume the turn and ship an app with no page',
    ).toMatch(/openable first|make it openable early/i);
    expect(instruct).toMatch(/run out of turn|cut off/i);
  });
});

describe('system-appbuilder/automator — attribution survives the seed', () => {
  /**
   * Observed live (10-family-recipes): the builder seeded a row from material the user handed over
   * and captured every operational detail of it perfectly — while dropping WHO the material was
   * credited to. It even chose a `source` column, then filled it with the CHANNEL the material
   * arrived on rather than the name the material itself states. The user had asked, in as many
   * words, not to lose any of it.
   *
   * The operational content is the half a person can always look up again; the attribution is the
   * half they cannot reconstruct from anywhere else — and is very often why the material was kept.
   * The existing rule covers figures and contacts the source STATES; it did not cover the name it
   * is credited to, nor the near-miss of recording the envelope instead of the fact.
   */
  it('tells the builder to keep the attribution the material carries — and not to record the transport instead', () => {
    const instruct = readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'), 'utf8');

    expect(
      instruct,
      'the automator must be told to keep WHO/WHERE material came from on the record, not just its operational content',
    ).toMatch(/attribution|credited_to|provenance/i);

    // The near-miss guard: a `source` field filled with "from an attachment" LOOKS done and is not.
    expect(
      instruct,
      'the automator must be warned that recording the CHANNEL the material arrived on is not the attribution',
    ).toMatch(/transport is not the attribution|channel the material arrived on/i);
  });
});

describe('user-thing/thing — the ingest turn must ASK, and must not leak its plumbing', () => {
  const instruct = () => readFileSync(join(SYSTEM_SPACES, 'user-thing', 'agents', 'thing', 'instruct.md'), 'utf8');

  /**
   * Observed live (10-family-recipes, Act I): handed a pile of material and a description of a
   * recurring frustration, THING read everything correctly, summarised it beautifully — and then
   * stopped. No question. The user, who does not know that building something is even an option,
   * has nothing to say yes to, and the turn dies there.
   *
   * Withholding the BUILD until they agree is right (that gate exists). Withholding the QUESTION
   * is not: it turns "propose, then build on a plain yes" into "report, then wait forever".
   */
  it('tells THING to end a turn it has decided on with the plain question, then stop', () => {
    expect(
      instruct(),
      'THING must be told to END the ingest turn with the one-sentence offer — a summary that stops without a question leaves the user nothing to answer',
    ).toMatch(/ask,? then stop|end with the decision|END WITH THE DECISION/i);
    expect(instruct()).toMatch(/nothing to answer|say yes/i);
  });

  /**
   * Same turn, second failure: the reply ended with a KeyValue panel of the model's own internals —
   * variable names, their TYPES, and their string LENGTHS. It had been taught to: the instructions'
   * own examples ended `display(seen)` and `display(JSON.stringify(auto, null, 2))`.
   *
   * An example in an agent's brain gets copied into real output. These two were, verbatim.
   */
  it('does not teach THING to display raw specialist/writer return values', () => {
    const src = instruct();
    expect(
      src,
      'the attachment example must not end by displaying the raw specialist return value — the model copies it straight into the user\'s reply',
    ).not.toMatch(/^\s*display\(seen\);?\s*$/m);
    expect(
      src,
      'the build example must not end by dumping the writer\'s return value as JSON',
    ).not.toMatch(/display\(JSON\.stringify\(auto/);
    // And the principle that generalises past those two examples.
    expect(src).toMatch(/never show them your plumbing|debugging output/i);
  });

  /**
   * The near-miss that the first cut of the fix above walked straight into. Deleting `display(seen)`
   * removed the dump — but it also removed the only thing showing the model that the delegate's
   * return value must be CONSUMED IN THE SAME STATEMENT. Told merely "read it, then tell the user",
   * the model deferred the reply to a later statement, where `seen`/`fileAnswer` no longer exist
   * (variables do not persist between statements) — and thrashed on `Cannot find name '…'`,
   * re-reading files it had already read.
   *
   * "Don't dump the value" must always come with "write the prose out of it, here, now".
   */
  it('shows the reply being composed in the SAME statement as the delegate that produced it', () => {
    const src = instruct();
    expect(
      src,
      'the attachment example must still END in a display(...) — composing prose from the returned values, in the same statement',
    ).toMatch(/attachmentIds:[\s\S]{0,600}?\bdisplay\(/);
    expect(
      src,
      'THING must be warned that deferring the reply loses the value: variables do not persist between statements',
    ).toMatch(/do not persist between statements|DO NOT PERSIST between statements/i);
  });
});

describe('system-files readers — source text stays data, never executable code', () => {
  it('tells document and spreadsheet readers to synthesize source material instead of pasting it into TypeScript', () => {
    for (const agent of ['reader', 'sheet']) {
      const instruct = readFileSync(
        join(SYSTEM_SPACES, 'system-files', 'agents', agent, 'instruct.md'),
        'utf8',
      );
      expect(
        instruct,
        `${agent} must be told that raw uploaded material is data rather than code`,
      ).toMatch(/source material is data|sheet contents are data/i);
      expect(
        instruct,
        `${agent} must be told to synthesize rather than paste raw document text into TypeScript`,
      ).toMatch(/synthesize; never paste/i);
      expect(instruct).toMatch(/parse\/typecheck failures/i);
    }
  });
});

describe('system-architect/synthesize_and_run — the design node must hand the model code that TYPECHECKS', () => {
  /**
   * The design node's own example declared `const functions = [];` and then passed it straight to
   * `currentTask.resolve({ slug, goal, actionId, fields, functions })`. A bare empty array literal
   * is an "evolving array": push to it and TS infers the element type, but USE it before anything
   * has been pushed and the type can never be determined. That exact shape fails typecheck:
   *
   *   TS7034: Variable 'functions' implicitly has type 'any[]' in some locations…
   *   TS7005: Variable 'functions' implicitly has an 'any[]' type.
   *
   * The model copies the example, so this fired on EVERY specialist build — and the retry cascade
   * from there is a trap: redeclaring it gives "Cannot redeclare block-scoped variable", and
   * assigning to it gives "Cannot assign to 'functions' because it is a constant". Observed live
   * (10-family-recipes Act I) as unrecovered typecheck errors that burned the authoring turn.
   *
   * A prompt that hands the model uncompilable code is a bug in the prompt.
   */
  it('annotates the empty `functions` array instead of leaving it to be inferred', () => {
    const design = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', '01-design.md'),
      'utf8',
    );

    expect(
      design,
      'a bare `const functions = [];` cannot typecheck once it is passed to currentTask.resolve — annotate the element type',
    ).not.toMatch(/const\s+functions\s*=\s*\[\s*\]\s*;/);

    expect(
      design,
      'the design node must declare `functions` with an explicit element type',
    ).toMatch(/const\s+functions\s*:\s*(Array<|\{[\s\S]*?\}\[)/);
  });
});

describe('no system-space prompt is overfitted to a scenario', () => {
  /**
   * A system-space prompt is a brain EVERY user shares. A literal borrowed from one scenario
   * (a persona's name, a fixture's contents, a scenario's table name) teaches the agent the answer
   * to one exam question and makes it dumber everywhere else — and examples in a prompt get COPIED
   * INTO REAL OUTPUT (hardcoded example values have previously landed verbatim in real users' data).
   * A "don't do this" example is one careless read away from becoming a "do this" template, so this
   * guard applies to negative examples too.
   *
   * These are literals from the live scenario suite. None of them belongs in any agent's brain.
   */
  const SCENARIO_LITERALS = [
    'Huchuypicchu',   // 05-latam — the Machu Picchu PDF's circuit name
    'Churuquella',    // 05-latam — the voice memo's Sucre viewpoint
    'Wild Rover',     // 05-latam — the trip-notes hostel
    'Red Planet Expedition', // 05-latam — the screenshot's Uyuni operator
    'Torres del Paine',      // 05-latam — the spreadsheet's park-fee line
    'ZZJQUU',         // a booking ref that once leaked into real users' data
    'boiler_service_log',
    'household_items',
  ];

  it('contains no scenario-specific literal in any instruct.md / charter.md / knowledge file', () => {
    const offenders: string[] = [];
    for (const file of walk(SYSTEM_SPACES)) {
      const body = readFileSync(file, 'utf8');
      for (const lit of SCENARIO_LITERALS) {
        if (body.includes(lit)) offenders.push(`${relative(SYSTEM_SPACES, file)} contains "${lit}"`);
      }
    }
    expect(
      offenders,
      'a scenario literal in a system-space prompt is overfitting: it teaches the agent one exam answer and can be copied verbatim into a real user\'s data',
    ).toEqual([]);
  });
});
