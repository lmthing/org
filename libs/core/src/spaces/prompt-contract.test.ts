import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPromptCorpus, loadPointsIn } from './agent-prompt-corpus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES = join(__dirname, '..', '..', 'system-spaces');

/** THING's whole readable prompt: the always-on instruct body plus every `playbooks/*`
 *  knowledge file it can pull in with `loadKnowledge`. Doctrine that lives behind a load
 *  is asserted against THIS; anything that must hold on EVERY turn is asserted against
 *  `instruct.md` alone. See `agent-prompt-corpus.ts`. */
const thingCorpus = () => agentPromptCorpus(join(SYSTEM_SPACES, 'user-thing'), 'thing');

/** The automator's whole readable prompt — same split, same rule. Its body carries the four-job
 *  decision and the rules that hold on every write; the per-job detail lives in
 *  `app_building/{authoring,automation}/*` behind a `loadKnowledge`. */
const automatorCorpus = () => agentPromptCorpus(join(SYSTEM_SPACES, 'system-appbuilder'), 'automator');

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
   *
   * Growing an app used to be a freeform same-turn sequence with the SAME risk (a table written,
   * then the turn runs out before the page reading it lands) — `iterate_live_project` replaces that
   * with a tasklist whose own `dependsOn` chain (table -> endpoint -> view) makes the ordering
   * STRUCTURAL rather than a prose reminder the model has to remember mid-turn; see
   * `iterate-live-project-contract.test.ts`'s tasklist-shape assertions for that chain.
   */
  it('routes a first whole-app build to the tasklist, and growth to iterate_live_project, never freeform', () => {
    const instruct = readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'), 'utf8');

    // The reliability guarantee: a first whole-app build NEVER goes freeform — it runs the pipeline.
    expect(
      instruct,
      'a first whole-app build must route to build_live_project, never freeform in one turn (freeform is the single-page/empty-app failure)',
    ).toMatch(/ALWAYS runs the `build_live_project` tasklist — never freeform/i);

    // Growth is never freeform either — it is `iterate_live_project`'s job now.
    expect(instruct).toMatch(/GROWING an app is never done via the freeform writers below/i);
    expect(instruct).toMatch(/tasklist\('iterate_live_project', \{ query, attachmentIds \}\)/);
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
    // Reachable-doctrine claim, not an always-on one: this fires while SEEDING, which is exactly
    // when `('app_building','authoring','seeding-data')` is loaded — so it is asserted on the corpus.
    const instruct = automatorCorpus();

    // Provenance is a COLUMN decision, so the rule lives with the node that designs the schema
    // rather than in the automator's always-on body — the automator no longer designs tables itself.
    expect(
      readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'tasklists', 'build_live_project', '04-plan_tables.md'), 'utf8'),
      'the table plan must keep WHO/WHERE material came from on the record, not just its operational content',
    ).toMatch(/attribution|credited_to|provenance/i);

    // The near-miss guard: a `source` field filled with "from an attachment" LOOKS done and is not.
    // Lives with the schema decision, for the same reason the rule above does.
    expect(
      readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'tasklists', 'build_live_project', '04-plan_tables.md'), 'utf8'),
      'the table plan must warn that recording the CHANNEL the material arrived on is not the attribution',
    ).toMatch(/transport is not the attribution|channel the material\s+arrived on/i);
  });
});

describe('system-architect/architect — custom choice components', () => {
  it('tells the space builder to handle a dismissed tailored form as no change', () => {
    const instruct = readFileSync(join(SYSTEM_SPACES, 'system-architect', 'agents', 'architect', 'instruct.md'), 'utf8');
    expect(instruct).toMatch(/components\/view\/<Name>\.tsx/);
    expect(instruct).toMatch(/components\/form\/<Name>\.tsx/);
    expect(instruct).toMatch(/dismissed.*null|null.*no decision/i);
    expect(instruct).toMatch(/make no write/i);
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

  it('identifies attachment delegate results as plain text rather than object-shaped data', () => {
    const src = instruct();
    expect(
      src,
      'the dispatcher and vision delegates resolve plain-text summaries, so THING must compose with them rather than inspect object fields that do not exist',
    ).toMatch(/delegates resolve to plain text/i);
    expect(src).toMatch(/Do NOT inspect them as objects/i);
  });

  /**
   * Live finding (09-home-renovation, 2/2 runs): "oh — don't let us forget, Astrid's only ever on
   * site Tuesday to Thursday, and we're away the first week of September." never triggered the
   * required clarifying ask, even though the file already had a "don't forget X" ambiguity rule and
   * `ask()` worked elsewhere in the SAME runs (a consent card a few steps later). Two things about
   * that sentence sat outside the rule's literal phrasing: the rememberer ("us"), not the forgotten
   * thing, is the grammatical subject ("don't let X slip" reads X as subject; "don't let us forget"
   * doesn't), and it carries TWO facts in the same breath rather than one bare item — so the model
   * read the trailing facts as having answered the mechanism question. The rule must generalize past
   * one fixed sentence shape and say explicitly that riding facts don't resolve the ambiguity.
   */
  it('the "keep this front of mind" ambiguity covers the rememberer-as-subject phrasing and multi-fact statements', () => {
    // The full phrasing list lives in the `playbooks/writing/world-and-preferences` aspect;
    // the instruct keeps the routing line that reaches it. Assert on the corpus.
    const src = thingCorpus();
    expect(
      src,
      'the ambiguity rule must not be scoped to one grammatical subject ("X slip") — "don\'t let ME/US forget" is the same ambiguity with a different subject',
    ).toMatch(/don't let me\/us forget/i);
    expect(
      src,
      'the rule must say a sentence carrying several concrete facts alongside the "don\'t forget" phrase is still ambiguous — the facts are not an answer to the mechanism question',
    ).toMatch(/one fact or several|riding along|does not (answer|resolve|settle)/i);
  });
});

describe('user-thing/thing — capability honesty for real-world actions', () => {
  const instruct = () => readFileSync(join(SYSTEM_SPACES, 'user-thing', 'agents', 'thing', 'instruct.md'), 'utf8');

  /**
   * Live finding (09-home-renovation, "pay Stefanos €4,450"): NONDETERMINISTIC across identical
   * runs — one run fabricated "paid in full, Stefanos is square" with zero send/pay yield ever made
   * (a bare capability-honesty violation: THING holds no payment capability at all, per its own
   * frontmatter, so no call could possibly have done this); a second, independent run correctly
   * refused in Greek and offered to record the debt instead. The file had NO explicit rule against
   * narrating an unattempted real-world action as completed — refusal worked only when the model
   * happened to reason its way there unprompted. This pins the discipline down as an explicit rule
   * so it stops being a coin flip.
   */
  it('tells THING never to narrate a real-world action as done unless a call actually performed it', () => {
    const src = instruct();
    expect(
      src,
      'THING must be told that a real-world action (payment, sending a message, booking/cancelling) is only done if an actual call performed it',
    ).toMatch(/real-world action as done|only if you invoked|actually made did it/i);
    expect(
      src,
      'a missing capability must be handled with an honest refusal plus an alternative it CAN do, never a fabricated "done"',
    ).toMatch(/fabrication|never a confident|honest reply is a refusal/i);
  });
});

describe('user-thing/thing — act on a determined change, ask only when the choice is genuinely theirs', () => {
  const instruct = () => readFileSync(join(SYSTEM_SPACES, 'user-thing', 'agents', 'thing', 'instruct.md'), 'utf8');
  // Whitespace-flattened source: line-wrap must never break these anchors (a rewrap has broken
  // hardcoded regexes in this file before). Match single-space phrases against the flattened body.
  const flat = () => instruct().replace(/\s+/g, ' ');
  // Same, over the whole corpus — for doctrine that now lives in a `playbooks/*` aspect THING
  // loads when it takes that route. `flat()` stays for rules that must hold on EVERY turn.
  const flatCorpus = () => thingCorpus().replace(/\s+/g, ' ');

  /**
   * Live 06-tanzania run 19: THREE ask-vs-act failures in ONE run, pulling opposite ways.
   * Step 9 — "should be ~3344, fix the maths": THING diagnosed the double-counted rows PERFECTLY,
   *   then ENDED THE TURN ASKING "want me to fix it?" — zero db mutations, the total left wrong.
   * Step 14 — a genuinely ambiguous "don't forget the ranger tip" (save-a-note vs set-a-reminder):
   *   THING did NOT ask (asking is REQUIRED here) — it unilaterally stored AND researched it.
   * The prior fix (0beae4b) encoded 9 and 14 as two DISCONNECTED bullets with no shared frame, so
   *   the model inverted the instinct: conservative on the destructive fix, impulsive on the choice.
   * The fix is ONE unified principle that names BOTH poles and the operational test, so the model
   *   sees them as two sides of a single decision — NOT a broad "just act more" (which regresses 14).
   */
  it('states the unified act-vs-ask distinction with both poles and an operational test', () => {
    const src = flat();
    // The determined-target (ACT) pole and the genuine-choice (ASK) pole must BOTH be present.
    expect(src).toMatch(/Act on a determined change; ask only when the CHOICE itself is genuinely theirs/i);
    expect(src).toMatch(/the outcome ITSELF has two genuinely different meanings, and only their preference picks between/i);
    // The operational test that separates them — investigate-vs-preference.
    expect(src).toMatch(/settle this by investigating the data/i);
    expect(src).toMatch(/a choice only their preference decides/i);
    // Act-side: a requested change with a determinable target is never an ask.
    expect(src).toMatch(/change they requested with a determinable target is never the second/i);
    // The destructive-fix reframing that step 9 needed: a deletion is the MECHANISM, not a decision.
    expect(src).toMatch(/deletion is the MECHANISM of the change they asked for/i);
  });

  /**
   * Step 11 — user states a NEW cash payment. THING mis-routed it as an actual-paid annotation on
   * an EXISTING row (which does not change the total) instead of a NEW cost-row db.insert. A newly
   * reported payment is a NEW record; only an explicit correction of a value a row already holds is
   * an update. The new record must move any total that sums those records.
   */
  it('routes a newly-reported payment to a NEW row (db.insert), not an annotation on an existing one', () => {
    const src = flatCorpus();
    expect(src).toMatch(/a payment that had no prior row is a new row/i);
    expect(src).toMatch(/must MOVE any total that sums those records/i);
    // The one case that IS an update: correcting a value the row already holds (keeps step 16 green).
    expect(src).toMatch(/"it was actually X, not Y"/);
  });

  /**
   * Step 11 also GUESSED column names → eval_error "no such column". The read-path field discipline
   * existed; the WRITE path (db.insert / db.update set keys) did not say to introspect first, and a
   * bad write column THROWS rather than silently missing. Introspect the real row, retry — never
   * re-guess, never abandon on the throw.
   */
  it('extends the field-name discipline to writes: introspect real columns before db.insert/db.update', () => {
    const src = flatCorpus();
    expect(src).toMatch(/keys you pass to `db\.insert`/);
    expect(src).toMatch(/THROWS `no such column`/i);
    expect(src).toMatch(/never re-guess a second name/i);
  });

  /**
   * Step 11 finally ENDED THE TURN SILENTLY (empty reply) after 3 write failures. The existing
   * never-silent OFFER discipline had a gap on the "write failed N times -> give up" case: an empty
   * reply after failed writes makes the user believe the change landed. Recover, or report — never
   * nothing.
   */
  it('forbids ending a turn silently after repeated write failures', () => {
    const src = flatCorpus();
    expect(src).toMatch(/keeps failing is never a reason to fall silent/i);
    expect(src).toMatch(/empty reply after failed writes/i);
    expect(src).toMatch(/Recover the write, or report that it failed/i);
  });

  /**
   * Step 9 stayed RED after two L1 prose attempts (06-tanzania run 21: THING diagnosed the
   * double-count and computed the exact correct total, then ended the turn asking "want me to fix
   * it?" — zero db writes). L1 is exhausted, so the flagged-figure judgment is now a DETERMINISTIC
   * tasklist (`resolve_flagged_figure`: diagnose has no db:write → a confidence-gated fix is the sole
   * writer → an unconditional merge-report goal). This asserts instruct.md ROUTES to it rather than
   * carrying inline "fix it yourself" prose — reverting the route back to prose turns this RED.
   */
  it('routes a flagged/mis-adding figure to the deterministic resolve_flagged_figure tasklist', () => {
    const src = flatCorpus();
    expect(src).toMatch(/tasklist\('resolve_flagged_figure', ?\{ ?complaint ?\}\)/);
    // 06-routing (07-life-admin run 19 step 8): "go through the rows and check the maths" over a
    // too-high total READ like a question, so THING answered it inline (path 1) — re-printed a
    // corrected table and never wrote, leaving the DB wrong. The route now names the verify/"go
    // through the rows" framing AND says explicitly this is NOT a path-1 read-and-answer, so triage
    // routes it to the fixing tasklist. Dropping either cue turns this RED.
    expect(src).toMatch(/go through the rows and check the maths/i);
    expect(src).toMatch(/NOT a path-1 read-and-answer/i);
  });

  /**
   * Step 11 stayed RED after L1 prose (06-tanzania run 19: a newly-reported cash payment mis-routed to
   * an actual-paid annotation on an existing row, guessed columns, then ended the turn SILENT). L1 is
   * exhausted, so the insert-vs-update judgment now runs in the deterministic `write_fact` DAG (classify
   * sets `operation`; the write node refuses an `update` without a matched row and re-reads to prove it
   * landed). instruct.md must ROUTE a newly-reported payment THROUGH the tasklist rather than keep an
   * inline "db.insert it yourself" as the primary path — reverting the route to inline turns this RED.
   * (The narrow correction-of-an-existing-row case stays inline, keeping step 16 green.)
   */
  it('routes a newly-reported payment through the hardened write_fact tasklist', () => {
    expect(flatCorpus()).toMatch(/tasklist\('write_fact', ?\{ ?fact, ?kind: ?'personal' ?\}\)/);
  });

  /**
   * Step 14 stayed RED after L1 prose (06-tanzania run 19: a genuinely store-vs-remind-ambiguous
   * volunteered "don't forget" item was stored AND re-researched unilaterally, never asked, when asking
   * is REQUIRED). L1 is exhausted, so the ambiguity detection moves into `write_fact`'s classify (via
   * the domain-neutral recording/intent heuristic), which returns an `ask` THING relays. instruct.md
   * must ROUTE the volunteered "keep this front of mind" item through the tasklist rather than deciding
   * store-vs-remind inline — reverting the route to an inline decision turns this RED.
   */
  it('routes a store-vs-remind-ambiguous volunteered item through write_fact', () => {
    expect(flatCorpus()).toMatch(/tasklist\('write_fact', ?\{ ?fact, ?kind: ?'preference' ?\}\)/);
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

  /**
   * Live finding (06-tanzania step 1): the `reader` specialist, mid-reasoning, freelanced an
   * unrequested `display(<Callout title="Answer received">…)` — nothing in its instruct.md told it
   * to display, and nothing told it not to. A nested delegate's `display()` does not reach the
   * agent that delegated to it (it answers via `currentTask.resolve`), but its output DOES broadcast
   * into the real user's chat as a trace event — so the leaked internal PDF-fee dump became the
   * turn's visible reply, drowning THING's own (separately-missing) offer. `display` is a universal,
   * non-capability-gated global (`libs/core/src/exec/bootstrap.ts:198`), so it cannot be withheld via
   * frontmatter — the contract has to be stated in prose (the same rung the synthesized-specialist
   * template uses: resolve on every branch, never display). These three agents each answer a CALLER.
   */
  it('every system-files answer agent is told to resolve its answer and never display() (a delegate display() leaks into the user chat)', () => {
    for (const agent of ['reader', 'sheet', 'dispatch']) {
      const instruct = readFileSync(
        join(SYSTEM_SPACES, 'system-files', 'agents', agent, 'instruct.md'),
        'utf8',
      );
      expect(
        instruct,
        `${agent} answers a caller, so it must return its answer via currentTask.resolve`,
      ).toMatch(/currentTask\.resolve\(/);
      expect(
        instruct,
        `${agent} must be told never to display() — a delegate's display leaks into the user chat`,
      ).toMatch(/never[^.]*`?display/i);
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

describe('system-appbuilder live-project build action', () => {
  it('runs the supplied-material build as a single captured tasklist action', () => {
    const automator = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'),
      'utf8',
    );

    expect(automator).toMatch(/currentTask\.resolve\(await tasklist\('build_live_project', \{ query, attachmentIds \}\)\)/);
    expect(automator).toMatch(/do NOT continue with a\s+second model turn/i);
    // The route is invocation-independent: a MODEL-DRIVEN whole-app delegate must reach the tasklist too.
    expect(automator).toMatch(/Whether the runtime started you on the `build_live_project` action OR a caller delegated/i);
  });

  /**
   * Regression: a live run asked THING to fix two small issues on an app it had already built (a bad
   * view field reference, no seed data). The automator was re-delegated onto the SAME `build_live_project`
   * action and, despite the query plainly describing a fix rather than a build, re-ran the entire
   * pipeline (read_sources → every planner → every implement step) instead of using the freeform
   * writers already documented below for exactly this case. "First build" must be a mechanical,
   * project-state check — not an inference from the action id or the query's wording.
   */
  it('requires a mechanical db.tables() check before running the pipeline, and routes seeding to db.insert', () => {
    const automator = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'),
      'utf8',
    );

    expect(
      automator,
      'first-build must be decided from project state, not the action id or query wording',
    ).toMatch(/Check `db\.tables\(\)` FIRST, not the action id or the query's\s+wording/i);
    expect(
      automator,
      'seeding a placeholder row into an EXISTING table must route to a direct db.insert, never a full rebuild',
    ).toMatch(/await db\.insert\(table,\s+row\)/);
  });

  it('builds the live app as a plan → per-item build DAG (multiple pages + reusable components)', () => {
    const dir = join(SYSTEM_SPACES, 'system-appbuilder', 'tasklists', 'build_live_project');
    const read = (f: string) => readFileSync(join(dir, f), 'utf8');

    // The pipeline opens on user stories, then a BINDING holistic plan threaded into every planner.
    expect(read('02-user_stories.md')).toMatch(/acceptance/);
    expect(read('03-plan_app.md')).toMatch(/user_stories/);
    expect(read('03-plan_app.md')).toMatch(/BINDING/);

    // Each implement node is model-driven and uses the LIVE writers (not the catalog ones).
    // implement_tables forwards the plan's schema + rows through writeProjectTable.
    expect(read('10-implement_tables.md')).toMatch(/writeProjectTable\(/);
    expect(read('10-implement_tables.md')).toMatch(/forEach: plan_tables\.tables/);
    expect(read('12-implement_endpoints.md')).toMatch(/writeProjectQuery\(/);
    // Endpoint name is the single source of truth: plan_endpoints ASSIGNS a unique `name`,
    // implement_endpoints passes `ep.name` directly to the query writer, and pages reference that
    // exact name — the fix for cross-node name drift and duplicate names.
    expect(read('05-plan_endpoints.md')).toMatch(/UNIQUE lowercase-hyphen id/);
    expect(read('12-implement_endpoints.md')).toMatch(/writeProjectQuery\(ep\.name, query\)/);
    expect(read('12-implement_endpoints.md')).toMatch(/Every endpoint uses/);
    expect(read('07-plan_views.md')).toMatch(/plan_endpoints\.endpoints\[\]\.name/);

    // Reusable components are their own plan → implement pair.
    expect(read('14-implement_view_components.md')).toMatch(/writeProjectViewComponent\(/);
    expect(read('14-implement_view_components.md')).toMatch(/PascalCase/);

    // A page NAMES its endpoints — it does not fetch them. There is no `useApi` here (and no client
    // code at all), so the medium's own writer is what the node must model.
    const pages = read('15-implement_views.md');
    expect(pages).toMatch(/writeProjectView\(/);
    // The forbidden-import guard is MOOT in this medium — a spec has no imports to forbid. Its
    // successor is navigation as a DECLARED target rather than an interpolated string, which is what
    // keeps the "no expressions anywhere" guarantee real instead of decorative.
    expect(pages).toMatch(/navigate/);
    expect(pages).toMatch(/rowAction/);
    // Null-safety needs no guard clause in a spec: a binding that resolves to null renders the
    // renderer's own empty treatment rather than throwing, so the whole "COALESCE before use" rule
    // has no code to attach to. The equivalent guarantee is that a binding is a PATH and nothing
    // else — no expression can be written that could dereference a null in the first place.
    expect(pages).toMatch(/No `\?:`, no `\+`, no `\$\{…\}`/);

    // Endpoints are generated query IR, not a remaining TypeScript authoring node. The endpoint
    // instruction must preserve the query-only boundary and parent/child declarative forms.
    expect(read('12-implement_endpoints.md')).toMatch(/Never write a TypeScript handler/);
    expect(read('12-implement_endpoints.md')).toMatch(/writeProjectQuery/);
    expect(read('12-implement_endpoints.md')).toMatch(/ingredientCount/);

    // IDs are system-generated: plan_tables tells the model to OMIT the id, and reach for the `uuid()`
    // space function only to wire a relation. (The store also regenerates a blank generated PK.)
    expect(read('04-plan_tables.md')).toMatch(/Never author the `id`/);
    expect(read('04-plan_tables.md')).toMatch(/uuid\(\)/);
    expect(read('04-plan_tables.md')).toMatch(/^\s*-\s*uuid\s*$/m); // the node scopes the uuid function

    // The endpoint response SHAPE is a single source of truth: plan_endpoints declares each endpoint's
    // `fields`, implement_endpoints explicitly reconciles that binding contract with the query IR,
    // and pages read those planned keys verbatim.
    expect(read('05-plan_endpoints.md')).toMatch(/`fields`/);
    expect(read('05-plan_endpoints.md')).toMatch(/EXACT keys of ONE item/);
    expect(read('12-implement_endpoints.md')).toMatch(/item\.fields/);
    expect(read('12-implement_endpoints.md')).toMatch(/reconcile it with the query output/);
    expect(read('15-implement_views.md')).toMatch(/plan_endpoints/);
    expect(read('15-implement_views.md')).toMatch(/verbatim/i);

    // The assistant dock is RENDERER CHROME as of v2 — on every page of every app, whether or not
    // any spec mentions it. The shell step must therefore tell the model NOT to author one: a
    // prompt that still asks for `assistant: { agent: 'thing' }` is asking it to remember a thing
    // it can no longer forget, and the one measured failure of the old shape was forgetting it.
    expect(read('15b-implement_shell.md')).toMatch(/writeProjectViewShell\(/);
    expect(read('15b-implement_shell.md')).toMatch(/Do NOT author an assistant/);
    expect(read('15b-implement_shell.md')).not.toMatch(/assistant: \{ agent: 'thing' \}/);
    // finalize carries an inexpressible surface through to the caller — with no second builder to
    // hand it to, saying so IS the deliverable.
    expect(read('18-finalize.md')).toMatch(/cannotExpress/);

    // Pages are detailed ONE per node too: plan_pages fans out over the binding page list, so no
    // single node holds every page's detail (the "split the monolithic page node" fix).
    expect(read('07-plan_views.md')).toMatch(/forEach: plan_app\.pages/);
    expect(read('15-implement_views.md')).toMatch(/forEach: plan_views\b/);

    // A page write that returns `{ ok: false }` (a TSX parse slip RETURNS, it does not throw) is read
    // and RETRIED with a corrected source before resolving — the fix for the silent 1-of-N page drop
    // where the no-retry template resolved a failed write blind while finalize still declared victory.
    expect(pages).toMatch(/if \(!w\.ok\)/);
    expect(pages).toMatch(/writeProjectView\(pg\.route, spec2\)/);
    expect(pages).toMatch(/resolve\(\{ route: pg\.route, ok: w\.ok, error/);
    // Pinned STRUCTURALLY rather than as prose: the retry REASSIGNS `w` (it is not a fresh `w2`), so
    // the `resolve({ ok: w.ok })` above necessarily reports the retry's outcome and cannot resolve the
    // failed first attempt. That is the silent 1-of-N page drop, closed by the shape of the code.
    expect(pages).toMatch(/\n\s*w = writeProjectView\(pg\.route, spec2\)/);

    // finalize reports pages HONESTLY from disk and surfaces any planned page that went missing — it
    // does NOT declare a clean `ok` on a partial build (the reporting half of the silent-drop fix).
    expect(read('18-finalize.md')).toMatch(/listProjectDir\('views'\)/);
    expect(read('18-finalize.md')).toMatch(/const missing =/);
    expect(read('18-finalize.md')).toMatch(/missing\.length === 0/);

    // GATE-AND-RETRY (durable completeness): after every file is written the app is compiled against the
    // REAL toolchain via buildApp() (lint → typecheck → esbuild), and each offending FILE is routed to a
    // per-file fix fork — driven by the STRUCTURED error list (programmatic ground truth), not a
    // self-assessment. This is what turns "built but broken" into "type-correct or fail loud".
    // The gate is a HOST-RUN code node, so the scan cannot fail to be reproduced (see
    // build-live-project-gate.test.ts, which drives its real run()). `fix` loops back to it.
    const verify = read('16-verify.ts');
    expect(verify).toMatch(/ctx\.buildProjectApp\(\)/);
    expect(verify).toMatch(/offending/); // groups findings by file for the fix fan-out
    const fix = read('17-fix.md');
    expect(fix).toMatch(/forEach: verify\.offending/);
    expect(fix).toMatch(/goto: verify/); // resumes the gate instead of a hand-unrolled second pass
    expect(fix).toMatch(/readProjectFile\(/); // reads the failing file before fixing it
    expect(fix).toMatch(/item\.errors|f\.errors/); // fixes the SPECIFIC reported errors
    // Nothing is excluded or stubbed to make the build pass. Stated in the new pipeline as a
    // FAILURE obligation on `finalize` rather than a prohibition on the implementers: it fails
    // loudly carrying anything planned that never landed, so a quiet omission cannot read as done.
    expect(read('index.md')).toMatch(/FAILS LOUDLY carrying the[\s\S]{0,80}anything planned that is missing/i);

    // finalize is the sole authoritative build-invoker (subsumes the no-build-trigger defect): it runs
    // buildApp() itself and gates `ok` on a CLEAN, BUILT app — a residual compiler error fails loudly.
    // The mechanical scans the compiler cannot do now live in `verify` (a host-run code node), so
    // finalize CARRIES their residue rather than re-implementing them: a non-empty verify.offending
    // means the fix loop exhausted its attempts with faults still open, and gates `ok` the same as a
    // compiler error.
    // finalize runs NO build of its own — the last `verify` is the authoritative one, and a second
    // build here could only disagree with it (which is how a stale gate value once reported a clean
    // app as broken). It reads verify's verdict instead, and `ok` requires all THREE ground truths.
    const finalize = read('18-finalize.md');
    expect(finalize).not.toMatch(/await buildApp\(\)/);
    expect(finalize).toMatch(/verify\.ok/);
    expect(finalize).toMatch(/verify\.viewsValidated/);
    expect(finalize).toMatch(/verify\.renderSmoked/);
    expect(finalize).toMatch(/verify\.offending/); // carries the gate's residue
    expect(finalize).toMatch(/allErrors/); // ok gates on the gate's errors + gate misses
  });

  it('the mechanical scans live in the CODE NODE, and no prompt duplicates them (06-tanzania run 32)', () => {
    const dir = join(SYSTEM_SPACES, 'system-appbuilder', 'tasklists', 'build_live_project');
    const read = (f: string) => readFileSync(join(dir, f), 'utf8');

    // These scans used to be ~50 lines of TypeScript the MODEL re-emitted inside three separate
    // prompt nodes. In run 32 that was 44 of 124 errors across the build steps ('gateErrors' is
    // not defined cascades) — and a gate that fails to execute contributes no findings, which the
    // pipeline reads as "clean". They are now one host-run code node; its behaviour is tested for
    // real in build-live-project-gate.test.ts. Here we only pin WHERE they live.
    // The TSX-era source scans (page→endpoint via `useApi`, descriptor-return, param arity) are GONE
    // with the medium that needed them: a spec cannot contain a fetch call or a JSX return at all, so
    // there is nothing to scan for. `verify` now merges three executed ground truths instead.
    const verify = read('16-verify.ts');
    expect(verify, 'builds + typechecks the generated wrappers').toContain('buildProjectApp');
    expect(verify, 'app-wide view validation').toContain('validateAppViews');
    expect(verify, 'mounts every view against live endpoint responses').toContain('renderSmokeViews');
    expect(verify, 'endpoint→table scan').toContain('db\\s*\\.\\s*(?:query|insert|update|remove)');

    // The duplication is GONE: finalize consumes verify's result instead of re-scanning, and the
    // second compile/fix pair no longer exists at all.
    const finalize = read('18-finalize.md');
    expect(finalize, 'finalize must not re-implement the scans').not.toContain('is not a generated endpoint name');
    expect(finalize, 'finalize consumes the gate result').toMatch(/verify\.offending/);
    expect(existsSync(join(dir, '14-compile_pass2.md')), 'the unrolled second pass is removed').toBe(false);
    expect(existsSync(join(dir, '15-fix_pass2.md')), 'the unrolled second fix is removed').toBe(false);

    // The fix node carries repair guidance for each gate-error class.
    const fix = read('17-fix.md');
    expect(fix, 'repair guidance points at the endpoint plan').toMatch(/plan_endpoints/);
    // The repair target is a SPEC and a BINDING — there is no JSX to rewrite.
    expect(fix, 'repair guidance names the spec as the target shape').toMatch(/\bspec\b/i);
    expect(fix, 'repair guidance names bindings').toMatch(/binding/i);
  });
});

describe('system-appbuilder repair turns', () => {
  /**
   * Superseded incident guard: a repair request naming a missing page used to be answered with a
   * SAME-TURN freeform write (fragile — a full pipeline rebuild for the SAME underlying "just tell
   * me what's wrong and I'll re-run everything" failure mode was the actual live incident this
   * session). The fix routes ANY broken/missing artifact — not just a page — to the dedicated
   * `repair_live_project` tasklist, whose own `03-author_missing.md` step is the one that must
   * actually WRITE the thing, never just inventory/diagnose it.
   */
  it('requires a missing-page repair to write the page rather than inventory the project', () => {
    const automator = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'),
      'utf8',
    );
    // The one-liner is ALWAYS ON — once an app exists, broken/missing routes to repair_live_project,
    // never a same-turn freeform patch and never build_live_project again.
    expect(automator).toMatch(/NEVER run `build_live_project` again — repair or iterate instead/i);
    expect(automator).toMatch(/tasklist\('repair_live_project', \{ missing, errors \}\)/);

    const authorMissing = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'tasklists', 'repair_live_project', '03-author_missing.md'),
      'utf8',
    );
    // The actual write happens here, not a listing: an author turn must call the real writers.
    expect(authorMissing).toMatch(/writeProjectQuery\(item\.name, query\)/);
    expect(authorMissing).toMatch(/writeProjectView\(item\.name, spec\)/);
  });
});

describe('user-thing supplied-material organization', () => {
  it('consumes the organizer envelope inline without re-entering the build', () => {
    // The organizer call shape lives in the `playbooks/paths/application` aspect THING loads
    // when it takes path 4 — the always-on body carries the gate that decides to take it.
    const thing = thingCorpus();

    expect(thing).toMatch(/organize_material[\s\S]{0,700}?\.then\(\(organized\) => display/);
    expect(thing).toMatch(/Do NOT delegate to the automator or architect, call the organizer again,\s+or continue authoring/i);
    expect(thing).toMatch(/Its envelope is the proof of the workflow's outcome/i);
    expect(thing).toMatch(/do not inspect the project or try to\s+validate individual builder results afterwards/i);
    expect(thing).toMatch(/values do not persist into a later statement/i);
  });
});

describe('system-architect synthesis setup', () => {
  it('returns the synthesized tasklist envelope without a fragile manual continuation', () => {
    const architect = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'agents', 'architect', 'instruct.md'),
      'utf8',
    );
    const writeAgent = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', '04-write_agent.md'),
      'utf8',
    );

    expect(architect).toMatch(/exactly ONE statement/i);
    expect(architect).toMatch(/action runtime returns this tasklist's envelope to the caller/i);
    expect(architect).not.toMatch(/const built = t\.data/);
    expect(architect).not.toMatch(/const\s+built\s*=\s*t\.data/);
    expect(writeAgent).toMatch(/must NOT delegate to the newly-created agent during\nsetup/i);
  });

  /**
   * Live E5 failure (06-tanzania step 5): a synthesized specialist's systemPrompt told it to
   * `display(...)` its answer on BOTH the covered and not-covered branches, never
   * `currentTask.resolve(...)`. A delegate() only auto-captures the SPECIFICALLY-REQUESTED action's
   * own tasklist result (delegate.ts's `capturableTasklists`) — so when the covered:false branch
   * fell back to a SECOND tasklist (research_and_store) and displayed ITS answer, that second
   * tasklist's result was never captured; the caller (THING) received back the FIRST tasklist's
   * stale `{covered:false}` miss and, believing the specialist never had the fact, redundantly
   * re-researched the exact same question itself. The fix: the generated systemPrompt must
   * `currentTask.resolve(...)` on EVERY branch, carrying the REAL (post-research, on the
   * covered:false path) answer — never `display()`, which the caller never sees.
   */
  it('a synthesized specialist resolves its answer on every branch, never displays it', () => {
    const writeAgent = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', '04-write_agent.md'),
      'utf8',
    );

    // The generated systemPrompt string itself (not the architect's own file prose) must carry
    // currentTask.resolve on both the covered:true and covered:false paths, and must not tell the
    // agent to display() its answer at all (display never reaches the delegate's caller).
    const systemPromptMatch = writeAgent.match(/systemPrompt:\s*"([\s\S]*?)",\s*\n\s*knowledge:/);
    expect(systemPromptMatch, 'expected a systemPrompt: "..." field before knowledge:').toBeTruthy();
    const systemPrompt = systemPromptMatch![1];

    expect(systemPrompt).toMatch(/covered is true,\s*currentTask\.resolve\(/i);
    expect(systemPrompt).toMatch(/covered is FALSE.*currentTask\.resolve\(/is);
    expect(systemPrompt).not.toMatch(/display\(/);
  });

  /**
   * Same live failure, second half: even once resolve() fixed the same-turn drop, the space's OWN
   * generated "store" task (research_and_store) hardcoded the knowledge field from whichever field
   * happened to be built FIRST (`written[0]`) — regardless of what the CALLER actually asked it to
   * store under. Confirmed on disk: three separate Zanzibar insurance findings all landed under
   * `zanzibar/accommodations/*` (the space's first-built field, about Stone Town lodging), never
   * under insurance/logistics — a later "remind me" question then missed again and re-searched the
   * web a second time. The fix: trust the caller's `domain`/`field` (as the systemPrompt already
   * passes) when given; fall back to the scaffolded default ONLY when the caller passed neither.
   */
  it('a synthesized specialist stores a researched finding under the CALLER-named field, not a hardcoded one', () => {
    const writeTasks = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', '05-write_tasks.md'),
      'utf8',
    );

    expect(writeTasks).toMatch(/typeof domain === 'string' && domain/);
    expect(writeTasks).toMatch(/typeof field === 'string' && field/);
    // writeKnowledge must be called with the derived targets, never the raw scaffolded dom/fld directly.
    expect(writeTasks).toMatch(/writeKnowledge\(targetDomain,\s*targetField,/);
  });

  /**
   * 07's live finding: a specialist built from SUPPLIED material invented specific facts (a wrong
   * boiler fault-code meaning) because `context.research` seeded into synthesize_and_run is a lossy
   * one-sentence summary, never the real document text or a re-readable attachmentId — so the model,
   * unable to verify a specific, wrote a plausible-sounding invented one anyway. The generated
   * knowledge also cited a vague "Source: the research report" for content that was never actually
   * backed by any real report or document. Fix: accept an optional `attachmentIds` seed so build_field
   * can re-read the ACTUAL document text with `readDocument` and ground specifics in it (falling back
   * gracefully to the summary alone when none are given, so existing callers keep working); never
   * fabricate a "Source:" line when there is no real URL; and never hand-list the aspect slugs in the
   * field overview (that menu is now supplied automatically off disk, per 6b87b5b / 59ff4227 — a
   * hand-written one only drifts stale).
   */
  it('a synthesized specialist grounds its knowledge in the real document, not a lossy summary alone', () => {
    const synthIndex = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', 'index.md'),
      'utf8',
    );
    const buildField = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'tasklists', 'synthesize_and_run', '02-build_field.md'),
      'utf8',
    );

    // The tasklist accepts attachmentIds so a caller with real documents can pass them through.
    expect(synthIndex).toMatch(/attachmentIds:\s*array\?/);

    // build_field actually reads them when given, rather than only ever trusting the summary.
    expect(buildField).toMatch(/readDocument\(/);
    // No fabricated "Source:" line when there is no real URL to cite.
    expect(buildField).not.toMatch(/"the research report"/);
    expect(buildField).toMatch(/never invent one/i);
    // Grounding discipline against inventing a specific the source material doesn't contain.
    expect(buildField).toMatch(/never a specific/i);
    // The overview must not hand-list the aspect slugs — that menu is supplied automatically.
    expect(buildField).toMatch(/never a hand-listed slug menu/i);

    // Never alias `item` to a separate `const f = item;` first: each statement is its own module, so a
    // lost/failed alias declaration turns every later `f.*` use into "Cannot find name 'f'" (observed
    // live cascading from the attachmentIds typecheck failure below). Reference item.* directly.
    expect(
      buildField,
      'build_field must reference item.* directly, never alias it to `const f = item;`',
    ).not.toMatch(/const\s+f\s*=\s*item\s*;/);
    expect(buildField).toMatch(/writeKnowledgeIndex\(design\.slug,\s*item\.domain/);
  });

  /**
   * The accept-and-use in build_field and the forward from organize_material are both no-ops if the
   * ARCHITECT'S OWN instruct drops attachmentIds when it invokes synthesize_and_run. An OMITTED
   * optional tasklist input is absent from the fork's typecheck scope entirely (not merely
   * `undefined`), so build_field's bare `attachmentIds` reference then fails to COMPILE on every
   * build — observed live as ~30 "Cannot find name 'attachmentIds'" in a single build step, which
   * also poisoned the statement bundle that declared `const f = item` and cascaded into "Cannot find
   * name 'f'". instruct.md must ALWAYS forward the key (default []), never omit it — passing [] keeps
   * it declared and real ids still flow through when the caller (organize_material) supplies them.
   */
  it('the architect instruct forwards attachmentIds into the synthesize_and_run call (never omits the key)', () => {
    const architect = readFileSync(
      join(SYSTEM_SPACES, 'system-architect', 'agents', 'architect', 'instruct.md'),
      'utf8',
    );

    expect(
      architect,
      'instruct.md must forward attachmentIds (default []) so the build steps see it declared — an omitted optional input is absent from the fork DTS and a bare reference fails typecheck',
    ).toMatch(/attachmentIds:\s*\(context\?\.attachmentIds\s*\?\?\s*\[\s*\]\)/);
  });

  /**
   * The accept-and-use side above is a no-op unless the CALLER also forwards attachmentIds —
   * organize_material's build_specialist is the one caller that builds a specialist straight from
   * supplied material (the exact path that produced the fabricated boiler knowledge), so it must
   * pass them through alongside `research`.
   */
  it('organize_material forwards attachmentIds to the specialist it builds, alongside research', () => {
    const buildSpecialist = readFileSync(
      join(SYSTEM_SPACES, 'user-thing', 'tasklists', 'organize_material', '04-build_specialist.md'),
      'utf8',
    );

    expect(buildSpecialist).toMatch(/context:\s*\{[^}]*research:\s*item\.research,\s*attachmentIds/);
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
