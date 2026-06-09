/**
 * Live-LLM end-to-end suite — drives the BUILT CLI against fixture / system
 * spaces with the REAL model (Azure DeepSeek-V4-Pro from .env) and asserts on the
 * --trace NDJSON. This is the counterpart to keyless-cli.test.ts: the mock can
 * only replay canned TypeScript, so it cannot validate real model behavior —
 * whether the model writes valid solve specs, follows the readFile().raw
 * direction, retains scope across tasklist tasks, recovers from a fed-back
 * error, or honors per-role model routing.
 *
 * Gated on LM_LIVE=1 AND a built dist binary, so a normal `pnpm test` skips it.
 *   pnpm build && LM_LIVE=1 pnpm vitest run packages/cli/src/testing/live-llm.test.ts
 *
 * Output streams live (see live-harness.runCli). Assertions split into HARD
 * (host-generated, model-independent) and SOFT (model-dependent — recorded +
 * loosely asserted so model nondeterminism doesn't cause false failures). Every
 * scenario saves its trace under packages/cli/.live-traces/<scenario>.jsonl.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runCli,
  runSessionLive,
  hasBin,
  REPO_ROOT,
  TRACE_DIR,
  solveResult,
  forkRequests,
  sessionRequests,
  reqText,
  yieldResolved,
  allYieldResolved,
  ofType,
  emittedCode,
  loadRepoEnv,
} from './live-harness.js';
import type { TraceEvent } from '@repl/core';

const LIVE = !!process.env['LM_LIVE'];

// Spaces (committed system-space paths for reliability). The solver is now a
// system space; solve() resolves its relative candidate path against the space
// dir (host-tools inSpace()), the same root verifyCommand runs in, so this works
// from the repo root with no cwd workaround.
const ENGINEER = 'packages/core/system-spaces/engineer';
const ARCHITECT_SRC = resolve(REPO_ROOT, 'packages/core/system-spaces/architect');
const SOLVER_DIR = resolve(REPO_ROOT, 'packages/core/system-spaces/solver');
const SOMMELIER = 'fixtures/sommelier';
const SAUCE = 'fixtures/sauce_master';

// All scenarios run on the default model (M = DeepSeek-V4-Pro). The per-role
// model test routes explore forks to an explicit Pro spec to prove the config is
// threaded to the trace without introducing a second model family.
const ROLE_MODEL_SPEC = 'azure:DeepSeek-V4-Pro';

const SOLVER_WORK = join(SOLVER_DIR, 'work');
const cleanSolverWork = () => rmSync(SOLVER_WORK, { recursive: true, force: true });

// Pin the exact solve() signature. DeepSeek-V4-Pro otherwise tends to hallucinate
// a callback API (`solve({ attempt: async () => ... })`), which fails typecheck and
// never produces a solve yield. solve() takes an `instruction` STRING.
const solveMsg = (task: string): string =>
  `${task} Use the solve() built-in EXACTLY as your instructions describe. solve takes an ` +
  '`instruction` STRING — it does NOT take an `attempt`, `run`, or any callback function. ' +
  'Call it precisely like this (one statement), then display the result:\n' +
  'const r = await solve({ instruction: "<describe the function fully; the attempt must writeFile(\\"work/candidate.ts\\", source)>", ' +
  "output: { summary: 'string' }, role: 'general', verifyCommand: 'npx tsc --noEmit --strict work/candidate.ts' });\n" +
  'Do NOT write the function inline yourself — drive it entirely through solve().';

const tmpDirs: string[] = [];
const mkTmp = (slug: string): string => {
  const d = mkdtempSync(join(tmpdir(), `lmthing-live-${slug}-`));
  tmpDirs.push(d);
  return d;
};

// ── Result ledger for the end-of-run summary ────────────────────────────────
interface Row { scenario: string; signal: string; }
const ledger: Row[] = [];
const record = (scenario: string, signal: string) => {
  ledger.push({ scenario, signal });
  process.stdout.write(`  ✦ [${scenario}] ${signal}\n`);
};

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  if (!ledger.length) return;
  const w = Math.max(...ledger.map((r) => r.scenario.length));
  process.stdout.write('\n──────── live-llm summary ────────\n');
  for (const r of ledger) process.stdout.write(`  ${r.scenario.padEnd(w)}  ${r.signal}\n`);
  process.stdout.write('──────────────────────────────────\n');
});

// ── Trace helpers local to this suite ───────────────────────────────────────
const evalErrors = (trace: TraceEvent[]) => ofType(trace, 'eval_error');

const TIMEOUT = 180_000;
const ARCH_TIMEOUT = 600_000;

// Shared across L15 → L16.
let synthesizedSpaceKey: string | undefined;

describe.skipIf(!hasBin() || !LIVE)('live-llm suite (real models)', () => {
  // Load repo .env into this process so runCli passes the provider keys + model
  // aliases through to subprocesses even when cwd is not the repo root (the
  // subprocess CLI only loads .env from its own cwd).
  beforeAll(() => loadRepoEnv());

  // ── Tier 1: behavioral / instruction-level ────────────────────────────────

  it('L1 query/context scope retention through a tasklist', async () => {
    const dish = 'coq au vin with wild mushrooms';
    const r = await runCli({
      scenario: 'L1-scope-retention',
      space: SOMMELIER,
      agent: 'pairing',
      message: `Suggest a wine pairing for ${dish}. Do not ask any questions.`,
      stdin: dish,
    });
    const forks = forkRequests(r.trace);
    // suggest_wine is a 2-task DAG (analyze_dish → select_wine); both run as forks.
    record('L1-scope-retention', `${forks.length} task forks; query-in-last=${forks.length ? /coq au vin/i.test(reqText(forks[forks.length - 1]!)) : 'n/a'}`);
    expect(forks.length).toBeGreaterThanOrEqual(2);
    // HARD: the final (goal) task must still see the original query — not just upstream output.
    expect(/coq au vin/i.test(reqText(forks[forks.length - 1]!))).toBe(true);
  }, TIMEOUT);

  it('L2 fork-role uses readFile().raw for regex (soft)', async () => {
    const dir = mkTmp('raw');
    const file = join(dir, 'sample.ts');
    writeFileSync(file, '^startCaret line one\nfunction foo() {}\n^another caret\nconst x = 1;\n');
    const r = await runCli({
      scenario: 'L2-readfile-raw',
      space: ENGINEER,
      agent: 'engineer',
      message: `Read the file ${file} and find every line that starts with a caret character (regex /^\\^/). Use the raw file content (readFile(path).raw) so line-number prefixes don't break the ^ anchor. Report the matching lines. Do not ask any questions.`,
      stdin: `Find lines starting with ^ in ${file}`,
    });
    const usedRaw = /\.raw\b/.test(emittedCode(r.trace));
    record('L2-readfile-raw', usedRaw ? 'model used readFile().raw' : 'did NOT use .raw (review trace)');
    expect(r.trace.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('L3 delegate to a tasklist-backed action auto-captures (soft)', async () => {
    // cooking chef delegates to sommelier suggest_pairing (tasklist-backed).
    const r = await runCli({
      scenario: 'L3-delegate-autocapture',
      space: 'fixtures/cooking',
      agent: 'chef',
      message: 'Cook cacio e pepe, then suggest a wine pairing for it by delegating to the sommelier. Do not ask any questions.',
      stdin: 'cacio e pepe',
    });
    const delegated = allYieldResolved(r.trace, 'delegate');
    const nonNull = delegated.filter((v) => v != null);
    record('L3-delegate-autocapture', delegated.length ? `${nonNull.length}/${delegated.length} delegate results non-null` : 'no delegate happened (review trace)');
    expect(r.trace.length).toBeGreaterThan(0);
    // HARD when a delegate did run: its result must be captured (non-null), proving auto-capture.
    if (delegated.length) expect(nonNull.length).toBe(delegated.length);
  }, TIMEOUT);

  // ── Tier 2: solve ladder & budget ─────────────────────────────────────────

  it('L4 solve happy path writes a verified candidate', async () => {
    cleanSolverWork();
    const r = await runCli({
      scenario: 'L4-solve-happy',
      space: SOLVER_DIR,
      message: solveMsg('Implement a function `add(a: number, b: number): number` that returns their sum.'),
      timeoutMs: ARCH_TIMEOUT,
    });
    const solve = solveResult(r.trace);
    const candidateExists = existsSync(join(SOLVER_WORK, 'candidate.ts'));
    record('L4-solve-happy', solve ? `verified=${solve.verified} rung=${solve.rung} attempts=${solve.attempts} candidate=${candidateExists}` : 'no solve result (review trace)');
    expect(solve).toBeDefined();
    // HARD: the ladder converged on a verified solution and wrote the file.
    expect(solve!.verified).toBe(true);
    expect(solve!.attempts).toBeGreaterThanOrEqual(1);
    expect(candidateExists).toBe(true);
  }, ARCH_TIMEOUT);

  it('L5 solve carries verifier feedback on retry (soft/conditional)', async () => {
    cleanSolverWork();
    const r = await runCli({
      scenario: 'L5-solve-retry',
      space: SOLVER_DIR,
      message: solveMsg('Implement `titleCase(s: string): string` that upper-cases the first letter of each whitespace-separated word and lower-cases the rest.'),
      timeoutMs: ARCH_TIMEOUT,
    });
    const solve = solveResult(r.trace);
    const feedbackCarried = forkRequests(r.trace).some((e) => reqText(e).includes('Feedback from the previous attempt'));
    record('L5-solve-retry', solve ? `attempts=${solve.attempts} rung=${solve.rung} feedbackCarried=${feedbackCarried}` : 'no solve result');
    expect(solve).toBeDefined();
    // HARD only when escalation actually happened: a retry must carry feedback.
    if (solve!.attempts > 1) expect(feedbackCarried).toBe(true);
  }, ARCH_TIMEOUT);

  it('L6 solve verifier truly gates (verified ⟹ candidate independently typechecks)', async () => {
    cleanSolverWork();
    const r = await runCli({
      scenario: 'L6-verifier-gates',
      space: SOLVER_DIR,
      message: solveMsg('Implement `clamp(x: number, lo: number, hi: number): number` returning x bounded to [lo, hi].'),
      timeoutMs: ARCH_TIMEOUT,
    });
    const solve = solveResult(r.trace);
    let independentlyTypechecks: boolean | 'n/a' = 'n/a';
    if (solve?.verified && existsSync(join(SOLVER_WORK, 'candidate.ts'))) {
      try {
        execFileSync('npx', ['tsc', '--noEmit', '--strict', 'work/candidate.ts'], {
          cwd: SOLVER_DIR,
          stdio: 'pipe',
        });
        independentlyTypechecks = true;
      } catch {
        independentlyTypechecks = false;
      }
    }
    record('L6-verifier-gates', `verified=${solve?.verified} independentTsc=${independentlyTypechecks}`);
    expect(solve).toBeDefined();
    // HARD: the verifier cannot be reward-hacked — a verified=true result must
    // really pass tsc when we run it ourselves.
    if (solve!.verified) expect(independentlyTypechecks).toBe(true);
  }, ARCH_TIMEOUT);

  it('L7 progress() is invoked and reports counters (soft on format)', async () => {
    const r = await runCli({
      scenario: 'L7-progress',
      space: ENGINEER,
      agent: 'engineer',
      message: 'There is a built-in global function `progress()` (takes no arguments, returns { episodes, toolCalls, elapsedMs }). Call it directly as `const p = progress();` — it is NOT a delegate target or a tool. Then display(p). Do not ask any questions.',
      stdin: 'report progress counters',
    });
    const called = /progress\s*\(/.test(emittedCode(r.trace));
    const hasNumbers = /episodes|toolCalls|elapsedMs/i.test(r.stdout);
    record('L7-progress', `progress()-called=${called} counters-in-output=${hasNumbers}`);
    // HARD: the model actually called the global.
    expect(called).toBe(true);
  }, TIMEOUT);

  it('L8 budget episode cap fires cleanly', async () => {
    const r = await runCli({
      scenario: 'L8-episode-cap',
      // The solver reliably yields once (solve()) on turn 1, then continues to
      // display the result on turn 2. With maxEpisodes=1, the episode tick at the
      // start of turn 2 (episodes=2 > 1) trips the cap deterministically — no
      // dependence on the model choosing to loop.
      space: SOLVER_DIR,
      message: solveMsg('Implement a function `add(a: number, b: number): number` returning a + b.'),
      budget: { maxEpisodes: 1 },
      stdin: 'implement add via solve',
    });
    record('L8-episode-cap', `exit=${r.code} sessionReqs=${sessionRequests(r.trace).length} stderrHit=${r.stderr.includes('episodes limit of 1')}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('episodes limit of 1');
    expect(sessionRequests(r.trace).length).toBe(1);
  }, TIMEOUT);

  it('L9 budget tool-call cap fires cleanly', async () => {
    const r = await runCli({
      scenario: 'L9-toolcall-cap',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Emit EXACTLY this one statement and nothing else: `await Promise.all([sleep(1), sleep(1), sleep(1)]);`. Do not ask any questions. (Each sleep is a value-yielding call; resolving three at once accumulates tool calls.)',
      budget: { maxToolCalls: 2 },
      stdin: 'sleep three times',
    });
    record('L9-toolcall-cap', `exit=${r.code} stderrHit=${r.stderr.includes('toolCalls limit of 2')}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('toolCalls limit of 2');
  }, TIMEOUT);

  it('L10 fork-depth cap bounds the solve ladder (cheap rejection)', async () => {
    cleanSolverWork();
    const r = await runCli({
      scenario: 'L10-forkdepth-cap',
      space: SOLVER_DIR,
      message: solveMsg('Implement a function `add(a: number, b: number): number`.'),
      budget: { maxForkDepth: 0 },
    });
    record('L10-forkdepth-cap', `exit=${r.code} forkReqs=${forkRequests(r.trace).length} stderrHit=${r.stderr.includes('forkDepth limit of 0')}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('forkDepth limit of 0');
    expect(forkRequests(r.trace).length).toBe(0);
  }, TIMEOUT);

  it('L11 wall-clock cap fires', async () => {
    const r = await runCli({
      scenario: 'L11-wallclock-cap',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Count upward from 1, calling await sleep(1) then display each number every turn. Never stop. Do not ask any questions.',
      budget: { maxWallClockMs: 1 },
      stdin: 'count upward forever',
    });
    record('L11-wallclock-cap', `exit=${r.code} stderrHit=${r.stderr.includes('wallClock')}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('wallClock');
  }, TIMEOUT);

  // ── Tier 3: error feedback ────────────────────────────────────────────────

  it('L12 top-level-await rejection surfaces and the model recovers (soft)', async () => {
    const r = await runCli({
      scenario: 'L12-await-recovery',
      space: ENGINEER,
      agent: 'engineer',
      // Use Promise.reject (not a missing global): a missing global is caught by
      // TYPECHECK before eval, whereas this typechecks fine and rejects at runtime —
      // exercising the eval-time top-level-await rejection path the runtime surfaces.
      message: 'I am deliberately testing the runtime\'s error handling. On your FIRST turn, emit exactly this one statement and nothing else: `const x = await Promise.reject(new Error("intentional test failure"));`. I know it rejects — that is the point. After the runtime reports the error back to you, tell me what the error was and then finish. Do not ask any questions.',
      stdin: 'reject a promise',
    });
    const errs = evalErrors(r.trace);
    record('L12-await-recovery', `evalErrors=${errs.length} exit=${r.code}`);
    // HARD: the runtime surfaced the rejection rather than silently continuing.
    expect(errs.length).toBeGreaterThan(0);
    // SOFT: and the run still reached a clean end (the error was fed back, not fatal).
    expect(r.code).toBe(0);
  }, TIMEOUT);

  it('L13 process.exit() stops cleanly without a retry storm', async () => {
    const r = await runCli({
      scenario: 'L13-process-exit',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Immediately call process.exit(0). Do nothing else first. Do not ask any questions.',
      stdin: 'exit now',
    });
    const sawMarker = /\[process\.exit\] intentional termination/.test(r.stdout);
    record('L13-process-exit', `marker=${sawMarker} exit=${r.code} sessionReqs=${sessionRequests(r.trace).length}`);
    // HARD: detected as intentional termination, clean exit, no retry storm.
    expect(sawMarker).toBe(true);
    expect(r.code).toBe(0);
    expect(sessionRequests(r.trace).length).toBeLessThanOrEqual(3);
  }, TIMEOUT);

  // ── Tier 4: multi-agent / system spaces ───────────────────────────────────

  it('L14 engineer system space runs file ops end-to-end (soft)', async () => {
    const dir = mkTmp('eng');
    const target = join(dir, 'hello.txt');
    const r = await runCli({
      scenario: 'L14-engineer-e2e',
      space: ENGINEER,
      agent: 'engineer',
      message: `Create a file at ${target} containing exactly the text "hi there", then read it back and confirm its contents. Do not ask any questions.`,
      stdin: `write "hi there" to ${target}`,
    });
    const created = existsSync(target);
    const wrote = /writeFile\s*\(/.test(emittedCode(r.trace));
    record('L14-engineer-e2e', `fileCreated=${created} writeFileStmt=${wrote} exit=${r.code}`);
    expect(r.trace.length).toBeGreaterThan(0);
    // SOFT: prefer the file to actually exist, but a writeFile statement also proves the path ran.
    expect(created || wrote).toBe(true);
  }, TIMEOUT);

  it('L15 architect synthesize_and_run scaffolds, registers, and runs a new space', async () => {
    // Copy the architect into a temp dir so scaffolded spaces land in temp (the
    // architect derives its output base from LMTHING_SPACE_DIR's parent) — never
    // polluting the repo.
    const base = mkTmp('arch');
    const archDir = join(base, 'architect');
    cpSync(ARCHITECT_SRC, archDir, { recursive: true });
    const r = await runCli({
      scenario: 'L15-architect-synth',
      space: archDir,
      agent: 'architect',
      message: 'Run your full synthesize_and_run pipeline by calling, as your FIRST statement, `await tasklist(\'synthesize_and_run\', { goal: "an agent that recommends a board game given a group size and desired play time", constraints: ["keep research brief", "after building it, run it for a group of 4 wanting a 60-minute game and show the recommendation"] });`. Do NOT perform the steps inline yourself — the tasklist orchestrates research→design→scaffold→validate→register→execute→report. Do not ask any questions.',
      timeoutMs: ARCH_TIMEOUT,
      stdin: 'board game recommender for group size and play time',
    });
    const ranTasklist = ofType(r.trace, 'yield').some((e) => e.kind === 'tasklist');
    const reg = yieldResolved(r.trace, 'registerSpace') as { ok?: boolean; spaceKey?: string } | undefined;
    const registeredInFork = r.trace.some((e) => e.type === 'yield_resolved' && e.kind === 'registerSpace' && e.context.startsWith('fork'));
    const delegated = allYieldResolved(r.trace, 'delegate').filter((v) => v != null);
    const fullyCompleted = reg?.ok === true && delegated.length >= 1;
    record('L15-architect-synth', `ranTasklist=${ranTasklist} register.ok=${reg?.ok} inFork=${registeredInFork} delegates=${delegated.length} fullE2E=${fullyCompleted} exit=${r.code}`);
    // BEST-EFFORT probe. The architect's end-to-end synthesis is genuinely
    // model-dependent (DeepSeek-V4-Pro sometimes drives its synthesize_and_run
    // tasklist, sometimes improvises the steps inline; the full
    // research→scaffold→validate→register→execute→report pipeline does not reliably
    // complete in one shot). So the only hard assertion is that the run executed and
    // produced trace; how far it got (tasklist / registerSpace / delegate) is recorded
    // above for inspection. The orchestration primitives themselves —
    // tasklist/registerSpace/delegate and the shared-dynamicSpaces reach (L17) — are
    // covered deterministically by the keyless harness-features tests.
    expect(r.trace.length).toBeGreaterThan(0);
    if (fullyCompleted) {
      synthesizedSpaceKey = reg!.spaceKey; // enable L16 only on a clean full run
    }
  }, ARCH_TIMEOUT);

  it('L16 architect iterate_space revalidates and re-runs the synthesized space', async () => {
    if (!synthesizedSpaceKey) {
      record('L16-architect-iterate', 'skipped — L15 produced no spaceKey');
      return;
    }
    const base = mkTmp('arch2');
    const archDir = join(base, 'architect');
    cpSync(ARCHITECT_SRC, archDir, { recursive: true });
    const r = await runCli({
      scenario: 'L16-architect-iterate',
      space: archDir,
      agent: 'architect',
      message: `Improve the existing space at "${synthesizedSpaceKey}": add a short rationale to each recommendation, then re-run it for a group of 2 wanting a 30-minute game. Do not ask any questions.`,
      timeoutMs: ARCH_TIMEOUT,
      stdin: 'add rationale and re-run',
    });
    const redelegated = allYieldResolved(r.trace, 'delegate').filter((v) => v != null);
    record('L16-architect-iterate', `delegates=${redelegated.length} exit=${r.code}`);
    expect(r.trace.length).toBeGreaterThan(0);
  }, ARCH_TIMEOUT);

  it('L18 loadKnowledge binds parsed content, not a path string', async () => {
    const r = await runCli({
      scenario: 'L18-loadknowledge',
      space: SAUCE,
      agent: 'sauce_master',
      message: 'Recommend a classic sauce technique for a French coq au vin. The cuisine is French. Do not ask any questions.',
      stdin: 'French coq au vin',
    });
    const k = yieldResolved(r.trace, 'loadKnowledge');
    // loadKnowledgeFile returns { frontmatter, body } when the file has frontmatter,
    // otherwise the raw body string. The bug this guards against bound the PATH
    // string instead of the content — so the check is "content, not path".
    const looksLikePath = typeof k === 'string' && /^[\w./-]+\.md$/.test(k);
    const isContent = k != null && (
      (typeof k === 'object' && ('body' in (k as object) || 'frontmatter' in (k as object))) ||
      (typeof k === 'string' && k.length > 50 && !looksLikePath)
    );
    record('L18-loadknowledge', `resolved=${k == null ? 'none' : typeof k} looksLikePath=${looksLikePath} isContent=${isContent}`);
    // HARD: loadKnowledge must bind the parsed file content, not the relative path string.
    expect(looksLikePath).toBe(false);
    expect(isContent).toBe(true);
  }, TIMEOUT);

  it('L19 per-role model routing tags explore forks with the role model', async () => {
    const dir = mkTmp('role');
    writeFileSync(join(dir, 'a.txt'), 'alpha\nbeta\n');
    writeFileSync(join(dir, 'b.txt'), 'gamma\ndelta\n');
    const r = await runCli({
      scenario: 'L19-per-role-model',
      space: ENGINEER,
      agent: 'engineer',
      message: `Investigate the directory ${dir}: spawn explore subagents in parallel (fork with role 'explore') to summarize each of a.txt and b.txt, then report. Do not ask any questions.`,
      env: { LM_MODEL_ROLE_EXPLORE: ROLE_MODEL_SPEC },
      stdin: `summarize files in ${dir}`,
    });
    const forks = forkRequests(r.trace);
    const roleTagged = forks.filter((e) => e.model === ROLE_MODEL_SPEC);
    const sessionUntagged = sessionRequests(r.trace).every((e) => e.model === undefined);
    record('L19-per-role-model', `forks=${forks.length} flashTagged=${roleTagged.length} sessionUntagged=${sessionUntagged}`);
    // HARD: session requests carry no override; explore forks (if any) carry the role model.
    expect(sessionUntagged).toBe(true);
    if (forks.length) {
      expect(roleTagged.length).toBeGreaterThan(0);
    } else {
      record('L19-per-role-model', 'no forks spawned — role routing not exercised (review)');
    }
  }, TIMEOUT);

  // ── Tier 5: tool-output quality (soft) ────────────────────────────────────

  it('L20 webFetch returns readable text (soft)', async () => {
    const r = await runCli({
      scenario: 'L20-webfetch-text',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Use webFetch to fetch https://example.com and tell me the main heading text on the page. Do not ask any questions.',
      stdin: 'fetch example.com',
    });
    const gotText = /example domain/i.test(r.stdout);
    record('L20-webfetch-text', gotText ? 'extracted "Example Domain"' : 'heading not found in output (review trace)');
    expect(r.trace.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('L21 execShell surfaces a non-zero exitCode (soft)', async () => {
    const r = await runCli({
      scenario: 'L21-execshell-exitcode',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Use execShell to run a command that exits with status 3 (for example: `exit 3`). Report the exact exitCode value the tool returned. Do not ask any questions.',
      stdin: 'run a command exiting 3',
    });
    const saw3 = /\b3\b/.test(r.stdout) && /exit/i.test(r.stdout);
    record('L21-execshell-exitcode', saw3 ? 'reported exitCode 3' : 'did not clearly report 3 (review trace)');
    expect(r.trace.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('L22 grep distinguishes path-not-found (soft)', async () => {
    const r = await runCli({
      scenario: 'L22-grep-not-found',
      space: ENGINEER,
      agent: 'engineer',
      message: 'Use grep to search for the word "TODO" in the path /no/such/path/xyz123 and tell me exactly what the tool returned, including any error message. Do not ask any questions.',
      stdin: 'grep a missing path',
    });
    const sawError = /path not found/i.test(r.stdout);
    record('L22-grep-not-found', sawError ? 'surfaced "path not found"' : 'error text not in output (review trace)');
    expect(r.trace.length).toBeGreaterThan(0);
  }, TIMEOUT);

  // ── Tier 4 (cont): history summarization (direct Session, needs SessionOpts) ─

  it('L23 history summarization collapses old turns', async () => {
    const dir = mkTmp('summ');
    const instruct = join(dir, 'agents', 'default', 'instruct.md');
    mkdirSync(join(dir, 'agents', 'default'), { recursive: true });
    writeFileSync(instruct, 'You are a terse assistant. Reply in one short sentence using display(). Do not ask questions.\n');
    const traceFile = join(TRACE_DIR, 'L23-summarization.jsonl');
    rmSync(traceFile, { force: true });
    mkdirSync(TRACE_DIR, { recursive: true });

    const res = await runSessionLive({
      spaceDir: dir,
      message: 'Remember the secret word is "marmalade". Acknowledge.',
      continueWith: [
        'What is 2 + 2?',
        'Name a color.',
        'Name an animal.',
        'Name a fruit.',
        'What was the secret word I told you?',
      ],
      traceFile,
      sessionOpts: { maxHistoryTurns: 2 },
    });
    const summarized = sessionRequests(res.trace).some((e) => e.messages.some((m) => m.content.startsWith('[CONTEXT SUMMARY]')));
    record('L23-summarization', `summaryMarkerSeen=${summarized} turns=${sessionRequests(res.trace).length} err=${res.error?.message ?? 'none'}`);
    // HARD: once history exceeds maxHistoryTurns*2, a later request opens with the summary.
    expect(summarized).toBe(true);
  }, ARCH_TIMEOUT);
});
