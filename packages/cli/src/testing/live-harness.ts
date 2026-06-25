/**
 * Shared harness for the CLI integration suites:
 *   - keyless-cli.test.ts  (mock provider, deterministic, no API keys)
 *   - live-llm.test.ts     (real models, gated on LM_LIVE)
 *
 * Both drive the BUILT CLI as a subprocess with --trace and assert on the NDJSON
 * trace. Subprocess output is STREAMED to the parent terminal in real time (and
 * also buffered for assertions) so a human watching the run sees the model's
 * turn-by-turn output live — not swallowed the way the old shell script did with
 * `>/dev/null`.
 *
 * One scenario (history summarization) needs a SessionOpts knob with no CLI flag,
 * so `runSessionLive` drives a core Session in-process with a real streamFn built
 * exactly the way bin.ts does.
 */
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '@lmthing/core';
import type {
  RenderHost,
  SessionOpts,
  StreamOpts,
  StreamSession,
  TraceEvent,
} from '@lmthing/core';
import { resolveAlias } from '../providers/aliases.js';
import { resolveModel } from '../providers/resolve.js';
import { createStream } from '../stream/stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root — packages/cli/src/testing → up 4. The CLI loads .env from cwd and
 *  resolves `--space fixtures/...` relative to cwd, so subprocesses run here. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
/** The built CLI entry. Subprocess suites self-skip when this is absent. */
export const BIN = resolve(__dirname, '..', '..', 'dist', 'cli', 'bin.js');
/** Where per-scenario traces are saved (kept, not tmp) for inspection. */
export const TRACE_DIR = resolve(__dirname, '..', '..', '.live-traces');

export function hasBin(): boolean {
  return existsSync(BIN);
}

/** Load REPO_ROOT/.env into process.env (mirrors bin.ts loadEnv). The subprocess
 *  CLI loads .env itself; the in-process runSessionLive path must too, or model
 *  aliases like `M` won't resolve. Existing env vars win. */
export function loadRepoEnv(): void {
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env */ }
}

export interface RunCliOpts {
  /** Scenario slug — names the saved trace file (<slug>.jsonl). */
  scenario: string;
  space: string;
  message: string;
  agent?: string;
  /** Model alias or spec (--model). Omit to use the CLI default (M). */
  model?: string;
  /** Mock module path (--mock) for keyless runs. */
  mock?: string;
  budget?: {
    maxEpisodes?: number;
    maxToolCalls?: number;
    maxForkDepth?: number;
    maxWallClockMs?: number;
  };
  /** Extra env vars merged over process.env (e.g. LM_MODEL_ROLE_EXPLORE). */
  env?: Record<string, string>;
  /** Working directory for the subprocess (defaults to REPO_ROOT). The CLI loads
   *  .env from here and resolves `--space` relative to it. */
  cwd?: string;
  /** First answer fed to any ask() the agent makes. A flood of trailing newlines
   *  is always appended so repeated asks resolve (to '') instead of hanging — the
   *  plain-mode ask() never resolves on stdin EOF. */
  stdin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  code: number | null;
  /** True if the run was killed by the timeout. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
  trace: TraceEvent[];
  tracePath: string;
}

/** Parse an NDJSON trace file into TraceEvent[]; returns [] if unreadable. */
export async function readTrace(path: string): Promise<TraceEvent[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TraceEvent);
  } catch {
    return [];
  }
}

/**
 * Spawn the built CLI, stream its output live while buffering, and return the
 * exit code, captured stdout/stderr, and the parsed trace.
 */
export function runCli(opts: RunCliOpts): Promise<RunCliResult> {
  if (!hasBin()) {
    throw new Error(`CLI not built: ${BIN} missing — run \`pnpm build\` first`);
  }
  mkdirSync(TRACE_DIR, { recursive: true });
  const tracePath = join(TRACE_DIR, `${opts.scenario}.jsonl`);
  // Fresh trace per run.
  rmSync(tracePath, { force: true });

  const argv: string[] = [
    BIN,
    '--claude',
    '--space',
    opts.space,
    '--trace',
    tracePath,
  ];
  if (opts.agent) argv.push('--agent', opts.agent);
  if (opts.model) argv.push('--model', opts.model);
  if (opts.mock) argv.push('--mock', opts.mock);
  if (opts.budget?.maxEpisodes !== undefined) argv.push('--max-episodes', String(opts.budget.maxEpisodes));
  if (opts.budget?.maxToolCalls !== undefined) argv.push('--max-tool-calls', String(opts.budget.maxToolCalls));
  if (opts.budget?.maxForkDepth !== undefined) argv.push('--max-fork-depth', String(opts.budget.maxForkDepth));
  if (opts.budget?.maxWallClockMs !== undefined) argv.push('--max-wallclock-ms', String(opts.budget.maxWallClockMs));
  argv.push(opts.message);

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const prefix = `    │ `;

  return new Promise<RunCliResult>((resolvePromise) => {
    process.stdout.write(`\n  ▶ [${opts.scenario}] ${opts.model ?? opts.mock ?? 'default'} :: ${opts.space}\n`);
    const child = spawn(process.execPath, argv, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
    });

    // Feed any ask() the agent makes. The plain-mode ask() reads until a newline
    // and never resolves on EOF, so append a flood of newlines: the first answer
    // (if any) goes to the first ask, blank lines satisfy any further asks. Keep
    // stdin open — ending it would not unblock a pending read.
    child.stdin.write((opts.stdin ? opts.stdin + '\n' : '') + '\n'.repeat(40));

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Stream + buffer. Indent each line so the model's output is visually nested
    // under the scenario header.
    const pipe = (chunk: Buffer, sink: NodeJS.WriteStream, append: (s: string) => void) => {
      const s = chunk.toString('utf8');
      append(s);
      sink.write(s.replace(/\n/g, `\n${prefix}`));
    };
    child.stdout.on('data', (c: Buffer) => pipe(c, process.stdout, (s) => { stdout += s; }));
    child.stderr.on('data', (c: Buffer) => pipe(c, process.stderr, (s) => { stderr += s; }));

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    // The bundled @types/node doesn't surface EventEmitter methods on
    // ChildProcessWithoutNullStreams; the child IS an EventEmitter, so cast.
    (child as unknown as EventEmitter).on('close', (code: number | null): void => {
      clearTimeout(killTimer);
      void readTrace(tracePath).then((trace) => {
        process.stdout.write(`\n  ◀ [${opts.scenario}] exit=${code}${timedOut ? ' (TIMED OUT)' : ''}  trace=${trace.length} events → ${tracePath}\n`);
        resolvePromise({ code, timedOut, stdout, stderr, trace, tracePath });
      });
    });
  });
}

// ── Trace query helpers (ported from scripts/live-test.sh) ──────────────────

export type LlmReq = Extract<TraceEvent, { type: 'llm_request' }>;

export const ofType = <T extends TraceEvent['type']>(
  trace: TraceEvent[],
  type: T,
): Array<Extract<TraceEvent, { type: T }>> =>
  trace.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type);

/** All llm_request events, optionally filtered by a context predicate. */
export const llmRequests = (
  trace: TraceEvent[],
  ctxPredicate?: (ctx: string) => boolean,
): LlmReq[] =>
  ofType(trace, 'llm_request').filter((e) => (ctxPredicate ? ctxPredicate(e.context) : true));

export const sessionRequests = (trace: TraceEvent[]): LlmReq[] =>
  llmRequests(trace, (c) => c === 'session');
export const forkRequests = (trace: TraceEvent[]): LlmReq[] =>
  llmRequests(trace, (c) => c.startsWith('fork'));

/** Flatten an llm_request (system + all message contents) into one searchable string. */
export const reqText = (e: LlmReq): string =>
  e.system + '\n' + e.messages.map((m) => m.content).join('\n');

/** Concatenated text the model actually emitted (every llm_response). Useful for
 *  soft checks: the model's code may use an API even when per-statement eval
 *  never executes that line (e.g. a split if/else branch). */
export const responsesText = (trace: TraceEvent[]): string =>
  ofType(trace, 'llm_response').map((e) => e.text).join('\n');

/** All TypeScript the model emitted, whether or not it executed: every traced
 *  statement plus every response. */
export const emittedCode = (trace: TraceEvent[]): string =>
  ofType(trace, 'statement').map((e) => e.code).join('\n') + '\n' + responsesText(trace);

/** The first resolved value for a given yield kind (e.g. 'delegate'). */
export const yieldResolved = (trace: TraceEvent[], kind: string): unknown => {
  const e = trace.find((ev) => ev.type === 'yield_resolved' && ev.kind === kind) as
    | Extract<TraceEvent, { type: 'yield_resolved' }>
    | undefined;
  return e?.value;
};

export const allYieldResolved = (trace: TraceEvent[], kind: string): unknown[] =>
  trace
    .filter((e): e is Extract<TraceEvent, { type: 'yield_resolved' }> => e.type === 'yield_resolved' && e.kind === kind)
    .map((e) => e.value);

export const count = (trace: TraceEvent[], predicate: (e: TraceEvent) => boolean): number =>
  trace.filter(predicate).length;

// ── Direct in-process Session driver (for SessionOpts not exposed as flags) ──

export interface RunSessionLiveOpts {
  spaceDir: string;
  message: string;
  continueWith?: string[];
  /** Model alias or spec; defaults to the env LM_MODEL or 'M'. */
  model?: string;
  traceFile: string;
  sessionOpts?: Partial<SessionOpts>;
}

export interface RunSessionLiveResult {
  displays: unknown[];
  logs: string[];
  trace: TraceEvent[];
  error?: Error;
}

/**
 * Build a real streamFn the way bin.ts does (resolveAlias → resolveModel →
 * createStream, with per-request model override caching) and drive a core
 * Session in-process. Used where a SessionOpts knob (e.g. maxHistoryTurns) has
 * no CLI flag.
 */
export async function runSessionLive(opts: RunSessionLiveOpts): Promise<RunSessionLiveResult> {
  loadRepoEnv();
  const modelSpec = resolveAlias(opts.model ?? process.env['LM_MODEL'] ?? 'M');
  const model = await resolveModel(modelSpec);
  const modelCache = new Map<string, typeof model>([[modelSpec, model]]);
  const getModel = async (spec?: string): Promise<typeof model> => {
    if (!spec) return model;
    const resolvedSpec = resolveAlias(spec);
    const cached = modelCache.get(resolvedSpec);
    if (cached) return cached;
    const resolved = await resolveModel(resolvedSpec);
    modelCache.set(resolvedSpec, resolved);
    return resolved;
  };
  const streamFn = async (streamOpts: StreamOpts): Promise<StreamSession> => {
    const { model: modelOverride, ...rest } = streamOpts;
    return createStream({ model: await getModel(modelOverride), ...rest });
  };

  const displays: unknown[] = [];
  const logs: string[] = [];
  const host: RenderHost = {
    display: (d) => {
      displays.push(d);
      process.stdout.write(`    │ [display] ${JSON.stringify(d).slice(0, 200)}\n`);
    },
    ask: async () => undefined,
    log: (m) => {
      logs.push(m);
      process.stdout.write(`    │ ${m}\n`);
    },
  };

  const session = new Session(
    {
      spaceDir: opts.spaceDir,
      agentSlug: 'default',
      modelAlias: modelSpec,
      renderHost: host,
      traceFile: opts.traceFile,
      systemSpaceDirs: [],
      ...opts.sessionOpts,
    },
    { streamFn },
  );

  let error: Error | undefined;
  try {
    await session.start(opts.message);
    for (const m of opts.continueWith ?? []) await session.continue(m);
  } catch (e) {
    error = e as Error;
  }
  session.dispose();

  const trace = await readTrace(opts.traceFile);
  return { displays, logs, trace, error };
}
