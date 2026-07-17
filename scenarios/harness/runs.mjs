#!/usr/bin/env node
/**
 * runs.mjs — inspect and clean up a scenario's per-run servers + data dirs.
 *
 * Each `run-scenario.mjs` invocation creates an isolated, uniquely-numbered run under
 * `sdk/org/scenarios/<scenario>/runs/<n>/` (its own `data/.lmthing`, its own `lmthing serve`, its own
 * per-step snapshots). A run's server is killed with its run-scenario process, so this tool is mostly
 * for browsing prior runs and reaping the rare orphan (e.g. after a `kill -9` of run-scenario).
 *
 *   node scenarios/harness/runs.mjs <scenario> list                 # every run + liveness (newest first)
 *   node scenarios/harness/runs.mjs <scenario> path <n>             # print a run's dir
 *   node scenarios/harness/runs.mjs <scenario> logs <n> [--tail N]  # tail its sessions.log
 *   node scenarios/harness/runs.mjs <scenario> down <n>|--all       # kill a run's server (or all of them)
 *   node scenarios/harness/runs.mjs <scenario> gc [--keep N]        # delete all but the newest N run dirs
 */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENARIOS_DIR } from './lib/paths.mjs';
import { listRuns, stopRun } from './lib/local.mjs';

const [scenarioId, cmd = 'list', ...rest] = process.argv.slice(2);
if (!scenarioId) {
  console.error('usage: runs.mjs <scenario> list|path <n>|logs <n>|down <n>|--all|gc [--keep N]');
  process.exit(1);
}
const scenarioDir = resolve(SCENARIOS_DIR, scenarioId);
const numFlag = (name, def) => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : def;
};
const runs = listRuns(scenarioDir);
const find = (n) => runs.find((r) => r.runId === Number(n));

switch (cmd) {
  case 'list':
    if (runs.length === 0) console.log(`(no runs under ${join(scenarioDir, 'runs')})`);
    for (const r of runs) {
      console.log(`run ${r.runId}\t${r.alive ? 'ALIVE' : 'dead '}\tport ${r.port ?? '?'}\tsteps ${r.completedSteps ?? 0}/${r.stepCount ?? '?'}\t${r.dir}`);
    }
    break;
  case 'path': {
    const r = find(rest[0]);
    if (!r) { console.error(`no run ${rest[0]}`); process.exit(1); }
    console.log(r.dir);
    break;
  }
  case 'logs': {
    const r = find(rest[0]);
    if (!r) { console.error(`no run ${rest[0]}`); process.exit(1); }
    execSync(`tail -n ${numFlag('--tail', 200)} ${JSON.stringify(join(r.dir, 'sessions.log'))}`, { stdio: 'inherit' });
    break;
  }
  case 'down': {
    const targets = rest.includes('--all') ? runs : [find(rest[0])].filter(Boolean);
    if (targets.length === 0) { console.error('nothing to stop (pass a run number or --all)'); process.exit(1); }
    for (const r of targets) { stopRun(r); console.log(`stopped run ${r.runId}`); }
    break;
  }
  case 'gc': {
    const keep = numFlag('--keep', 3);
    const doomed = runs.slice(keep); // runs is newest-first
    for (const r of doomed) {
      stopRun(r);
      rmSync(r.dir, { recursive: true, force: true });
      console.log(`removed run ${r.runId}`);
    }
    if (doomed.length === 0) console.log(`nothing to gc (kept newest ${keep})`);
    break;
  }
  default:
    console.error(`usage: runs.mjs <scenario> list|path <n>|logs <n>|down <n>|--all|gc [--keep N]`);
    process.exit(1);
}
