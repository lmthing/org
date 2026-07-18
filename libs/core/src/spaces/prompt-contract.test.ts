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
  it('routes a first whole-app build to the tasklist and keeps the openable-early gate for the freeform grow path', () => {
    const instruct = readFileSync(join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'), 'utf8');

    // The reliability guarantee: a first whole-app build NEVER goes freeform — it runs the pipeline.
    expect(
      instruct,
      'a first whole-app build must route to build_live_project, never freeform in one turn (freeform is the single-page/empty-app failure)',
    ).toMatch(/whole app authored freeform in one model turn is the single-page/i);

    // The page-required gate still applies to the freeform GROW path.
    expect(instruct).toMatch(/not done until the new section serves a PAGE/i);

    // The ordering rule (the one that survives running out of turn) — the regression guard.
    expect(instruct).toMatch(/openable first|make it openable early/i);
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

describe('system-appbuilder live-project build action', () => {
  it('runs the supplied-material build as a single captured tasklist action', () => {
    const automator = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'),
      'utf8',
    );

    expect(automator).toMatch(/currentTask\.resolve\(await tasklist\('build_live_project', \{ query, attachmentIds \}\)\)/);
    expect(automator).toMatch(/do not continue with a second model turn or manually replace its result/i);
    // The route is invocation-independent: a MODEL-DRIVEN whole-app delegate must reach the tasklist too.
    expect(automator).toMatch(/no matter how you were invoked|delegated to you MODEL-DRIVEN/i);
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
    expect(read('05-implement_tables.md')).toMatch(/writeProjectTable\(/);
    expect(read('05-implement_tables.md')).toMatch(/forEach: plan_tables\.tables/);
    expect(read('07-implement_endpoints.md')).toMatch(/writeProjectApi\(/);
    // Endpoint name is the single source of truth: plan_endpoints ASSIGNS a unique `name`,
    // implement_endpoints uses `item.name` VERBATIM (never re-derives from the route), and pages
    // reference that exact name — the fix for the cross-node name-drift + duplicate-name failures.
    expect(read('06-plan_endpoints.md')).toMatch(/UNIQUE lowercase-hyphen id/);
    expect(read('07-implement_endpoints.md')).toMatch(/const name = ep\.name;/);
    expect(read('07-implement_endpoints.md')).toMatch(/VERBATIM/);
    expect(read('10-plan_pages.md')).toMatch(/plan_endpoints\.endpoints\[\]\.name/);

    // Reusable components are their own plan → implement pair.
    expect(read('09-implement_components.md')).toMatch(/writeProjectComponent\(/);
    expect(read('09-implement_components.md')).toMatch(/PascalCase/);

    // Pages read endpoints via useApi AND import the reusable components.
    const pages = read('11-implement_pages.md');
    expect(pages).toMatch(/writeProjectPage\(/);
    expect(pages).toMatch(/useApi/);
    expect(pages).toMatch(/components\//);
    // The forbidden-import guard survives the redesign.
    expect(pages).toMatch(/react-router/);
    expect(pages).toMatch(/@radix-ui/);
    // Null-safety: nullable DB columns must be COALESCED before use (the park-fees crash fix) —
    // stated as a general principle, not a list of specific methods.
    expect(pages).toMatch(/GUARD NULLS/);
    expect(pages).toMatch(/COALESCE/);

    // Every model-authored implement node carries ✅do/❌never code examples grounded in real
    // generated-code failures — the NO-DOM `console` trap being the recurring one.
    for (const f of ['07-implement_endpoints.md', '09-implement_components.md', '11-implement_pages.md']) {
      expect(read(f)).toMatch(/console/);
      expect(read(f)).toMatch(/NO-DOM ambient/);
      expect(read(f)).toMatch(/❌/);
    }

    // IDs are system-generated: plan_tables tells the model to OMIT the id, and reach for the `uuid()`
    // space function only to wire a relation. (The store also regenerates a blank generated PK.)
    expect(read('04-plan_tables.md')).toMatch(/Never author the `id`/);
    expect(read('04-plan_tables.md')).toMatch(/uuid\(\)/);
    expect(read('04-plan_tables.md')).toMatch(/^\s*-\s*uuid\s*$/m); // the node scopes the uuid function

    // The endpoint response SHAPE is a single source of truth: plan_endpoints declares each endpoint's
    // `fields`, implement_endpoints emits exactly those keys, implement_pages reads exactly those keys
    // (verbatim, never re-cased) — the fix for the endpoint↔page field-name mismatch that crashed pages.
    expect(read('06-plan_endpoints.md')).toMatch(/`fields`/);
    expect(read('06-plan_endpoints.md')).toMatch(/EXACT keys of ONE item/);
    expect(read('07-implement_endpoints.md')).toMatch(/item\.fields/);
    expect(read('11-implement_pages.md')).toMatch(/plan_endpoints\.endpoints/);
    expect(read('11-implement_pages.md')).toMatch(/verbatim/i);

    // finalize writes the persistent chat dock layout.
    expect(read('12-finalize.md')).toMatch(/writeProjectPage\('_layout'/);
    expect(read('12-finalize.md')).toMatch(/<Chat\s+agent="thing"/);
  });
});

describe('system-appbuilder repair turns', () => {
  it('requires a missing-page repair to write the page rather than inventory the project', () => {
    const automator = readFileSync(
      join(SYSTEM_SPACES, 'system-appbuilder', 'agents', 'automator', 'instruct.md'),
      'utf8',
    );

    expect(automator).toMatch(/A repair request naming a missing page is a WRITE, not a diagnosis/i);
    expect(automator).toMatch(/write the `index` page and its needed read API immediately/i);
  });
});

describe('user-thing supplied-material organization', () => {
  it('consumes the organizer envelope inline without re-entering the build', () => {
    const thing = readFileSync(
      join(SYSTEM_SPACES, 'user-thing', 'agents', 'thing', 'instruct.md'),
      'utf8',
    );

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
