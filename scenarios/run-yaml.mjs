#!/usr/bin/env node
/**
 * run-yaml.mjs — the GENERIC scenario runner.
 *
 * Plays a declarative `scenario.yaml` (persona · promise · invariants · steps) against a LOCAL
 * `lmthing serve`, driving the pod through the harness exactly as the /chat SPA would, and writes
 * per-step EVIDENCE (the execution trace + the real spaces/DB/app state after each step) for the
 * JUDGE to read. It does NOT judge — the judge (see automation/instances/scenario-campaign/judge.md)
 * reads this output, decides pass/fail per step, and fixes at the right rung.
 *
 * Local only: SCENARIO_TARGET defaults to 'local' here (getUser → http://localhost:8080, no auth).
 *
 *   node scenarios/run-yaml.mjs 06-tanzania                 # play the whole scenario, fresh project
 *   node scenarios/run-yaml.mjs 06-tanzania --through 5     # play steps 1..5 (the judge's verify rerun)
 *   node scenarios/run-yaml.mjs 06-tanzania --out <dir>     # where to write evidence (default <sc>/.run)
 *
 * Step verbs (see scenario-spec.md): attach[] · say · then_say · open_app · in_app_chat ·
 * fresh_session · restart_pod · if_asked{} · expect[] (expect is passed through, never executed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/yaml.mjs';
import { getUser } from './harness/provision.mjs';
import { Pod } from './harness/lib/pod.mjs';
import { ThingSession, approveAllConsent, denyAllConsent } from './harness/lib/thing.mjs';
import { restartLocalServer, freshLocalServer, serverUp, podRoot } from './harness/lib/local.mjs';

process.env.SCENARIO_TARGET ??= 'local'; // this runner is local-only by design

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const idOrPath = argv.find((a) => !a.startsWith('--')) ?? '06-tanzania';
const verbose = argv.includes('--verbose');
const keepProject = argv.includes('--keep-project');
const planOnly = argv.includes('--plan'); // parse + print the plan, never connect to a pod
const freshServer = argv.includes('--fresh-server'); // WIPE the pod data dir (0 projects) + start clean first

// Resolve scenario dir + yaml.
const scenarioDir = idOrPath.endsWith('.yaml')
  ? dirname(resolve(idOrPath))
  : resolve(HERE, idOrPath);
const yamlPath = idOrPath.endsWith('.yaml') ? resolve(idOrPath) : join(scenarioDir, 'scenario.yaml');
if (!existsSync(yamlPath)) fail(`no scenario.yaml at ${yamlPath}`);
const fixturesDir = join(scenarioDir, 'fixtures');

const scenario = parseYaml(readFileSync(yamlPath, 'utf8'));
const steps = scenario.steps ?? [];
const through = Number(flag('--through', String(steps.length)));
const outDir = resolve(flag('--out', join(scenarioDir, '.run')));
// A fresh server means an empty runtime root, so the stable scenario project id is collision-free
// and keeps evidence readable. Without --fresh-server (dev re-runs on a dirty root) a unique suffix
// avoids clobbering an existing project.
const projectId = flag('--project', freshServer ? (scenario.project ?? scenario.id) : `${scenario.project ?? scenario.id}-${Date.now().toString(36)}`);

mkdirSync(outDir, { recursive: true });
const traceMd = [];
function log(...a) {
  if (verbose) console.log('[run-yaml]', ...a);
}
function fail(msg) {
  console.error(`run-yaml: ${msg}`);
  process.exit(1);
}
function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ── ask handling: the driver answers in-persona; the JUDGE later scores the ask ────────────────
// A step's `if_asked` map + the scenario `knows` list ground the load-bearing answers. Consent is
// approved by default (a step may set `deny_consent: true`). Every ask + how it was answered is
// recorded so the judge can score whether asking was correct (and whether the answer was right).
let currentStep = {};
const asksThisStep = [];
function onAsk(descriptor) {
  const text = JSON.stringify(descriptor ?? {});
  // Consent cards: approve unless the step opts into denial.
  if (descriptor?.type === 'ConsentCard') {
    const answer = currentStep.deny_consent ? false : true;
    asksThisStep.push({ kind: 'consent', answer, descriptor });
    return answer;
  }
  // Clarifying question / form: match the step's if_asked, else best-effort from its single entry.
  const ifAsked = currentStep.if_asked ?? {};
  const keys = Object.keys(ifAsked);
  let matched =
    keys.find((k) => text.toLowerCase().includes(k.toLowerCase().slice(0, 24))) ??
    (keys.length === 1 ? keys[0] : undefined);
  const answer = matched ? ifAsked[matched] : '';
  asksThisStep.push({ kind: 'question', matched: matched ?? null, answer, descriptor });
  // Return the string answer; unmatched → '' (recorded prominently so the judge sees an unhandled ask).
  return answer;
}

// ── state capture: what the judge verifies token-in-state against ──────────────────────────────
async function snapshot(pod) {
  const snap = { spaces: [], appTables: {}, appManifest: null, error: null };
  try {
    const sp = await pod.listSpaces(projectId).catch(() => null);
    snap.spaces = (sp?.spaces ?? sp ?? []).map((s) => s.slug ?? s.name ?? s.id ?? s);
  } catch (e) {
    snap.error = String(e?.message ?? e);
  }
  try {
    const man = await pod.appManifest(projectId).catch(() => null);
    if (man) {
      snap.appManifest = { tables: man.tables ?? man.database ?? [], pages: man.pages ?? [], built: man.build?.built ?? null };
      const tableNames = (snap.appManifest.tables ?? []).map((t) => t.name ?? t.slug ?? t).filter(Boolean);
      for (const t of tableNames) {
        const rows = await pod.appData(projectId, t).catch(() => null);
        if (rows) snap.appTables[t] = rows.rows ?? rows.data ?? rows;
      }
    }
  } catch (e) {
    snap.appError = String(e?.message ?? e);
  }
  return snap;
}

// ── dry plan: parse + print the step plan, never touch a pod ───────────────────────────────────
if (planOnly) {
  console.log(`scenario ${scenario.id} — "${scenario.title}"  (project ${scenario.project})`);
  console.log(`persona: ${String(scenario.persona).slice(0, 90)}…`);
  console.log(`invariants: ${scenario.invariants?.length}  ·  knows: ${scenario.knows?.length}  ·  steps: ${steps.length}\n`);
  const allFixtures = new Set();
  steps.forEach((s, i) => {
    const verbs = Object.keys(s).filter((k) => k !== 'expect');
    (s.attach ?? []).forEach((f) => allFixtures.add(f));
    const msg = (s.say ?? s.then_say ?? s.in_app_chat ?? '').toString().replace(/\n/g, ' ').slice(0, 64);
    console.log(`  ${String(i + 1).padStart(2)}. [${verbs.join(', ')}]  ${msg}${msg.length >= 64 ? '…' : ''}`);
    if (s.attach) console.log(`       attach: ${s.attach.join(', ')}`);
    console.log(`       expect: ${s.expect?.length ?? 0}${s.if_asked ? '  if_asked: ' + Object.keys(s.if_asked).length : ''}`);
  });
  // Fixture coverage: does every file in fixtures/ get used, and does every attach exist?
  const used = [...allFixtures];
  console.log(`\nfixtures attached across the scenario (${used.length}): ${used.join(', ')}`);
  const missing = used.filter((f) => !existsSync(join(fixturesDir, f)));
  if (missing.length) console.log(`⚠️  attached but NOT on disk: ${missing.join(', ')}`);
  try {
    const onDisk = readdirSyncSafe(fixturesDir).filter((f) => !/^(links\.md|.*\.txt)$/.test(f));
    const unused = onDisk.filter((f) => !allFixtures.has(f));
    if (unused.length) console.log(`⚠️  on disk but NEVER attached: ${unused.join(', ')}`);
    else console.log(`✅ every uploadable fixture on disk is attached by some step`);
  } catch { /* fixtures dir may be absent */ }
  process.exit(0);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
(async () => {
  log(`scenario ${scenario.id} · project ${projectId} · steps 1..${through}/${steps.length}`);
  // The RUNNER owns its own PID file (never rely on the caller's shell `$!`): a stopper does
  // `kill $(cat <out>/runner.pid)` and it is always correct. Cleared on clean exit.
  const pidFile = join(outDir, 'runner.pid');
  writeFileSync(pidFile, String(process.pid));
  process.on('exit', () => { try { rmSync(pidFile, { force: true }); } catch { /* ignore */ } });
  console.log(`[run-yaml] pid ${process.pid} → ${pidFile}`);
  if (freshServer) {
    console.log('[run-yaml] --fresh-server: wiping the pod runtime root (0 projects) and starting clean…');
    await freshLocalServer();
    console.log(`[run-yaml] fresh pod root: ${podRoot()}`);
  }
  if (!(await serverUp())) fail('local server not up — run: node harness/local-server.mjs up (or pass --fresh-server)');

  const user = await getUser(scenario.id);
  const pod = new Pod({ base: user.pod, token: user.token });
  // Correctness check: a --fresh-server pod MUST start with no USER-created projects. A clean pod
  // always has the built-in `system` and `user` projects — those are infrastructure, not state leak.
  if (freshServer) {
    const all = (await pod.listProjects().catch(() => null))?.projects ?? [];
    const builtin = new Set(['system', 'user']);
    const leaked = all.map((p) => p.id ?? p).filter((id) => !builtin.has(id));
    console.log(
      leaked.length === 0
        ? `[run-yaml] confirmed: fresh pod has no user projects (built-ins only: ${all.map((p) => p.id ?? p).join(', ')})`
        : `[run-yaml] WARNING: fresh pod already has leaked project(s): ${leaked.join(', ')} — expected none`,
    );
  }
  // Fresh project (unique id per run unless --project pins one).
  try {
    await pod.createProject(projectId);
  } catch (e) {
    log(`createProject(${projectId}) — ${String(e?.message ?? e)} (continuing; may already exist)`);
  }

  let thing = new ThingSession(pod, { projectId, onAsk, verbose });
  await thing.start();

  const results = [];
  for (let n = 0; n < Math.min(through, steps.length); n++) {
    const step = steps[n];
    currentStep = step;
    asksThisStep.length = 0;
    const num = n + 1;
    const rec = { step: num, verbs: Object.keys(step).filter((k) => k !== 'expect'), expect: step.expect ?? [], turns: [], asks: [], notes: [] };
    log(`── step ${num}: ${rec.verbs.join(', ')}`);

    try {
      if (step.fresh_session) {
        thing = new ThingSession(pod, { projectId, onAsk, verbose });
        await thing.start();
        await thing.syncToTail();
        rec.notes.push('started a fresh session (zero history)');
      }
      if (step.restart_pod) {
        rec.notes.push('restarting local server…');
        await restartLocalServer();
        for (let i = 0; i < 40 && !(await serverUp()); i++) await sleep(500);
        rec.notes.push((await serverUp()) ? 'server back up' : 'server did NOT come back up');
      }

      // The message(s) for this step, with attachments if any.
      if (step.say != null) {
        let turn;
        if (Array.isArray(step.attach) && step.attach.length) {
          const refs = [];
          for (const f of step.attach) {
            const p = join(fixturesDir, f);
            if (!existsSync(p)) {
              rec.notes.push(`MISSING FIXTURE: ${f}`);
              continue;
            }
            refs.push(await pod.upload(p));
          }
          rec.attached = step.attach;
          turn = await thing.sendWithAttachments(step.say, refs);
        } else {
          turn = await thing.send(step.say);
        }
        rec.turns.push(summarizeTurn(turn, step.say));
      }
      if (step.then_say != null) {
        const t = await thing.send(step.then_say);
        rec.turns.push(summarizeTurn(t, step.then_say));
      }
      if (step.in_app_chat != null) {
        // The in-app chat is a project-scoped THING session with authoring caps — same project.
        const t = await thing.send(step.in_app_chat);
        rec.turns.push(summarizeTurn(t, `[in-app] ${step.in_app_chat}`));
      }
      if (step.open_app) {
        const build = await pod.appBuild(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
        rec.appBuild = { built: build?.built ?? build?.build?.built ?? null, routes: build?.routes ?? null, error: build?.error ?? null };
        const page = await pod.appPage(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
        rec.appPageStatus = page?.status ?? (page?.error ? `error: ${page.error}` : 'ok');
        rec.notes.push('opened app (built + fetched root page; browser render is the judge\'s job)');
      }
    } catch (e) {
      rec.error = String(e?.stack ?? e?.message ?? e);
      rec.notes.push(`STEP THREW: ${rec.error.split('\n')[0]}`);
    }

    rec.asks = [...asksThisStep];
    rec.state = await snapshot(pod);
    results.push(rec);
    writeFileSync(join(outDir, `step-${String(num).padStart(2, '0')}.json`), JSON.stringify(rec, null, 2));
    appendTrace(rec);
  }

  // Summary.
  const summary = {
    scenario: scenario.id,
    project: projectId,
    ranSteps: results.length,
    ofSteps: steps.length,
    sessionStats: thing.stats?.() ?? null,
    outDir,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, 'trace.md'), traceMd.join('\n'));
  if (!keepProject) log(`project ${projectId} left in place (delete with: pod.deleteProject)`);
  console.log(`\n✅ played ${results.length}/${steps.length} steps → ${outDir}`);
  console.log(`   read: ${join(outDir, 'trace.md')}  +  step-NN.json  +  summary.json`);
})().catch((e) => fail(String(e?.stack ?? e)));

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
function summarizeTurn(turn, sent) {
  if (!turn) return { sent, empty: true };
  return {
    sent,
    lastText: turn.lastText,
    delegates: turn.delegates,
    yieldKinds: [...new Set((turn.yields ?? []).map((y) => y.kind))],
    yields: (turn.yields ?? []).map((y) => ({ kind: y.kind, args: compact(y.args) })),
    errors: turn.errors ?? [],
    nodes: turn.nodes ?? [],
    tokens: turn.tokens,
    durationMs: turn.durationMs,
    interrupted: turn.interrupted ?? false,
  };
}
function compact(args) {
  try {
    const s = JSON.stringify(args);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : args;
  } catch {
    return String(args);
  }
}
function appendTrace(rec) {
  const L = traceMd;
  L.push(`\n## Step ${rec.step} — ${rec.verbs.join(', ')}`);
  for (const t of rec.turns) {
    L.push(`\n**sent:** ${String(t.sent).replace(/\n/g, ' ').slice(0, 200)}`);
    if (t.delegates?.length) L.push(`- delegates: ${t.delegates.join(', ')}`);
    if (t.yieldKinds?.length) L.push(`- yields: ${t.yieldKinds.join(', ')}`);
    if (t.errors?.length) L.push(`- errors: ${t.errors.map((e) => `${e.type}@${e.attempt}`).join(', ')}`);
    if (t.lastText) L.push(`- reply: ${String(t.lastText).replace(/\n/g, ' ').slice(0, 240)}`);
  }
  if (rec.asks?.length) L.push(`- asks: ${rec.asks.map((a) => `${a.kind}${a.matched ? `(matched)` : a.kind === 'question' && !a.answer ? '(UNANSWERED)' : ''}`).join(', ')}`);
  if (rec.appBuild) L.push(`- app: built=${rec.appBuild.built} pageStatus=${rec.appPageStatus}`);
  if (rec.state) {
    L.push(`- spaces: ${(rec.state.spaces ?? []).join(', ') || '(none)'}`);
    const tables = Object.keys(rec.state.appTables ?? {});
    if (tables.length) L.push(`- app tables: ${tables.map((t) => `${t}(${(rec.state.appTables[t] ?? []).length})`).join(', ')}`);
  }
  if (rec.notes?.length) L.push(`- notes: ${rec.notes.join(' · ')}`);
  if (rec.error) L.push(`- ⚠️ ERROR: ${rec.error.split('\n')[0]}`);
  L.push(`\n**expect (judge verifies):**`);
  for (const e of rec.expect) L.push(`  - [ ] ${e}`);
}
