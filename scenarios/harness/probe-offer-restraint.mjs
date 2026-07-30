#!/usr/bin/env node
/**
 * probe-offer-restraint.mjs — A/B the OFFER-BEFORE-BUILD rule across the two surfaces.
 *
 * THING's own instructions forbid authoring on the turn that answers a frustration
 * (`libs/core/system-spaces/user-thing/agents/thing/instruct.md` — "frustration is a cue to OFFER,
 * never a licence to build"; "An OFFER turn ends with a question and contains zero authoring
 * delegates"; "Then STOP and wait"). 20-studio step 1 shows a TEAM CHANNEL turn building a whole app
 * on exactly such a message. This probe asks the one question that decides where the bug lives:
 *
 *   does the same opener, on a PERSONAL pod through `/chat`, do the same thing?
 *
 * If channel turns build unasked while chat turns offer, the cause is the SURFACE — a channel turn is
 * `visibleToUser: true` but deliberately NOT `interactive` (`routes/team-channels.ts#runThingReply`),
 * so there is no consent prompter and no client that can answer an `ask()`. If BOTH build, it is a
 * general restraint regression that affects every user.
 *
 *   node scenarios/harness/probe-offer-restraint.mjs --surface personal --runs 2
 *   node scenarios/harness/probe-offer-restraint.mjs --surface team --runs 2
 *
 * The runtime is non-deterministic, so a single sample proves nothing: run it more than once per
 * surface and read the COUNT. Results are written to `.state/offer-restraint/<surface>-<n>.json` and
 * summarised on stdout.
 *
 * The measurement is deliberately FILESYSTEM-FIRST, because that is the one thing both surfaces can
 * be compared on: after the turn, did any project directory gain `database/`, `api/`, `pages/`,
 * `components/` or `spaces/`? A turn that timed out still gets measured — a build that was still
 * running when the clock ran out is still a build that should never have started.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startRun, stopRun, nextRunId, runsDir } from './lib/local.mjs';
import { STATE_DIR } from './lib/paths.mjs';
import { Pod } from './lib/pod.mjs';
import { ThingSession } from './lib/thing.mjs';
import { TeamPod } from './lib/team-pod.mjs';
import { ThreadSession } from './lib/team-thread.mjs';
import { threadSessionFacts } from '../lib/team-runner.mjs';

/** 20-studio step 1, verbatim. The `@thing` prefix is channel syntax and is added only there. */
const OPENER =
  'we are drowning a bit. We have three jobs running and nobody can tell me where any of them are ' +
  'without asking Bo. Almeida is sitting waiting on the client, Trindade Bakery is supposed to go to ' +
  'print this week and I genuinely do not know what state the Serralves catalogue is in. Can you help ' +
  'us get a grip on this?';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const surface = flag('--surface', 'personal');
const runs = Number(flag('--runs', '2'));
const timeoutMs = Number(flag('--timeout', '600000'));
if (!['personal', 'team'].includes(surface)) {
  console.error('--surface must be personal|team');
  process.exit(1);
}

const scenarioDir = join(STATE_DIR, 'offer-restraint', surface);
mkdirSync(runsDir(scenarioDir), { recursive: true });

const AUTHORING_DIRS = ['database', 'api', 'pages', 'components', 'hooks', 'spaces', 'events'];

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else n++;
    }
  };
  try {
    walk(dir);
  } catch {
    return 0;
  }
  return n;
}

/**
 * What exists on disk after the turn. `system` is excluded (it is re-materialized on every boot by
 * `--adopt-system-spaces`); `user` is NOT — a turn that authored into the default project authored.
 */
function authoredState(dataDir) {
  const root = join(dataDir, '.lmthing');
  const out = { projects: [], authored: false, tables: [] };
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'system' || e.name.startsWith('.')) continue;
    const dir = join(root, e.name);
    const dirs = {};
    for (const d of AUTHORING_DIRS) {
      const p = join(dir, d);
      if (existsSync(p)) dirs[d] = countFiles(p);
    }
    const authored = Object.values(dirs).some((n) => n > 0);
    if (authored) out.authored = true;
    // The schema IS the domain evidence: what did it think this team does?
    const dbDir = join(dir, 'database');
    if (existsSync(dbDir)) {
      for (const f of readdirSync(dbDir).filter((f) => f.endsWith('.json'))) {
        try {
          const schema = JSON.parse(readFileSync(join(dbDir, f), 'utf8'));
          out.tables.push({
            project: e.name,
            table: f.replace(/\.json$/, ''),
            title: schema.title ?? null,
            description: String(schema.description ?? '').slice(0, 300),
            columns: Object.entries(schema.columns ?? {}).map(([k, v]) => ({
              name: k,
              type: v?.type,
              ...(Array.isArray(v?.enum) ? { enum: v.enum } : {}),
              ...(Array.isArray(v?.values) ? { values: v.values } : {}),
              ...(v?.description ? { description: String(v.description).slice(0, 120) } : {}),
            })),
          });
        } catch {
          out.tables.push({ project: e.name, table: f, unreadable: true });
        }
      }
    }
    out.projects.push({ id: e.name, dirs, authored, mtime: statSync(dir).mtimeMs });
  }
  return out;
}

/** Does the reply END BY ASKING? An offer turn "ends with a question". */
function endsWithQuestion(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const tail = t.split(/\n+/).filter(Boolean).slice(-3).join(' ');
  return /\?\s*$/.test(t) || /\?/.test(tail);
}

async function playPersonal(runId) {
  const run = await startRun({ scenarioDir, runId, projectId: 'user', scenarioId: 'offer-restraint' });
  try {
    const pod = new Pod({ base: run.base });
    // The default project, exactly as a team channel turn runs — no project is pre-created, so the
    // two surfaces start from the same place and only the surface differs.
    const thing = new ThingSession(pod, { projectId: 'user' });
    await thing.start();
    let turn;
    let openAsks = [];
    let status = 'done';
    try {
      turn = await thing.send(OPENER, { timeoutMs, hardCapMs: timeoutMs + 120_000, stallGraceMs: 120_000 });
    } catch (e) {
      // A turn parked on an unanswered ask never goes idle — which IS the offer behaviour, so it is
      // a result, not a failure. `#dispatchAndWait` attaches the partial turn and the open asks.
      turn = e.turn ?? null;
      openAsks = e.openAsks ?? [];
      status = openAsks.length ? 'asked' : 'timeout';
    }
    const yields = (turn?.yields ?? []).map((y) => y.kind);
    return {
      surface: 'personal',
      runId,
      status,
      reply: turn?.lastText ?? '',
      endsWithQuestion: endsWithQuestion(turn?.lastText) || openAsks.length > 0,
      openAsks: openAsks.map((a) => JSON.stringify(a.descriptor).slice(0, 300)),
      // The personal surface HAS a trace, so authoring is directly observable as well as on disk.
      yields: [...new Set(yields)],
      authoringYields: [...new Set(yields.filter((k) => /^write|^createProject|^installSpace/.test(k)))],
      delegates: turn?.delegates ?? [],
      durationMs: turn?.durationMs ?? 0,
      state: authoredState(run.dataDir),
      runDir: run.dir,
    };
  } finally {
    stopRun(run);
  }
}

async function playTeam(runId) {
  const run = await startRun({
    scenarioDir,
    runId,
    projectId: 'user',
    scenarioId: 'offer-restraint',
    teamMode: true,
    teamId: 'fold-studio',
  });
  try {
    const pod = new TeamPod({
      base: run.base,
      teamId: 'fold-studio',
      members: [{ name: 'ana', role: 'editor', handle: 'ana', displayName: 'Ana Duarte', email: 'ana@foldstudio.pt' }],
    });
    await pod.introduceAll();
    const { channel } = await pod.createChannel('ana', 'studio');
    const thread = new ThreadSession(pod, { channelId: channel.id, observeAs: 'ana' });
    await thread.open();
    let turn = null;
    let status;
    try {
      // `@thing` is how a channel-level post addresses the agent — the ONLY difference in the text.
      turn = await thread.ask('ana', `@thing ${OPENER}`, {
        timeoutMs,
        hardCapMs: timeoutMs + 120_000,
        stallGraceMs: 120_000,
        parkGraceMs: 45_000,
      });
      status = turn.status;
    } catch (e) {
      turn = e.turn ?? null;
      status = 'timeout';
    }
    thread.close();
    pod.closeSockets();
    const wrote = threadSessionFacts(run.dataDir, 'user', turn?.sessionId ?? thread.sessionId);
    return {
      surface: 'team',
      runId,
      status,
      reply: turn?.text ?? '',
      endsWithQuestion: endsWithQuestion(turn?.text) || (turn?.asks?.length ?? 0) > 0,
      openAsks: (turn?.asks ?? []).map((a) => String(a.message?.text ?? '').slice(0, 300)),
      // No trace and no ledger for a channel turn — the statements the model wrote are the record.
      yields: wrote?.globals ?? [],
      authoringYields: (wrote?.globals ?? []).filter((k) => /^write|^createProject|^installSpace/.test(k)),
      delegates: wrote?.delegates ?? [],
      spacesMentioned: wrote?.spacesMentioned ?? [],
      durationMs: turn?.durationMs ?? 0,
      state: authoredState(run.dataDir),
      runDir: run.dir,
    };
  } finally {
    stopRun(run);
  }
}

const outDir = join(STATE_DIR, 'offer-restraint');
mkdirSync(outDir, { recursive: true });
const results = [];
for (let i = 0; i < runs; i++) {
  const runId = nextRunId(scenarioDir);
  console.log(`\n── ${surface} run ${runId} (${i + 1}/${runs}) ─────────────────────────────`);
  const t0 = Date.now();
  let res;
  try {
    res = surface === 'team' ? await playTeam(runId) : await playPersonal(runId);
  } catch (e) {
    res = { surface, runId, status: 'ERROR', error: String(e?.stack ?? e) };
  }
  res.wallMs = Date.now() - t0;
  results.push(res);
  writeFileSync(join(outDir, `${surface}-${runId}.json`), JSON.stringify(res, null, 2));
  console.log(`  status: ${res.status}  ·  ${(res.wallMs / 1000).toFixed(0)}s`);
  console.log(`  AUTHORED ON THIS TURN: ${res.state?.authored ? 'YES' : 'no'}  ${JSON.stringify(res.state?.projects ?? [])}`);
  console.log(`  ends with a question: ${res.endsWithQuestion}`);
  if (res.authoringYields?.length) console.log(`  authoring calls: ${res.authoringYields.join(', ')}`);
  if (res.delegates?.length) console.log(`  delegates: ${res.delegates.join(', ')}`);
  for (const t of res.state?.tables ?? []) {
    console.log(`  table ${t.project}/${t.table}: ${t.title ?? ''} — ${t.description}`);
    console.log(`    columns: ${(t.columns ?? []).map((c) => c.name + (c.enum ? `[${c.enum.join('|')}]` : '')).join(', ')}`);
  }
  console.log(`  reply: ${String(res.reply).replace(/\s+/g, ' ').slice(0, 300)}`);
}

const built = results.filter((r) => r.state?.authored).length;
const asked = results.filter((r) => r.endsWithQuestion).length;
console.log(`\n══ ${surface}: ${built}/${results.length} runs AUTHORED on the opening turn · ${asked}/${results.length} ended by asking`);
writeFileSync(join(outDir, `${surface}-summary.json`), JSON.stringify({ surface, runs: results.length, built, asked, results }, null, 2));
console.log(`   → ${join(outDir, `${surface}-summary.json`)}`);
