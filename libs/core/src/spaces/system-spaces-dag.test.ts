import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';
import type { Space, TasklistDir } from './load.js';
import type { TaskNode } from './tasklist-load.js';
import { validateDag, resolveGoalTask } from '../tasklist/dag.js';
import { splitPreludeStatements } from '../exec/prelude.js';
import { runTsc } from '../typecheck/tsc.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { forkCapabilities } from '../exec/capability.js';
import { evaluateDelegatePolicy } from '../exec/target-match.js';

/**
 * Structural guard for the shipped system spaces after the role/forEach/charter rewrite:
 * every system-space tasklist must load, validate as a DAG (incl. forEach refs), declare
 * exactly one resolvable goal, and every agent must ship a charter.md. Catches authoring
 * regressions (bad forEach ref, missing goal, dropped charter) without hitting a model.
 *
 * P6 additions: the `prelude:` sources of the migrated system-research / user-thing tasks
 * must parse into the expected statements AND typecheck against a fork-shaped ambient DTS
 * (the same one `runFork` builds) — the cheap static guarantee the preludes aren't typo'd.
 */

const SYS = resolve(__dirname, '..', '..', 'system-spaces');

/** The system-global space's function sources (webSearch/webFetch live there). */
async function globalFunctions(): Promise<Record<string, string>> {
  const g = await loadSpace(resolve(SYS, 'system-global'), { requireAgents: false });
  return g.functions;
}

/**
 * Rebuild the prelude's typecheck ambient exactly the way `fork.ts runFork` does:
 * fork capabilities from the task's role + canDelegateTo, the task's allowlisted
 * function overlay, NO currentTask (a prelude cannot resolve), and ambient `any`
 * declarations for the tasklist's declared input keys, the task's upstream
 * outputs (dependsOn ids), and forEach's `item`/`index`.
 */
function preludeAmbientFor(task: TaskNode, tl: TasklistDir, allFns: Record<string, string>): string {
  const policy = evaluateDelegatePolicy(task.canDelegateTo, 'task');
  const capabilities = forkCapabilities(task.role, policy.mode !== 'none');
  const picked: Record<string, string> = {};
  for (const name of task.functions ?? []) if (name in allFns) picked[name] = allFns[name]!;
  const overlay = Object.keys(picked).length > 0 ? buildOverlay(picked, { view: {}, form: {} }) : '';
  const seedDts = Object.keys(tl.input ?? {}).map((k) => `declare const ${k}: any;`).join('\n');
  const upstreamDts = (task.dependsOn ?? []).map((id) => `declare const ${id}: any;`).join('\n');
  const forEachDts = task.forEach ? 'declare const item: any;\ndeclare const index: number;' : '';
  return buildAmbientDts({
    capabilities,
    overlay,
    currentTask: false,
    extraDecls: [seedDts, upstreamDts, forEachDts].filter(Boolean),
  });
}

/** Typecheck each prelude statement in order, accumulating context like runPrelude does. */
function typecheckPrelude(task: TaskNode, tl: TasklistDir, allFns: Record<string, string>): void {
  const ambientDts = preludeAmbientFor(task, tl, allFns);
  const statements = splitPreludeStatements(task.prelude!);
  expect(statements.length, `${task.id} prelude statements`).toBeGreaterThan(0);
  let context = '';
  for (const stmt of statements) {
    const r = runTsc({ ambientDts, sessionContext: context, statement: stmt });
    const errs = r.ok ? '' : r.diagnostics.map((d) => d.message).join('; ');
    expect(r.ok, `${task.id} prelude statement typecheck failed:\n${stmt}\n→ ${errs}`).toBe(true);
    context += (context ? '\n' : '') + stmt;
  }
}

describe('shipped system spaces load + validate', () => {
  for (const name of ['system-architect', 'system-research', 'system-appbuilder', 'user-thing', 'user-memory']) {
    it(`${name}: agents have charters and all tasklists are valid DAGs`, async () => {
      const space = await loadSpace(resolve(SYS, name), { requireAgents: false });
      // Every agent ships a non-trivial charter (fork-safe identity).
      for (const slug of Object.keys(space.agents)) {
        expect(space.agents[slug]!.charterBody.length, `${name}/${slug} charter`).toBeGreaterThan(20);
      }
      // Every tasklist validates and resolves a goal.
      for (const tlName of Object.keys(space.tasklists)) {
        const tasks = await loadTasklistFromSpace(space, tlName);
        expect(() => validateDag(tasks), `${name}/${tlName} DAG`).not.toThrow();
        expect(resolveGoalTask(tasks), `${name}/${tlName} goal`).toBeTruthy();
      }
    });
  }

  it('THING lifecycle tasklists narrow db:write to only the mutating node', async () => {
    const space = await loadSpace(resolve(SYS, 'user-thing'), { requireAgents: false });

    const write = await loadTasklistFromSpace(space, 'write_fact');
    expect(write['classify']!.role).toBe('explore'); // read-only classify
    expect(write['classify']!.capabilities).toBeUndefined();
    expect(write['write']!.role).toBe('general');
    expect(write['write']!.capabilities).toContain('db:write');
    expect(resolveGoalTask(write)!.id).toBe('write');

    const retract = await loadTasklistFromSpace(space, 'retract_fact');
    expect(retract['locate']!.role).toBe('explore');
    // The destructive apply is a HOST-RUN code node (a hard delete is host-only — `db.remove` is not on
    // any model surface), so a retraction's delete can never happen inline in THING's own turn.
    expect(retract['apply']!.kind).toBe('code');
    expect(retract['apply']!.codeModulePath).toMatch(/retract_fact\/02-apply\.ts$/);
    expect(retract['apply']!.goal).toBe(true);
    expect(resolveGoalTask(retract)!.id).toBe('apply');

    const answer = await loadTasklistFromSpace(space, 'answer_across_spaces');
    expect(answer['ask']!.forEach).toBe('split.subquestions');
    expect(answer['reason']!.capabilities).toContain('db:read');
    // the fan-out node delegates to registered spaces, not db-writes
    expect(answer['ask']!.capabilities).toBeUndefined();

    const reconcile = await loadTasklistFromSpace(space, 'reconcile_conflict');
    expect(resolveGoalTask(reconcile)!.id).toBe('resolve');
    expect(reconcile['resolve']!.role).toBe('explore'); // pure reasoning, no writes

    const organize = await loadTasklistFromSpace(space, 'organize_material');
    expect(space.tasklists['organize_material']!.input).toEqual({
      request: 'string', sourceSummary: 'string', attachmentIds: 'array', specialistFacts: 'string',
    });
    // enumerate is a NAMING pass, one entry per guide-defined instance (a pet, a standing home
    // domain, …) — it carries the loadKnowledge menu + per-domain-guide contract so a genuine part
    // never silently gets folded into a bigger one before it even reaches inventory.
    expect(organize['enumerate']!.prelude).toContain('Promise.all');
    expect(organize['enumerate']!.prelude).toContain('readDocument');
    // The split heuristic lives in loadable knowledge (user-thing/knowledge/organizing/split/*),
    // not inline: the node loads the menu then the per-domain guide and splits by SUBJECT-vs-DATA.
    expect(organize['enumerate']!.instruction).toMatch(/loadKnowledge\('organizing', ?'split'\)/);
    // per-domain guide: a 3-arg load with a placeholder for the specific guide name — assert the
    // contract, not the exact placeholder token (it reads '<exact-name-from-the-line>' since e2571b0).
    expect(organize['enumerate']!.instruction).toMatch(/loadKnowledge\('organizing', ?'split', ?'<[^']+>'\)/);
    expect(organize['enumerate']!.instruction).toMatch(/subjects? vs\.? .*records|record type|app DATA/i);
    // inventory fans out ONE FORK PER NAMED SUBJECT (enumerate.subjects) — each subject gets its own
    // independent scope-build so a distinct, low-fact part (a single pet, a single utility) can no
    // longer be silently absorbed into a bigger scope by one holistic free-form pass.
    expect(organize['inventory']!.dependsOn).toEqual(['enumerate']);
    expect(organize['inventory']!.forEach).toBe('enumerate.subjects');
    expect(organize['inventory']!.prelude).toContain('readDocument');
    // inventory → consolidate_scopes (dedup genuine near-duplicates) → build_specialist fans out over
    // the CONSOLIDATED set, so duplicate/overlapping specialists don't waste the build budget.
    expect(organize['consolidate_scopes']!.dependsOn).toEqual(['inventory']);
    expect(organize['consolidate_scopes']!.instruction).toMatch(/consolidat|merge|overlap|minimal/i);
    expect(organize['build_specialist']!.dependsOn).toEqual(['consolidate_scopes']);
    expect(organize['build_specialist']!.forEach).toBe('consolidate_scopes.scopes');
    expect(organize['build_specialist']!.canDelegateTo).toEqual(['system-architect/architect#synthesize_and_run']);
    expect(organize['build_specialist']!.instruction).toContain('exactly one self-contained statement');
    expect(organize['build_live_app']!.canDelegateTo).toEqual(['system-appbuilder/automator#build_live_project']);
    expect(organize['build_live_app']!.instruction).toContain("'build_live_project'");
    expect(organize['build_live_app']!.instruction).toContain('live-project automator');
    expect(organize['build_live_app']!.instruction).toContain('source-derived rows and an\nopenable page backed by the project\'s own API');
    expect(organize['build_live_app']!.instruction).toContain('exactly one self-contained statement');
    expect(resolveGoalTask(organize)!.id).toBe('build_live_app');
  });

  it('THING resolve_flagged_figure isolates db:write to the confidence-gated fix node', async () => {
    // Step-9 L2 (06-tanzania run 21): THING diagnosed a double-counted figure PERFECTLY, computed the
    // exact correct total, then ended the turn asking "want me to fix it?" — zero db mutations. Two L1
    // prose attempts failed identically, so the ask-vs-act judgment moves OUT of instruct.md prose into
    // this deterministic DAG. The guarantee is structural, and these assertions are its revert-proof.
    const space = await loadSpace(resolve(SYS, 'user-thing'), { requireAgents: false });
    const rff = await loadTasklistFromSpace(space, 'resolve_flagged_figure');

    expect(() => validateDag(rff), 'resolve_flagged_figure DAG').not.toThrow();
    // `decision` is the optional confirm-carry input: on the user's YES to a proposed destructive fix,
    // THING re-invokes with the settled action so diagnose is echoed, not re-litigated (the run-32 vector).
    expect(space.tasklists['resolve_flagged_figure']!.input).toEqual({ complaint: 'string', decision: 'object?' });
    expect(Object.keys(rff).sort()).toEqual(['diagnose', 'fix', 'report']);

    // diagnose is read-only reasoning: role explore (write withheld at injection) and NO db:write cap.
    // Re-granting it any write capability — letting it silently ask-and-guess-write — turns this RED.
    expect(rff['diagnose']!.role).toBe('explore');
    expect(rff['diagnose']!.capabilities).toBeUndefined();
    expect(rff['diagnose']!.dependsOn ?? []).toEqual([]);

    // Step-9 fix (06-tanzania run 24): diagnose named the cause and computed the exact total MATCHING
    // the user's stated target, then judged LOW (it saw several candidate mechanisms) → asked, no fix.
    // The high-confidence rule now HIGH-confidences two determined cases: (a) the user stated the target
    // and exactly one candidate correction reproduces it (the stated target SELECTS the mechanism), and
    // (b) an arithmetically/structurally determined correction (duplicate/mis-sum). Reverting the rule
    // back to "exactly one correction is conceivable" turns this RED.
    const diag = rff['diagnose']!.instruction;
    expect(diag).toMatch(/stated or confirmed the target value/i);
    expect(diag).toMatch(/target SELECTS the mechanism/i);
    expect(diag).toMatch(/arithmetically or structurally determined/i);
    // The cause list names the cross-table duplicate + wrong-unit/currency causes (6-routing/step-8).
    expect(diag).toMatch(/two\s+tables\s+that\s+both\s+feed\s+the\s+total/i);
    expect(diag).toMatch(/wrong\s+unit\/currency/i);

    // fix is now a HOST-RUN CODE node (kind:'code', 02-fix.ts), not a model fork. Step-9 run-32 proved a
    // model fix node stochastically SKIPS the recompute guard and destructively deletes a correct row
    // (data loss); a prose "verify before delete" guard came back RED 6/8. The guard now runs in host code
    // that cannot be skipped: recompute the figure, and only delete when it verifiably moves to the
    // asserted target with no ambiguous equal-value twin — else report "already correct" or return a
    // question. Reverting fix to a model node (role/capabilities instead of kind:'code') turns this RED.
    expect(rff['fix']!.kind).toBe('code');
    expect(rff['fix']!.codeModulePath).toMatch(/resolve_flagged_figure\/02-fix\.ts$/);
    expect(rff['fix']!.role).toBeUndefined();
    expect(rff['fix']!.capabilities).toBeUndefined();
    expect(rff['fix']!.condition).toMatch(/diagnose\.confidence\s*==\s*'high'/);
    expect(rff['fix']!.dependsOn).toEqual(['diagnose']);
    expect(rff['fix']!.goal).toBeFalsy();

    // report is the UNCONDITIONAL goal terminal — Clarification 2: a condition-gated goal that gets
    // SKIPPED throws "produced no result" (orchestrator.ts), so the goal must MERGE both branches, not
    // BE the conditional fix. Making fix the goal, or giving report a write cap, turns this RED.
    expect(resolveGoalTask(rff)!.id).toBe('report');
    expect(rff['report']!.role).toBe('explore');
    expect(rff['report']!.capabilities).toBeUndefined();
    expect(rff['report']!.condition).toBeUndefined();
    expect(rff['report']!.dependsOn).toEqual(['diagnose', 'fix']);
  });

  it('THING write_fact hardens the DB write: classify decides insert-vs-update, write refuses an update with no row and re-reads to prove it landed', async () => {
    // Step-11 L2 (06-tanzania run 19): user STATED a new cash payment; THING mis-routed it as an
    // actual-paid annotation on an EXISTING row, guessed columns, failed 3× and ended the turn SILENT.
    // The insert-vs-update judgment now lives IN the DAG: classify resolves an explicit `operation`
    // (+`rowId` for update), and the write node REFUSES an update without a matched row — so folding a
    // newly-reported payment into some other row is impossible by construction, and the tasklist returns
    // {ok,target,detail} THING must relay (non-silent). Column-guessing is separately already a
    // typecheck error via the in-tree db-schema gate (composeDbDts/DB_WRITE_MEMBERS_TYPED), which also
    // reaches this fork node (fork.ts threads dbSchema) — so no schema prelude is needed here.
    const space = await loadSpace(resolve(SYS, 'user-thing'), { requireAgents: false });
    const write = await loadTasklistFromSpace(space, 'write_fact');

    expect(() => validateDag(write), 'write_fact DAG').not.toThrow();
    expect(resolveGoalTask(write)!.id).toBe('write');

    // classify stays read-only (role explore, no write cap) and resolves the operation split — but it
    // no longer PINS the row: it emits `criteria` (the user-referenced identifying attributes) and the
    // dedicated locate node does the matching. Locate-inside-classify is how a correction landed on an
    // UNRELATED row while the reply claimed success (06-tanzania run 25 step 16 — the €→$ wrong-row
    // write): one overloaded judgment matched loosely and picked a near-miss. Splitting the location
    // into its own exactly-one-match step is the step-by-step decomposition that makes that impossible.
    expect(write['classify']!.role).toBe('explore');
    expect(write['classify']!.capabilities).toBeUndefined();
    expect(Object.keys(write['classify']!.output)).toEqual(
      expect.arrayContaining(['target', 'operation', 'criteria', 'question']),
    );
    // The ambiguity detection is LOADABLE knowledge, not inline prose (the recording/intent heuristic).
    expect(write['classify']!.instruction).toMatch(/loadKnowledge\('recording', ?'intent'\)/);

    // The locate node: read-only, matches on EVERY user-referenced attribute, and refuses to guess —
    // anything but exactly one match resolves ambiguous/none (→ the write step turns it into an ask,
    // never a write to the nearest-looking row). Reverting the refusal turns this RED.
    const loc = write['locate']!;
    expect(loc.role).toBe('explore');
    expect(loc.dependsOn).toContain('classify');
    expect(Object.keys(loc.output)).toEqual(expect.arrayContaining(['status', 'rowId', 'candidates']));
    expect(loc.instruction).toMatch(/EVERY attribute the user referenced/);
    expect(loc.instruction).toMatch(/not the first, not the\s+closest/);

    // The write node branches on the ALWAYS-PRESENT classify.operation (never `typeof` an optional
    // upstream — the fork-DTS footgun), writes an update ONLY to the row locate CONFIRMED (ambiguous
    // and none become an ask, never a guessed write), and RE-READS to prove the row landed.
    // Reverting any of it turns this RED.
    const w = write['write']!.instruction;
    expect(write['write']!.dependsOn).toEqual(expect.arrayContaining(['classify', 'locate']));
    expect(write['write']!.capabilities).toContain('db:write');
    // Step-11 fix (06-tanzania run 24): the write node RE-READS with db.query on BOTH branches to
    // prove the row landed — so it MUST also declare db:read. With db:write alone the node's db DTS
    // is {insert;update;remove} and `db.query` fails typecheck (`Property 'query' does not exist`),
    // the write is abandoned, and THING fabricates "recorded". Removing db:read turns this RED.
    expect(write['write']!.capabilities).toContain('db:read');
    expect(w).toMatch(/classify\.operation/);
    expect(w).toMatch(/locate\.status === "confirmed"/);
    expect(w).toMatch(/locate\.status === "ambiguous"/);
    expect(w).toMatch(/never write one `locate` did not\s+confirm|never choose a row yourself/);
    expect(w).toMatch(/id: locate\.rowId/);
    expect(w).toMatch(/db\.insert\(classify\.table/);
    expect(w).toMatch(/after > before/); // insert path re-reads to prove the count moved
    // The ask branch relays classify.question so THING (not the fork) asks the user — no fork calls ask().
    expect(w).toMatch(/classify\.target === "ask"/);
    expect(w).toMatch(/classify\.question/);

    // The domain-neutral heuristic files exist on disk (index menu + a general option), zero literals.
    const kdir = resolve(SYS, 'user-thing', 'knowledge', 'recording', 'intent');
    expect(readFileSync(resolve(kdir, 'index.md'), 'utf8')).toMatch(/remind/i);
    const heuristic = readFileSync(resolve(kdir, 'default.md'), 'utf8');
    expect(heuristic).toMatch(/unstated desired future behaviour/i); // a positive ambiguity signal
    expect(heuristic).toMatch(/just STORE|do not ask/i);              // the NEGATIVE signal
    // Step-14 fix (06-tanzania run 24): a "don't forget" item carrying a riding amount was stored
    // outright (classified db, never asked). The heuristic now makes precedence explicit — a
    // keep-in-mind phrasing DOMINATES a riding storable value; the classify node BINDS that (ask even
    // when a value is present). Weakening either back to "store when a value has a home" turns this RED.
    expect(heuristic).toMatch(/riding stated amount|riding value|does NOT (?:qualify|license|downgrade)/i);
    expect(heuristic).toMatch(/DOMINATES/);
    expect(write['classify']!.instruction).toMatch(/EVEN IF\s+the\s+item\s+also\s+carries\s+a\s+concrete\s+storable\s+value/);
  });

  /**
   * CLASS-GUARD (06-tanzania run 24 step-11): write_fact/02-write re-read with `db.query` but its
   * frontmatter declared only `db:write` — so its composed db DTS was {insert;update;remove} and every
   * `db.query` failed typecheck (`Property 'query' does not exist`), the write was abandoned, and THING
   * fabricated success. The bug class is: a node that NARROWS its caps via a `capabilities:` array and
   * calls `db.query`/`db.tables` in its body, but forgets `db:read`. (A node with NO `capabilities:`
   * block inherits its agent's full app caps — incl. db:read — so it is exempt; only DECLARED-array
   * nodes can drop the read grant.) This asserts EVERY such node across the shipped tasklists includes
   * `db:read`. Removing db:read from write_fact/02-write (or any future re-reading node) turns this RED.
   */
  it('every capabilities-narrowed tasklist node that reads the db (db.query/db.tables) declares db:read', async () => {
    const offenders: string[] = [];
    for (const spaceName of ['system-architect', 'system-research', 'system-appbuilder', 'user-thing', 'user-memory']) {
      const space = await loadSpace(resolve(SYS, spaceName), { requireAgents: false });
      for (const tlName of Object.keys(space.tasklists)) {
        const tl = await loadTasklistFromSpace(space, tlName);
        for (const [id, node] of Object.entries(tl)) {
          const readsDb = /\bdb\.(query|tables)\(/.test(node.instruction);
          const narrows = Array.isArray(node.capabilities); // a DECLARED array narrows; undefined inherits
          if (readsDb && narrows && !node.capabilities!.includes('db:read')) {
            offenders.push(`${spaceName}/${tlName}#${id} (caps: [${node.capabilities!.join(', ')}])`);
          }
        }
      }
    }
    expect(offenders, `nodes that call db.query/db.tables but narrow caps without db:read:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('user-memory migrate_to_app_db carries db:write on ONLY the migrate node', async () => {
    const space = await loadSpace(resolve(SYS, 'user-memory'), { requireAgents: false });
    // The agent declares db:write as the ceiling, exposed via the migrate action.
    expect(space.agents['memory']!.capabilities?.['db:write']).toBeDefined();
    expect(space.agents['memory']!.actions.some((a) => a.tasklist === 'migrate_to_app_db')).toBe(true);

    const tasks = await loadTasklistFromSpace(space, 'migrate_to_app_db');
    expect(tasks['collect']!.capabilities).toEqual([]); // reads memory only — no db
    expect(tasks['migrate']!.capabilities).toContain('db:write');
    expect(tasks['forget']!.capabilities).toEqual([]); // tidies memory only — no db
    expect(resolveGoalTask(tasks)!.id).toBe('forget');
  });

  it('architect synthesize_and_run uses forEach fan-out with valid roles', async () => {
    const space = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    const tasks = await loadTasklistFromSpace(space, 'synthesize_and_run');
    // build_field / build_function fan out over the design step's arrays.
    expect(tasks['build_field']!.forEach).toBe('design.fields');
    expect(tasks['build_function']!.forEach).toBe('design.functions');
    // Read-only steps are explore; file-writing steps are general.
    expect(tasks['design']!.role).toBe('explore');
    expect(tasks['build_field']!.role).toBe('general');
    expect(tasks['validate']!.role).toBe('explore');
    // Every role is one of the three profiles.
    for (const t of Object.values(tasks)) {
      if (t.role) expect(['explore', 'plan', 'general']).toContain(t.role);
    }
  });

  it('appbuilder build_live_project fans out per-category with valid roles and a finalize goal', async () => {
    const space = await loadSpace(resolve(SYS, 'system-appbuilder'), { requireAgents: false });
    // The store-catalog build_app/publish_app pipeline and the app-architect agent are gone —
    // build_live_project (the automator's default action) is the sole appbuilder tasklist now.
    expect(Object.keys(space.tasklists)).toEqual(['build_live_project']);
    expect(space.agents['app-architect']).toBeUndefined();

    // build_live_project is a plan → per-category implement (forEach) → finalize pipeline.
    const live = await loadTasklistFromSpace(space, 'build_live_project');
    expect(space.agents['automator']!.defaultAction).toBe('build_live_project');
    expect(space.tasklists['build_live_project']!.input).toEqual({ query: 'string', attachmentIds: 'array' });
    expect(live['read_sources']!.prelude).toContain('Promise.all');
    // Sources → user stories → a holistic BINDING plan. Each planner is threaded with the stories.
    expect(live['user_stories']!.dependsOn).toEqual(['read_sources']);
    expect(live['plan_app']!.dependsOn).toEqual(['read_sources', 'user_stories']);
    expect(live['plan_tables']!.dependsOn).toEqual(['plan_app', 'read_sources', 'user_stories']);
    // CONTRACT-FIRST: the whole design is settled before anything is written, so `plan_endpoints`
    // grounds on `plan_tables` (the contract) — NOT on `implement_tables`. Interleaving planning
    // with implementation is what let four independent design turns disagree with each other.
    expect(live['plan_endpoints']!.dependsOn).toEqual([
      'plan_app', 'plan_tables', 'user_stories',
    ]);
    expect(live['plan_components']!.dependsOn).toEqual(['plan_app', 'plan_endpoints', 'user_stories']);
    expect(live['plan_pages']!.dependsOn).toEqual([
      'plan_app', 'plan_endpoints', 'plan_components', 'user_stories',
    ]);
    // Each category is a plan node → an implement node that fans out over the plan's list.
    expect(live['implement_tables']!.forEach).toBe('plan_tables.tables');
    expect(live['implement_endpoints']!.forEach).toBe('plan_endpoints.endpoints');
    expect(live['implement_components']!.forEach).toBe('plan_components.components');
    // Pages are the exception: plan_app emits a LIGHTWEIGHT page list, plan_pages is ITSELF a
    // per-page forEach that details one page per node (so no node holds every page's detail), and
    // implement_pages fans out over that aggregated per-page array (the bare task id).
    expect(live['plan_pages']!.forEach).toBe('plan_app.pages');
    expect(live['implement_pages']!.forEach).toBe('plan_pages');
    // Pages know the endpoints they read AND the reusable components they import.
    expect(live['implement_pages']!.dependsOn).toEqual([
      'plan_pages', 'plan_endpoints', 'plan_components', 'implement_components', 'emit_types',
    ]);
    // Implementation hangs off the VALIDATED contract and the EMITTED types, so every generated
    // file is typechecked against declarations that already exist — plus `reconcile_tables`, which
    // is what re-grounds endpoints in the tables that actually reached disk.
    expect(live['implement_endpoints']!.dependsOn).toEqual([
      'plan_endpoints', 'plan_tables', 'emit_types', 'reconcile_tables',
    ]);
    expect(live['implement_tables']!.dependsOn).toEqual(['plan_tables', 'emit_types']);
    expect(live['implement_components']!.dependsOn).toEqual(['plan_components', 'emit_types']);

    // The four HOST-RUN code nodes. A code node cannot fail to reproduce its own logic, which is
    // the whole reason these are not prose (`gateErrors is not defined` cascades were 35% of the
    // errors across run 32's build steps).
    for (const id of ['validate_contract', 'emit_types', 'reconcile_tables', 'smoke_endpoints', 'verify']) {
      expect(live[id]!.kind, `${id} must be a code node`).toBe('code');
    }
    // The contract is cross-checked BEFORE any code exists, and a failure resumes the DESIGN
    // carrying the reasons — `carry` is the point: getUpstreamOutputs only passes `dependsOn`, and
    // the resumed node cannot depend on its own checker without making the graph cyclic.
    expect(live['validate_contract']!.dependsOn).toEqual([
      'plan_tables', 'plan_endpoints', 'plan_components', 'plan_pages',
    ]);
    expect(live['validate_contract']!.onFail).toEqual({
      goto: 'plan_tables',
      when: 'validate_contract.ok == false',
      carry: 'errors',
      maxAttempts: 2,
    });
    // Types exist before the first line of app code. The plan nodes are listed EXPLICITLY even
    // though `validate_contract` already depends on them: `getUpstreamOutputs` passes only a node's
    // OWN `dependsOn`, not the transitive closure, so a contract it did not name would arrive
    // undefined.
    expect(live['emit_types']!.dependsOn).toEqual([
      'validate_contract', 'plan_tables', 'plan_endpoints', 'plan_components',
    ]);
    expect(live['reconcile_tables']!.dependsOn).toEqual([
      'implement_tables', 'plan_tables', 'plan_endpoints', 'plan_components',
    ]);
    // Nothing else in the pipeline ever RUNS an endpoint; a handler returning structurally-valid
    // zeros passes typecheck, esbuild and every static scan.
    expect(live['smoke_endpoints']!.dependsOn).toEqual(['implement_endpoints']);
    // GATE-AND-RETRY: after every file is written, `verify` — a HOST-RUN code node — compiles the
    // app (buildProjectApp = typecheck → esbuild) AND runs the mechanical scans the compiler cannot
    // (endpoint→table, page→endpoint, param arity, the { type, props } descriptor shape, a surface
    // token used as text). It routes each offending FILE to a per-file fix fork. `fix` then RESUMES
    // `verify` through onFail, so the cycle loops until clean instead of being hand-unrolled into
    // compile_pass1 → fix_pass1 → compile_pass2 → fix_pass2 (which duplicated the scan three times
    // and capped the retry budget at however many copies were written).
    expect(live['verify']!.kind).toBe('code');
    expect(live['verify']!.dependsOn).toEqual([
      'implement_tables', 'implement_endpoints', 'smoke_endpoints', 'implement_components', 'implement_pages',
    ]);
    expect(live['fix']!.forEach).toBe('verify.offending');
    expect(live['fix']!.onFail).toEqual({ goto: 'verify', when: 'verify.ok == false', maxAttempts: 3 });
    // finalize runs after the loop settles and is the sole authoritative build-invoker.
    expect(live['finalize']!.dependsOn).toEqual([
      'implement_tables', 'implement_endpoints', 'smoke_endpoints', 'implement_components', 'implement_pages', 'verify', 'fix',
    ]);
    // Every implement node is model-driven (a code node would need codeNodeCtxFactory threaded through
    // the delegate path THING uses; a model node needs no host factory and writes via writeProjectTable).
    // The model-driven nodes run with write access (role general).
    for (const id of ['user_stories', 'plan_app', 'plan_tables', 'implement_tables', 'plan_endpoints', 'implement_endpoints', 'plan_components', 'implement_components', 'plan_pages', 'implement_pages', 'fix', 'finalize']) {
      expect(live[id]!.role).toBe('general');
    }
    // finalize is the sole goal — it writes the chat _layout and reports the build.
    expect(live['finalize']!.goal).toBe(true);
    expect(resolveGoalTask(live)!.id).toBe('finalize');
  });

  it('architect tasklists declare input schemas matching what their callers pass', async () => {
    const space = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    // THING's build task / the architect instruct seed { topic, goal, research }, plus an OPTIONAL
    // attachmentIds so a caller with real supplied documents can let build_field re-read them
    // instead of trusting the lossy `research` summary alone for a specific fact.
    expect(space.tasklists['synthesize_and_run']!.input).toEqual({
      topic: 'string',
      goal: 'string',
      research: 'string',
      attachmentIds: 'array?',
    });
    // The architect instruct's Job 2 seeds { spaceKey, feedback }.
    expect(space.tasklists['iterate_space']!.input).toEqual({
      spaceKey: 'string',
      feedback: 'string',
    });
  });

  it('research agent exposes shallow research + deep_research (forEach) actions', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    // deep_research: scope (broad search) -> plan -> investigate (forEach) -> synthesize -> summarize.
    const deep = await loadTasklistFromSpace(space, 'deep_research');
    expect(deep['scope']!.role).toBe('explore');
    expect(deep['scope']!.functions).toEqual(['webSearch']);
    expect(deep['investigate']!.forEach).toBe('plan.questions');
    expect(deep['investigate_a']).toBeUndefined();
    // synthesize clusters/dedupes but is no longer the goal — summarize writes the final report.
    expect(deep['synthesize']!.goal).toBeFalsy();
    expect(resolveGoalTask(deep)!.id).toBe('summarize');
    // research: a single shallow quick-answer task.
    const shallow = await loadTasklistFromSpace(space, 'research');
    expect(Object.keys(shallow)).toEqual(['answer']);
    expect(resolveGoalTask(shallow)!.id).toBe('answer');
  });
});

describe('user-thing build_specialist (structural build pipeline)', () => {
  async function load(): Promise<{ space: Space; tasks: Record<string, TaskNode> }> {
    const space = await loadSpace(resolve(SYS, 'user-thing'), { requireAgents: false });
    const tasks = await loadTasklistFromSpace(space, 'build_specialist');
    return { space, tasks };
  }

  it('is a valid 2-task DAG (optional research → build goal) with the declared input schema', async () => {
    const { space, tasks } = await load();
    expect(() => validateDag(tasks)).not.toThrow();
    expect(Object.keys(tasks).sort()).toEqual(['build', 'research']);
    expect(space.tasklists['build_specialist']!.input).toEqual({ request: 'string' });

    const research = tasks['research']!;
    expect(research.optional).toBe(true);
    expect(research.role).toBe('explore');
    expect(research.functions).toEqual([]);
    expect(research.output).toEqual({ report: 'object' });
    expect(research.canDelegateTo).toEqual(['system-research/researcher#deep_research']);

    const build = tasks['build']!;
    expect(build.goal).toBe(true);
    expect(resolveGoalTask(tasks)!.id).toBe('build');
    expect(build.dependsOn).toEqual(['research']);
    expect(build.role).toBe('general');
    expect(build.functions).toEqual([]);
    expect(build.canDelegateTo).toEqual(['system-architect/architect#synthesize_and_run']);
  });

  it("build's output schema mirrors the architect finalize task field-for-field", async () => {
    const { tasks } = await load();
    const architect = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    const synth = await loadTasklistFromSpace(architect, 'synthesize_and_run');
    expect(tasks['build']!.output).toEqual(synth['finalize']!.output);
  });

  it("research's prelude performs the delegation itself and typechecks against the fork ambient", async () => {
    const { space, tasks } = await load();
    const research = tasks['research']!;
    expect(research.prelude).toBeTruthy();
    const stmts = splitPreludeStatements(research.prelude!);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain("await delegate('system-research', 'researcher', 'deep_research'");
    typecheckPrelude(research, space.tasklists['build_specialist']!, {});
  });
});

describe('system-research preludes (deterministic gather moved to the host)', () => {
  it('every gather task ships a prelude with the expected statements; pure-reasoning tasks do not', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    const deep = await loadTasklistFromSpace(space, 'deep_research');
    const shallow = await loadTasklistFromSpace(space, 'research');

    // scope: topic + 2 searches.
    expect(splitPreludeStatements(deep['scope']!.prelude ?? '')).toHaveLength(3);
    // investigate: question + search + top + 3 fetches.
    expect(splitPreludeStatements(deep['investigate']!.prelude ?? '')).toHaveLength(6);
    // synthesize: mechanical aggregation (entries/seedSources/rawSources/all_sources/
    // combined_findings/gap_notes) — kills the 'sourceMap is not defined' improvisation.
    const synthStmts = splitPreludeStatements(deep['synthesize']!.prelude ?? '');
    expect(synthStmts).toHaveLength(6);
    expect(deep['synthesize']!.prelude).toContain('all_sources');
    // answer: q + search + top + 1 fetch.
    expect(splitPreludeStatements(shallow['answer']!.prelude ?? '')).toHaveLength(4);
    // Pure-reasoning tasks carry NO prelude.
    expect(deep['plan']!.prelude).toBeUndefined();
    expect(deep['summarize']!.prelude).toBeUndefined();
  });

  it('every system-research prelude typechecks statement-by-statement against its fork ambient', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    const allFns = await globalFunctions();
    expect(Object.keys(allFns)).toContain('webSearch');
    expect(Object.keys(allFns)).toContain('webFetch');

    for (const tlName of ['deep_research', 'research']) {
      const tl = space.tasklists[tlName]!;
      const tasks = await loadTasklistFromSpace(space, tlName);
      for (const task of Object.values(tasks)) {
        if (!task.prelude) continue;
        typecheckPrelude(task, tl, allFns);
      }
    }
  });
});
