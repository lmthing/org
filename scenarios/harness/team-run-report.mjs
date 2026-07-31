#!/usr/bin/env node
/**
 * team-run-report.mjs — render a played TEAM run as one table a human (or a judge) can read.
 *
 *   node scenarios/harness/team-run-report.mjs 20-studio 2          # a run of a scenario
 *   node scenarios/harness/team-run-report.mjs 20-studio 2 --expect # + every expect clause, per step
 *
 * The per-step evidence is already on disk (`step-NN.json`), but a judge reading twelve files has to
 * hold the whole conversation in their head to see who was talking to whom. This flattens it: one
 * row per TURN, carrying the four facts a team step is unreadable without — who, their role, the
 * channel, the thread — plus the things only a team run has: what THING wrote, which TEAM GLOBALS it
 * reached for, where it posted that nobody asked it to, and whether the pod refused anybody.
 *
 * It reports; it does not judge. `--expect` prints each step's clauses with an empty verdict box,
 * because whether a clause held is a reading of the evidence, not something a script can score.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadSessionFacts, jargonHits } from '../lib/team-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [scenarioId = '20-studio', runId = 'latest'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showExpect = process.argv.includes('--expect');

const runDir = join(HERE, '..', scenarioId, 'runs', String(runId));
if (!existsSync(runDir)) {
  console.error(`no run at ${runDir}`);
  process.exit(1);
}

const steps = readdirSync(runDir)
  .filter((f) => /^step-\d+\.json$/.test(f))
  .sort()
  .map((f) => {
    const compact = JSON.parse(readFileSync(join(runDir, f), 'utf8'));
    // Recompute the ANSWER from the full evidence: the last `thing` message, never a `system` card.
    // `announceNewApps` appends "<project> is ready." AFTER the reply, so a run recorded before that
    // distinction existed shows the card as the answer (20-studio run 2 step 2 reads "user is ready."
    // where THING in fact wrote several paragraphs). The full dump has every message, so the true
    // answer is recoverable without replaying anything.
    // A run recorded before `systemCards` existed has neither, so fall back to the CHANNEL LOG in
    // the run's own data dir — the authoritative record of everything that was said.
    const fullPath = join(runDir, f.replace('.json', '.full.json'));
    const full = existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, 'utf8')) : null;
    compact.turns?.forEach((t, i) => {
      const cards = full?.turns?.[i]?.systemCards;
      if (cards?.length) t.systemCards = cards;
      const fromLog = lastThingReply(t);
      if (fromLog) {
        if (fromLog.text) t.lastText = fromLog.text;
        if (!t.systemCards && fromLog.cards.length) t.systemCards = fromLog.cards;
      }
    });
    return compact;
  });

/**
 * The last `thing` message of a turn's thread, read from the channel log.
 *
 * `announceNewApps` appends a `system` card AFTER the reply, so "the last message in the thread" is
 * often the card, not the answer — 20-studio run 2 step 2 records `lastText: "user is ready."` for a
 * nine-minute build that in fact answered in full. Only a `thing` message is THING talking.
 */
function lastThingReply(turn) {
  if (!turn?.threadId || !turn?.channel || turn.dm) return null;
  const log = join(runDir, 'data', '.lmthing', '.team', 'channels', `${turn.channel}.jsonl`);
  if (!existsSync(log)) return null;
  let msgs;
  try {
    msgs = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    return null;
  }
  const inThread = msgs.filter((m) => m.threadId === turn.threadId || m.id === turn.threadId);
  const thing = inThread.filter((m) => m.kind === 'thing');
  return {
    text: thing.length ? thing[thing.length - 1].text : '',
    cards: inThread.filter((m) => m.kind === 'system').map((m) => ({ text: m.text, app: m.app ?? null })),
  };
}

/**
 * Re-derive each turn's OWN work from the per-step snapshots.
 *
 * A thread's session snapshot is cumulative — every turn rewrites the whole history — so reading the
 * final file credits turn 1's seventeen-minute build to every later turn in the thread as well
 * (20-studio run 2 showed steps 7 and 8, six and four seconds each, "delegating to
 * system-appbuilder"). Each step's own `snapshots/step-NN/` copy is the history AS OF that step, so
 * the delta between consecutive snapshots is exactly what that step did. Runs recorded before the
 * runner tracked this get corrected here.
 */
function attributePerStep(all) {
  const mark = new Map(); // sessionId → statements the thread had before this step
  for (const s of all) {
    const snapDir = join(runDir, 'snapshots', `step-${String(s.step).padStart(2, '0')}`);
    if (!existsSync(snapDir)) continue;
    for (const t of s.turns ?? []) {
      if (!t.sessionId || t.inApp) continue;
      const since = mark.get(t.sessionId) ?? 0;
      const facts =
        threadSessionFacts(snapDir, 'user', t.sessionId, { since }) ??
        threadSessionFacts(snapDir, s.activeProject ?? 'user', t.sessionId, { since });
      if (!facts) continue;
      t.wrote = { ...facts };
      t.delegates = facts.delegates;
      mark.set(t.sessionId, facts.totalStatements);
    }
  }
  return all;
}

attributePerStep(steps);

const summary = existsSync(join(runDir, 'summary.json'))
  ? JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
  : null;

const TEAM_GLOBALS = ['teamContext', 'teamMembers', 'teamChannels', 'teamHistory', 'teamPost', 'teamPinApp'];
const short = (s, n = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const secs = (ms) => `${((ms ?? 0) / 1000).toFixed(0)}s`;

console.log(`\n# ${scenarioId} · run ${runId}${summary ? ` · project ${summary.project}` : ''}`);
if (summary) {
  console.log(`  ${summary.ranSteps}/${summary.ofSteps} steps · ${summary.turns} turns · cast ${summary.cast.map((c) => `${c.key}<${c.role}>`).join(', ')}`);
}

console.log(`\n| # | verb | who | where | thread | status | wall | wrote / globals | notes |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const s of steps) {
  const flags = [];
  if (s.denied) flags.push(`REFUSED ${s.denied.status}`);
  if (s.error) flags.push(`ERROR: ${short(String(s.error).split('\n')[0], 70)}`);
  if (s.crossChannelPosts?.length) flags.push(`posted in #${s.crossChannelPosts.map((p) => p.channelId).join(', #')}`);
  if (s.createdProject) flags.push(`created project ${s.createdProject}`);
  for (const t of s.turns ?? []) for (const c of t.systemCards ?? []) flags.push(`card "${short(c.text, 40)}"${c.app ? ` (app ${c.app.projectId})` : ''}`);
  if (s.appBuild) flags.push(`build=${s.appBuild.built} check.ok=${s.appCheck?.ok} page=${s.appPageStatus}`);
  if (s.runEmitter) flags.push(`emitter ${s.runEmitter.slug ?? `${s.runEmitter.scope}:${s.runEmitter.name}`}`);

  if (!s.turns?.length) {
    console.log(`| ${s.step} | ${s.verbs.join(' ')} | — | — | — | ${s.error ? 'error' : 'no turn'} | — | — | ${flags.join(' · ') || ''} |`);
  }
  for (const t of s.turns ?? []) {
    const globals = t.wrote?.globals ?? [];
    const team = globals.filter((g) => TEAM_GLOBALS.includes(g));
    const wrote = [
      t.wrote?.delegates?.length ? `→${t.wrote.delegates.join(',')}` : '',
      globals.filter((g) => !TEAM_GLOBALS.includes(g)).join(',') || '',
      team.length ? `**${team.join(',')}**` : '',
    ].filter(Boolean).join(' · ');
    const asks = (t.asks ?? []).length
      ? ` · ask:${t.asks.map((a) => (a.answeredWith ? `answered("${short(a.answeredWith, 20)}")` : 'PARKED')).join(',')}`
      : '';
    console.log(
      `| ${s.step} | ${s.verbs.filter((v) => v !== 'as' && v !== 'in' && v !== 'say').join(' ') || 'say'} | ${t.who}<${t.role}> | ${t.dm ? `DM ${short(t.channel, 20)}` : `#${t.channel}`} | ${String(t.threadId ?? '—').slice(0, 8)} | ${t.status}${t.consumedPendingAsk ? ' (answered a park)' : ''} | ${secs(t.durationMs)} | ${wrote || '—'} | ${[...flags, asks].filter(Boolean).join(' · ')} |`,
    );
  }
}

// ── the beats that only a team run has ─────────────────────────────────────────────────────────
console.log(`\n## Team globals actually reached for`);
const used = new Map();
for (const s of steps) {
  for (const t of s.turns ?? []) {
    for (const g of t.wrote?.globals ?? []) {
      if (!TEAM_GLOBALS.includes(g)) continue;
      used.set(g, [...(used.get(g) ?? []), `step ${s.step} (${t.who})`]);
    }
  }
}
if (!used.size) console.log(`  NONE of ${TEAM_GLOBALS.join(', ')} was called in this run.`);
for (const [g, where] of used) console.log(`  ${g}: ${where.join(', ')}`);

console.log(`\n## Cross-channel posts (THING writing where nobody asked it to)`);
let any = false;
for (const s of steps) {
  for (const p of s.crossChannelPosts ?? []) {
    any = true;
    console.log(`  step ${s.step} → #${p.channelId} [${p.kind}]: ${short(p.text, 140)}`);
  }
}
if (!any) console.log('  (none)');

// Computed here as well as in the runner, so a run recorded before the scan existed still gets it.
console.log(`\n## Machine words in what THING said to a channel`);
let jargonAny = false;
for (const s of steps) {
  for (const t of s.turns ?? []) {
    const hits = t.jargon?.length ? t.jargon : jargonHits(t.lastText);
    if (!hits.length) continue;
    jargonAny = true;
    console.log(`  step ${s.step} (${t.who} in ${t.dm ? 'a DM' : '#' + t.channel}): ${hits.map((h) => h.word).join(', ')}`);
    for (const h of hits) console.log(`      "…${h.context}…"`);
  }
}
if (!jargonAny) console.log('  (none — every reply was in the persona\'s own words)');

console.log(`\n## Refusals`);
const refusals = steps.filter((s) => s.denied);
if (!refusals.length) console.log('  (none — note that POSTING A MESSAGE is viewer-allowed by design)');
for (const s of refusals) console.log(`  step ${s.step}: ${s.denied.who}<${s.denied.role}> → ${s.denied.status} ${JSON.stringify(s.denied.body)}`);

console.log(`\n## App / view-spec state (last step that recorded any)`);
for (const s of [...steps].reverse()) {
  if (!s.state) continue;
  const vf = s.state.viewFacts;
  console.log(`  step ${s.step}: tables ${JSON.stringify(s.state.appTables)} · pages ${s.state.appManifest?.pageCount ?? '?'} · spaces ${(s.state.spaces ?? []).join(',') || 'none'}`);
  if (vf) console.log(`    viewFacts: ${JSON.stringify(vf).slice(0, 600)}`);
  else console.log('    viewFacts: none recorded (no *.view.json in the project → NOT a spec app)');
  break;
}

if (showExpect) {
  console.log(`\n## Expect clauses (verdict is a READING of the evidence, not a script's)`);
  for (const s of steps) {
    console.log(`\n### Step ${s.step} — ${s.verbs.join(', ')}`);
    for (const e of s.expect ?? []) console.log(`  [ ] ${e}`);
  }
}
console.log(`\nevidence: ${runDir}/step-NN.json (+ .full.json) · trace.md · summary.json`);
