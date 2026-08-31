#!/usr/bin/env node
/**
 * Parallel, fresh live-project build harness.
 *
 * Each lane owns a throwaway `lmthing serve` process, project directory, session, log, and
 * provider/model slot.  This lives beside run-scenario.mjs because it uses the same local-server
 * protocol and evidence layout; it is intentionally not a devops deployment script.
 *
 * Run a real batch (do not do this while system-space prompts are being edited):
 *   node scenarios/parallel-build.mjs --parallel 4
 * Validate only (no server, project, session, or model request):
 *   node scenarios/parallel-build.mjs --dry-run
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Pod } from './harness/lib/pod.mjs';
import { ThingSession } from './harness/lib/thing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = resolve(HERE, '..');
const ROOT = join(HERE, 'parallel-build');
const RUNS = join(ROOT, 'runs');
const ENV_FILE = join(ORG, '.env');
// These are lmthing provider specs, not pi provider names. They are the distinct deployments
// configured in sdk/org/.env; resolve.ts supports `azure:modelId` (chat-completions) only.
const SLOTS = Object.freeze([
  { id: 'azure-deepseek-flash', model: 'azure:DeepSeek-V4-Flash-0731' },
  { id: 'azure-deepseek-pro', model: 'azure:DeepSeek-V4-Pro' },
]);
// All configured models are deployments on one Azure resource. Separate deployment names do not
// prove separate quota, so do not unleash the whole table concurrently on full app builds.
const MAX_PARALLEL = 2;
const DEFAULT_IDEAS = Object.freeze([
  'Recipe box: build a list and detail app for recipes with ingredients and prep time. Include add, edit, and delete forms for every entity.',
  'Gym workout log: build an app for numeric workout series, per-exercise statistics, and a summary view. Include add, edit, and delete forms for every entity.',
  'Plant care tracker: build an app that tracks care dates and recurring watering schedules. Include add, edit, and delete forms for every entity.',
  'Expense splitter: build an app with related people and expenses tables and computed balances. Include add, edit, and delete forms for every entity.',
]);

function usage() {
  console.log('usage: node scenarios/parallel-build.mjs [--parallel N] [--ideas file] [--dry-run]');
}
function parseArgs(argv) {
  const out = { parallel: MAX_PARALLEL, ideas: DEFAULT_IDEAS, dryRun: false, preflightOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--parallel') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error('--parallel requires a positive integer');
      out.parallel = n;
    } else if (a === '--ideas') {
      const path = argv[++i];
      if (!path) throw new Error('--ideas requires a UTF-8 file with one idea per non-empty line');
      out.ideas = readFileSync(resolve(path), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!out.ideas.length) throw new Error('--ideas file contains no ideas');
    } else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--preflight-only') out.preflightOnly = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** A slot allocator never emits the same slot twice; excess jobs remain queued. */
export function allocateSlots(jobs, parallel, slots = SLOTS) {
  if (!Number.isInteger(parallel) || parallel < 1) throw new Error('parallel must be a positive integer');
  const width = Math.min(parallel, slots.length, MAX_PARALLEL);
  const waves = [];
  for (let at = 0; at < jobs.length; at += width) {
    // Rotate across waves so a four-idea default batch exercises all three deployments while
    // retaining uniqueness within a concurrent wave.
    waves.push(jobs.slice(at, at + width).map((job, i) => ({ job, slot: slots[(at + i) % slots.length] })));
  }
  return waves;
}

/** Count physical `[error]` records and group their message text, most frequent first. */
export function errorCensus(text) {
  const counts = new Map();
  for (const match of text.matchAll(/^.*?\[error\]\s*(.*?)\s*$/gm)) {
    const message = match[1].trim() || '(empty error message)';
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}
function censusText(census) { return census.map(({ count, message }) => `${count}  ${message}`).join('\n'); }
function errorLineCount(text) { return errorCensus(text).reduce((n, x) => n + x.count, 0); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function port() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolvePort(p));
    });
  });
}
function nextIntegerDir(base) {
  mkdirSync(base, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = join(base, String(n));
    try { mkdirSync(dir); return { id: n, dir }; } catch (e) { if (e?.code !== 'EEXIST') throw e; }
  }
}
function updateLatest(id) {
  const latest = join(RUNS, 'latest');
  try { rmSync(latest, { force: true }); symlinkSync(String(id), latest, 'dir'); }
  catch { writeFileSync(`${latest}.txt`, String(id)); }
}
function pidsOnPort(p) {
  try { return [...execSync(`ss -ltnpH 'sport = :${p}'`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])); }
  catch { return []; }
}
function stop(run) {
  if (run.child?.pid) { try { process.kill(-run.child.pid, 'SIGKILL'); } catch { try { process.kill(run.child.pid, 'SIGKILL'); } catch {} } }
  for (const pid of pidsOnPort(run.port)) try { process.kill(pid, 'SIGKILL'); } catch {}
}
async function waitUp(base) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1500) })).status) return; } catch {}
    await sleep(1000);
  }
  throw new Error(`server never listened at ${base}`);
}
function startServer(run) {
  mkdirSync(run.dataDir, { recursive: true });
  const fd = openSync(run.logFile, 'a');
  run.child = spawn('pnpm', ['lmthing', 'serve', '--cwd', run.dataDir, '--port', String(run.port), '--env-file', ENV_FILE, '--adopt-system-spaces', '--max-sessions', '24', '--model', run.slot.model], {
    cwd: ORG, detached: true,
    env: { ...process.env, LM_STORE_APPS_DIR: join(run.dataDir, 'store-apps') }, stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  run.child.unref();
}
function invokedRepair(turn) { return JSON.stringify(turn?.events ?? []).includes('repair_live_project'); }
function voided(log, turnError) {
  // The scenario runner's explicit marker is authoritative. Provider saturation/outage is also
  // treated as VOID, never as an application result, if a local runner reports it this way.
  return /🚫\s*VOID\b|\bVOID\s*[—-]\s*this run is NOT a result/i.test(log) || /provider unreachable|429\s*\{?"?code"?\s*:\s*"?1302/i.test(`${log}\n${turnError ?? ''}`);
}
function prompt(idea) {
  return `Create a completely new live project for this app idea: ${idea}\nUse the fresh-app build path (build_live_project) exactly once. Do not repair an existing project; this project is empty.`;
}
/**
 * Resolve a spec the only authoritative way available to this lazy resolver: start its own server,
 * create a new session, and finish one real model turn. A parsed CLI flag is not validation.
 */
async function preflightSlot(slot) {
  const dir = mkdtempSync(join(tmpdir(), 'parallel-build-preflight-'));
  const run = { dataDir: join(dir, 'data'), logFile: join(dir, 'sessions.log'), port: await port(), slot };
  run.base = `http://localhost:${run.port}`;
  let turn, error = null;
  try {
    startServer(run);
    await waitUp(run.base);
    const thing = new ThingSession(new Pod({ base: run.base }), { projectId: 'user' });
    await thing.start(); // deliberately no resumeSessionId
    turn = await thing.send('Reply with exactly OK.');
    if (!turn?.lastText?.trim()) throw new Error('model turn completed without a display response');
  } catch (e) {
    error = String(e?.stack ?? e);
  } finally {
    stop(run);
  }
  const log = existsSync(run.logFile) ? readFileSync(run.logFile, 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { slot: slot.id, model: slot.model, ok: !error, completion: turn?.lastText?.trim() ?? '', error, log };
}
async function preflightSlots() {
  // Serial on purpose: this proves each configured deployment without itself creating an Azure
  // concurrency/saturation experiment before the actual batch starts.
  const results = [];
  for (const slot of SLOTS) {
    const result = await preflightSlot(slot);
    results.push(result);
    if (!result.ok) break;
  }
  for (const r of results) console.log(r.ok
    ? `preflight PASS ${r.slot} (${r.model}): ${JSON.stringify(r.completion)}`
    : `PREFLIGHT-VOID ${r.slot} (${r.model}): ${r.error?.split('\\n')[0] ?? 'unresolvable model'}`);
  return results;
}
async function execute(job, slot) {
  const reserved = nextIntegerDir(RUNS);
  const run = { ...reserved, idea: job.idea, slot, dataDir: join(reserved.dir, 'data'), logFile: join(reserved.dir, 'sessions.log'), port: await port() };
  run.base = `http://localhost:${run.port}`;
  writeFileSync(join(run.dir, 'run.json'), JSON.stringify({ runId: run.id, idea: run.idea, slot: slot.id, model: slot.model, port: run.port, createdAt: new Date().toISOString() }, null, 2));
  updateLatest(run.id);
  let turn, turnError = null;
  try {
    startServer(run); await waitUp(run.base);
    const pod = new Pod({ base: run.base });
    const project = await pod.createProject(`parallel-build-${run.id}`);
    const projectId = project.id ?? project.project?.id ?? `parallel-build-${run.id}`;
    const thing = new ThingSession(pod, { projectId }); // no resumeSessionId: always a new chat
    await thing.start();
    turn = await thing.send(prompt(run.idea));
  } catch (e) { turnError = String(e?.stack ?? e); }
  finally { stop(run); }
  const log = existsSync(run.logFile) ? readFileSync(run.logFile, 'utf8') : '';
  const result = { runId: run.id, idea: run.idea, slot: slot.id, model: slot.model, logFile: run.logFile,
    void: voided(log, turnError), repairInvoked: invokedRepair(turn), errorLines: errorLineCount(log), census: errorCensus(log), turnError,
    pass: false };
  result.pass = !result.void && !result.repairInvoked && !turnError && result.errorLines === 0;
  writeFileSync(join(run.dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
function table(results) {
  console.log('\nrun  slot                    errors  repair  result  idea');
  console.log('---  ----------------------  ------  ------  ------  ----');
  for (const r of results) console.log(`${String(r.runId).padEnd(3)}  ${r.slot.padEnd(22)}  ${String(r.errorLines).padStart(6)}  ${String(r.repairInvoked).padEnd(6)}  ${(r.void ? 'VOID' : r.pass ? 'PASS' : 'FAIL').padEnd(6)}  ${r.idea}`);
  for (const r of results) {
    console.log(`\n[run ${r.runId}] ${r.void ? 'VOID (not a result)' : r.pass ? 'PASS' : 'FAIL'}`);
    if (r.census.length) console.log(censusText(r.census)); else console.log('0  [error] lines');
    if (r.turnError) console.log(`turn error: ${r.turnError.split('\n')[0]}`);
  }
}
async function dryRun(options) {
  const jobs = options.ideas.map((idea, index) => ({ index, idea }));
  const waves = allocateSlots(jobs, options.parallel);
  // Exercise the safety boundary independent of the caller's chosen idea count: five jobs at a
  // requested width above the four-slot fleet must make two waves, and every individual wave must
  // have unique providers. This is the assertion that prevents accidental endpoint oversubscription.
  const allocatorProbe = allocateSlots(Array.from({ length: MAX_PARALLEL + 1 }, (_, index) => ({ index })), SLOTS.length);
  if (allocatorProbe.length !== 2 || allocatorProbe[0].length !== MAX_PARALLEL || allocatorProbe[1].length !== 1) throw new Error('allocator did not queue excess jobs');
  if (allocatorProbe.some((wave) => new Set(wave.map((x) => x.slot.id)).size !== wave.length)) throw new Error('allocator double-booked a provider slot');
  const temp = mkdtempSync(join(tmpdir(), 'parallel-build-')); const created = nextIntegerDir(temp); rmSync(temp, { recursive: true, force: true });
  const realLog = join(ORG, 'scenarios/07-life-admin/runs/26/sessions.log');
  const census = errorCensus(readFileSync(realLog, 'utf8'));
  if (!census.length) throw new Error(`census extractor found no [error] records in ${realLog}`);
  console.log(`argument parsing: PASS (parallel=${options.parallel}, ideas=${jobs.length}, cap=${MAX_PARALLEL})`);
  console.log(`slot allocator: PASS (caller plan ${waves.map((w) => `[${w.map((x) => x.slot.id).join(', ')}]`).join(' → ')}; three-job probe ${allocatorProbe.map((w) => `[${w.map((x) => x.slot.id).join(', ')}]`).join(' → ')}; no duplicate booking; excess queued)`);
  console.log(`run-dir creation: PASS (${created.dir} created atomically then cleaned)`);
  console.log(`census extractor: PASS (${realLog}; ${errorLineCount(readFileSync(realLog, 'utf8'))} [error] lines, ${census.length} distinct messages)`);
  console.log(censusText(census.slice(0, 3)));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) await dryRun(options);
  else {
    const preflight = await preflightSlots();
    // An invalid/unreachable model is a harness VOID, never a product build result. No lane starts.
    if (preflight.length !== SLOTS.length || preflight.some((r) => !r.ok)) {
      console.error('PREFLIGHT-VOID: no build lanes were launched; fix the named model spec and rerun.');
      process.exitCode = 2;
    } else if (!options.preflightOnly) {
      const waves = allocateSlots(options.ideas.map((idea, index) => ({ index, idea })), options.parallel);
      console.log(`parallel-build: ${options.ideas.length} fresh runs in ${waves.length} wave(s); effective parallelism ${Math.min(options.parallel, SLOTS.length, MAX_PARALLEL)}.`);
      const results = [];
      for (const wave of waves) results.push(...await Promise.all(wave.map(({ job, slot }) => execute(job, slot))));
      table(results);
      process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
    }
  }
} catch (e) {
  console.error(`parallel-build: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
