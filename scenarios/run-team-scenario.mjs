#!/usr/bin/env node
/**
 * run-team-scenario.mjs — the TEAM scenario runner (thin CLI over `lib/team-runner.mjs`).
 *
 * The sibling of `run-scenario.mjs`. It plays a `scenario.yaml` that declares a `team:`, a `cast:`
 * and `channels:` against a per-run LOCAL `lmthing serve` booted in TEAM MODE, driving it exactly as
 * the team surface would — several members, in channels, in threads, with roles — and writes the
 * same per-step evidence for the JUDGE, plus the fields a team judge cannot read a step without:
 * WHO spoke, in WHICH channel, in WHICH thread, with WHICH role.
 *
 *   node scenarios/run-team-scenario.mjs 20-studio --plan          # parse + print the plan, no pod
 *   node scenarios/run-team-scenario.mjs 20-studio                 # a fresh run (runs/<next>)
 *   node scenarios/run-team-scenario.mjs 20-studio --through 3     # play steps 1..3
 *   node scenarios/run-team-scenario.mjs 20-studio --resume 1 --from 2   # seed run 1's step-2, continue at 3
 *
 * Flags: --plan · --through N · --run <id> · --out <dir> · --resume <runId> [--from N] · --verbose ·
 *        --keep-server · --purge.
 *
 * `run-scenario.mjs` and `lib/runner.mjs` are NOT touched by this: the eight personal scenarios play
 * byte-identically.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local by design, and set BEFORE the harness is imported — `local.mjs` computes its `LOCAL` flag at
// module-eval time and static imports hoist above any assignment, so the engine is loaded with a
// dynamic import below. Same contract as run-scenario.mjs.
process.env.SCENARIO_TARGET ??= 'local';
const { loadScenario } = await import('./lib/scenario.mjs');
const { runTeamScenario, teamPlanLines, FatalError } = await import('./lib/team-runner.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const idOrPath = argv.find((a) => !a.startsWith('--')) ?? '20-studio';
const verbose = argv.includes('--verbose');
const keepServer = argv.includes('--keep-server');
const purge = argv.includes('--purge');
const planOnly = argv.includes('--plan');

function fail(msg) {
  console.error(`run-team-scenario: ${msg}`);
  process.exit(1);
}

let loaded;
try {
  loaded = loadScenario(idOrPath, { here: HERE });
} catch (e) {
  fail(e instanceof FatalError ? e.message : String(e?.stack ?? e));
}
const { scenario, steps, scenarioDir } = loaded;

if (!scenario.team || !scenario.cast) {
  fail(
    `${scenario.id} is not a team scenario (no \`team:\`/\`cast:\` block) — play it with run-scenario.mjs instead`,
  );
}

const through = Number(flag('--through', String(steps.length)));
const outDir = flag('--out') ? resolve(flag('--out')) : undefined;
const runId = flag('--run') ? Number(flag('--run')) : undefined;
const resumeId = flag('--resume');
const resumeFrom = resumeId ? { runId: Number(resumeId), from: flag('--from') ? Number(flag('--from')) : undefined } : null;

if (planOnly) {
  teamPlanLines({ scenario, steps }).forEach((l) => console.log(l));
  process.exit(0);
}

const t0 = Date.now();
const reporter = {
  onRunStart: ({ runId: id, runDir, port, base, seedFrom, teamId }) =>
    console.log(
      seedFrom
        ? `[run-team] run ${id} → ${runDir} (port ${port}); team ${teamId}; seeded from ${seedFrom}`
        : `[run-team] run ${id} → ${runDir} (port ${port}, ${base}); team ${teamId}`,
    ),
  onPid: ({ pid, pidFile }) => console.log(`[run-team] pid ${pid} → ${pidFile}`),
  onProvider: ({ ok, hosts, note }) =>
    console.log(`[run-team] provider ${ok ? 'reachable' : 'UNREACHABLE'}: ${note ?? hosts.map((h) => `${h.host} ${h.ok ? h.ms + 'ms' : h.error}`).join(' · ')}`),
  onProvisioned: ({ cast, channels }) =>
    console.log(
      `[run-team] cast: ${cast.map((m) => `${m.name}<${m.role}>`).join(', ')}  ·  channels: ${channels.map((c) => `#${c.id}`).join(', ')}`,
    ),
  onStepStart: ({ step, verbs, of }) =>
    console.log(`\n[run-team] ── step ${step}/${of}  [${verbs.join(', ')}]  (+${((Date.now() - t0) / 60000).toFixed(1)}min)`),
  onStepDone: ({ step, rec }) => {
    for (const t of rec.turns ?? []) {
      const asks = t.asks?.length ? `  asks=${t.asks.length}${t.asks.some((a) => !a.answeredWith) ? '(PARKED)' : ''}` : '';
      console.log(
        `[run-team]    ${t.who}<${t.role}> ${t.dm ? 'DM' : '#' + t.channel} → ${t.status}${asks}  ${(t.durationMs / 1000).toFixed(0)}s  ${String(t.lastText ?? '').replace(/\s+/g, ' ').slice(0, 100)}`,
      );
    }
    if (rec.denied) console.log(`[run-team]    ⛔ refused ${rec.denied.status} — ${JSON.stringify(rec.denied.body).slice(0, 120)}`);
    if (rec.crossChannelPosts?.length) console.log(`[run-team]    ↪ THING also posted in: ${rec.crossChannelPosts.map((p) => '#' + p.channelId).join(', ')}`);
    if (rec.error) console.log(`[run-team]    ⚠️ ERROR: ${rec.error.split('\n')[0]}`);
    console.log(`[run-team]    step ${step} → ${rec.activeProject} · tables ${Object.keys(rec.state?.appTables ?? {}).join(', ') || '(none)'}`);
  },
  onSnapshot: ({ step, dir }) => console.log(`[run-team] step ${step} snapshot → ${dir}`),
  onDone: ({ ranSteps, ofSteps, outDir: od, tracePath, summary }) => {
    if (summary.voidSteps?.length) {
      console.log(`\n🚫 ${summary.verdict} — steps ${summary.voidSteps.join(', ')}. This run is NOT a result; rerun it.`);
    }
    console.log(`\n✅ played ${ranSteps}/${ofSteps} steps → ${od}`);
    console.log(`   ${summary.turns} channel turns (${summary.tokenAccounting.turnsWithout} of them unaccounted in the pod ledger) · project ${summary.project}`);
    console.log(`   read: ${tracePath}  +  step-NN.json (compact; step-NN.full.json for drill-down)  +  summary.json`);
  },
};

runTeamScenario({ scenario, steps, scenarioDir, runId, resumeFrom, outDir, through, keepServer, purge, verbose, reporter }).catch((e) =>
  fail(e instanceof FatalError ? e.message : String(e?.stack ?? e)),
);
