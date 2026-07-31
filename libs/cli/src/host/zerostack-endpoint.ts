import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZEROSTACK_AGENTS_MD } from './zerostack-agents.js';
import { ZEROSTACK_ARCHITECTURE_MD } from './zerostack-architecture.js';

/**
 * A loopback endpoint that runs **zerostack** — an external Rust coding agent — over the LMThing
 * data directory, and exposes it to the sandbox as plain HTTP.
 *
 * ## Why a loopback bridge and not a new global
 *
 * Space functions run inside QuickJS. They cannot spawn a process, and adding a new host global
 * would mean threading a capability, a DTS declaration, and an injection site through several
 * hand-written lists (`bin.ts`, `session-manager.ts`) that are easy to forget one of — a gap that
 * typechecks, passes unit tests, and only shows up on a live pod.
 *
 * `host/browser-endpoint.ts` already solved exactly this: bind loopback, publish the URL in an env
 * var, and let the space functions be nothing but `fetch` wrappers. Two facts make it work, and
 * both are documented there — `process.env` is snapshot-copied into each VM at injection time, and
 * the VM's `fetch` is a sandbox yield resolved host-side by real Node `fetch`, so a `127.0.0.1`
 * address is reachable from inside. This file follows that pattern deliberately.
 *
 * Loopback rather than a route on the pod router: a `router.add(...)` route passes through
 * `guardRequest` (which 401s on a team pod) and would publish a public surface for something that
 * only ever talks to itself. Binding an ephemeral port on `127.0.0.1` makes it unreachable from
 * outside the pod at all — which matters more here than for the browser, because this endpoint
 * runs arbitrary code against the person's entire data directory.
 *
 * ## Session model — one data dir per logical session
 *
 * zerostack mints its own session ids and `--session` loads them **by id prefix**; there is no way
 * to ask it to create a session under an id we chose. Rather than parse its session files to
 * discover what it picked (a private format that can change under us), each logical session gets
 * its own `XDG_DATA_HOME`. With exactly one session in that directory, `-c` ("continue most recent
 * session") is unambiguous by construction, and the id the agent holds is ours.
 *
 * The cost is that zerostack's cross-session memory is per-LMThing-session. That is the right
 * trade: a resume that silently attaches to the wrong conversation is a far worse failure than a
 * narrower memory, and agents resume deliberately by passing a `sessionId` back.
 */

export interface ZerostackEndpoint {
  /** The URL published to the VM as `LMTHING_ZEROSTACK_URL`. */
  url: string;
  /** Absolute path of the zerostack binary, or null when it is not installed. */
  bin: string | null;
  close(): Promise<void>;
}

/** Published for every VM created from now on; the space functions read exactly this. */
export const ZEROSTACK_ENV = 'LMTHING_ZEROSTACK_URL';

/** Override the binary location (tests, local dev, a non-PATH install). */
const ZEROSTACK_BIN_ENV = 'LMTHING_ZEROSTACK_BIN';

/**
 * A coding turn is not a web request. Real work — read the repo, edit, run the typechecker, read
 * the failure, edit again — routinely runs into minutes, and a turn killed at the two-minute mark
 * leaves half-applied edits on disk, which is worse than waiting.
 */
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_TURN_TIMEOUT_MS = 30 * 60_000;
/** Loop mode is explicitly the "go away and work" surface, so it gets its own, longer ceiling. */
const MAX_LOOP_TIMEOUT_MS = 60 * 60_000;

/**
 * One long-poll slice. Must stay comfortably under the sandbox's own 25s `fetch` abort
 * (`libs/core/src/eval/fetch-yield.ts`), which reports as `status: 0` and is indistinguishable
 * from a dead endpoint — so the bridge answers first, with "still running".
 */
const WAIT_SLICE_MS = 15_000;

/** Enough that a truncated answer is a real edge case; small enough that one runaway turn cannot exhaust pod memory. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface ZerostackEndpointOpts {
  /** The LMThing data root. Becomes zerostack's working directory — this IS the "full data directory" grant. */
  dataDir: string;
  /**
   * The resolved `provider:modelId` the pod's own agents run on (`SessionManager.defaultModel`).
   * zerostack runs on the same model, through the same key, so its spend lands on the same budget.
   */
  modelSpec: string;
  log?: (msg: string) => void;
}

/** Minimal structural view of the spawned child — self-typed to stay independent of the
 *  workspace's (multi-version) `@types/node` `ChildProcess` resolution, matching the same
 *  workaround in `server/routes/hooks.ts`. */
interface SpawnedProc {
  on(ev: 'error', cb: (e: Error) => void): void;
  on(ev: 'close', cb: (code: number | null) => void): void;
  kill(signal?: string): void;
  stdout: { on(ev: 'data', cb: (c: Buffer) => void): void } | null;
  stderr: { on(ev: 'data', cb: (c: Buffer) => void): void } | null;
}

/** One in-flight zerostack process, tracked so a turn can be cancelled. */
interface RunningTurn {
  child: SpawnedProc;
  startedAt: number;
}

export interface ZerostackTurnResult {
  ok: boolean;
  sessionId: string;
  /** zerostack's final response text (stdout). */
  text: string;
  /** The tool-call transcript — populated only when the caller asked for `verbose`. */
  transcript?: string;
  exitCode: number | null;
  /** True when the turn was stopped by the timeout rather than finishing. */
  timedOut: boolean;
  error?: string;
}

/**
 * Map the pod's `provider:modelId` onto a zerostack provider.
 *
 * Returns a `custom_providers` entry for anything OpenAI-compatible (which is what the pod
 * actually uses in production — `lmthingcloud` is a LiteLLM proxy speaking OpenAI `/v1`), so
 * zerostack bills the same key against the same budget windows as every other agent in the pod.
 *
 * Providers with no OpenAI-compatible shape return an `unsupported` reason instead of a silent
 * fallback. Falling back would be the worst outcome available: zerostack's own default provider is
 * OpenRouter, so a bad mapping would quietly bill a completely different account — or, with no
 * OpenRouter key present, fail deep inside the child with a message about a key nobody set.
 */
export function mapProvider(modelSpec: string, env: NodeJS.ProcessEnv = process.env): {
  ok: true; providerName: string; model: string; baseUrl: string; apiKeyEnv: string;
} | { ok: false; reason: string } {
  const colon = modelSpec.indexOf(':');
  if (colon === -1) {
    return { ok: false, reason: `model spec "${modelSpec}" is not in "provider:modelId" form` };
  }
  const provider = modelSpec.slice(0, colon).toLowerCase();
  const model = modelSpec.slice(colon + 1);
  if (!model) return { ok: false, reason: `model spec "${modelSpec}" has an empty model id` };

  switch (provider) {
    case 'lmthingcloud':
      return {
        ok: true,
        providerName: 'lmthing',
        model,
        baseUrl: env['LMTHINGCLOUD_BASE_URL'] || 'https://lmthing.cloud/v1',
        apiKeyEnv: 'LMTHINGCLOUD_API_KEY',
      };
    case 'openai':
      return {
        ok: true,
        providerName: 'lmthing',
        model,
        baseUrl: env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
      };
    default:
      // `azure:` is the notable one that lands here. Azure OpenAI needs an `api-version` query
      // parameter on every request, which a `base_url` alone cannot express, and Azure-hosted
      // Claude uses the Anthropic messages API at a different path again. Both are reachable
      // through the LiteLLM proxy, which is how the pod is configured in production — so the
      // honest answer is to say so rather than to construct a URL that 404s at request time.
      return {
        ok: false,
        reason: `provider "${provider}" has no OpenAI-compatible endpoint zerostack can use — point LM_MODEL_* at an "lmthingcloud:" model (the LiteLLM proxy already fronts ${provider})`,
      };
  }
}

/**
 * Render the zerostack config.
 *
 * TOML because it is the highest-priority filename zerostack probes (`config.toml` beats
 * `config.yaml` beats `config.json`), so a stale file in another format cannot shadow it.
 *
 * `yolo` is the only workable permission mode here: every other mode prompts on the terminal, and
 * nothing is attached to a terminal — an "ask" would hang until the turn timeout and report as a
 * mysterious stall. `yolo` still refuses destructive bash (`rm`, `dd`, `mkfs`), which is the
 * protection that actually matters when the working directory is the person's only copy of every
 * project they own.
 *
 * `external_directory` then confines the file tools to the data directory: `/app` (the runtime
 * image) and the rest of the container are readable by nothing here. Note this governs the file
 * tools, not bash — bash is bounded by yolo's destructive-command list.
 */
export function renderConfigToml(p: { providerName: string; model: string; baseUrl: string; apiKeyEnv: string; dataDir: string }): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `# GENERATED by @lmthing/cli (host/zerostack-endpoint.ts) on every pod boot.
# Hand edits are lost on the next restart — change the generator instead.

provider = "${esc(p.providerName)}"
model = "${esc(p.model)}"
default_permission_mode = "yolo"

# MCP is disabled OUTRIGHT — no servers, none reachable.
#
# Upstream ships three third-party MCP servers ON by default: Exa (mcp.exa.ai), Context7
# (mcp.context7.com) and grep.app. A live run confirmed the Exa one opens a session even with no
# EXA_API_KEY set. Inside a pod that is pure data egress — this agent works over the person's
# entire data directory, so anything it reads could be shipped to a third party nobody consented
# to, billed to an account nobody configured.
#
# Two mechanisms, deliberately, because they fail differently. The empty mcp_servers map is the
# load-bearing one: the defaults apply only when that key is UNSET, so setting it empty leaves no
# server defined at all, and a future upstream release cannot add a fourth default underneath us.
# The three enable-* toggles then also say no by name, so a regression that reinstated the defaults
# for an explicitly-empty map would still find each one switched off.
mcp_servers = {}
enable-exa-mcp = false
enable-context7-mcp = false
enable-grepapp-mcp = false
# No MCP call is ever auto-approved, in case one is somehow configured anyway.
allow_all_mcp_calls = false

[custom_providers.${p.providerName}]
provider_type = "openai"
base_url = "${esc(p.baseUrl)}"
api_key_env = "${esc(p.apiKeyEnv)}"

# File tools are confined to the LMThing data directory. Everything else in the container —
# the runtime image under /app, other users' mounts — is not merely denied, it is unreachable.
[permission.external_directory]
"${esc(p.dataDir)}/**" = "allow"
"/**" = "deny"
`;
}

/** Resolve the zerostack binary: explicit override, else PATH. */
function resolveBin(env: NodeJS.ProcessEnv): string | null {
  const override = env[ZEROSTACK_BIN_ENV];
  if (override) return existsSync(override) ? override : null;
  // `zerostack` on PATH. Existence is confirmed by the `--version` probe at startup rather than by
  // a PATH walk here, so a broken binary is reported the same way a missing one is.
  return 'zerostack';
}

/** One `zerostack --version`, so `status` can answer honestly instead of guessing. */
function probeVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    let child: SpawnedProc;
    try {
      child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }) as unknown as SpawnedProc;
    } catch {
      finish(null);
      return;
    }
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out.trim() : null));
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } finish(null); }, 10_000);
  });
}

export async function startZerostackEndpoint(opts: ZerostackEndpointOpts): Promise<ZerostackEndpoint> {
  const log = opts.log ?? (() => {});
  const bin = resolveBin(process.env);
  const version = bin ? await probeVersion(bin) : null;

  // Everything zerostack owns lives under one directory on the pod volume, so sessions survive a
  // scale-to-zero wake exactly like projects do.
  const zsRoot = join(opts.dataDir, '.zerostack');
  const configDir = join(zsRoot, 'config');
  const sessionsRoot = join(zsRoot, 'agents');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(sessionsRoot, { recursive: true });

  const mapped = mapProvider(opts.modelSpec);
  if (mapped.ok) {
    writeFileSync(
      join(configDir, 'config.toml'),
      renderConfigToml({ ...mapped, dataDir: opts.dataDir }),
      'utf8',
    );
  }

  // Rewritten every boot: a pod volume outlives the image, so a primer written by an older
  // runtime would otherwise persist unnoticed after an upgrade.
  writeFileSync(join(opts.dataDir, 'AGENTS.md'), ZEROSTACK_AGENTS_MD, 'utf8');
  // ARCHITECTURE.md must exist too. When it is absent zerostack ASKS — "No ARCHITECTURE.md found …
  // Create one? [y/N]" — and it asks even under `-p`. Nothing here can answer a prompt: stdin is
  // `ignore`, so the read EOFs and it moves on, but that is the prompt failing safe rather than
  // not happening. Providing the file removes the question instead of relying on the recovery.
  writeFileSync(join(opts.dataDir, 'ARCHITECTURE.md'), ZEROSTACK_ARCHITECTURE_MD, 'utf8');

  const running = new Map<string, RunningTurn>();
  /** In-flight turn per session — awaited by `wait`, which may be called many times for one turn. */
  const pending = new Map<string, Promise<ZerostackTurnResult>>();
  /** The last finished result per session, so a `wait` arriving after completion still gets it. */
  const finished = new Map<string, ZerostackTurnResult>();

  /** Per-session data dir. Creating it is what makes a session id real. */
  const sessionDir = (id: string) => join(sessionsRoot, id);

  const childEnv = (id: string): NodeJS.ProcessEnv => ({
    ...process.env,
    // Sessions follow XDG_DATA_HOME; one session per directory is what makes `-c` deterministic.
    XDG_DATA_HOME: sessionDir(id),
    ZS_DATA_DIR: sessionDir(id),
    ZS_CONFIG_DIR: configDir,
    // Belt and braces: the config file already pins these, but a config that failed to write
    // (unsupported provider) must not silently fall through to zerostack's OpenRouter default.
    ...(mapped.ok ? { ZS_PROVIDER: mapped.providerName, ZS_MODEL: mapped.model } : {}),
    // The TUI is not attached to anything; colour codes would only corrupt the captured text.
    NO_COLOR: '1',
  });

  function runTurn(args: {
    sessionId?: string; message: string; verbose?: boolean; timeoutMs?: number;
    promptName?: string; resume?: boolean; loop?: { maxIterations?: number; validateCmd?: string };
  }): Promise<ZerostackTurnResult> {
    return new Promise((resolve) => {
      if (!bin || !version) {
        resolve({
          ok: false, sessionId: args.sessionId ?? '', text: '', exitCode: null, timedOut: false,
          error: 'the zerostack binary is not installed in this pod — the runtime image must ship it at /usr/local/bin/zerostack (set LMTHING_ZEROSTACK_BIN to override)',
        });
        return;
      }
      if (!mapped.ok) {
        resolve({
          ok: false, sessionId: args.sessionId ?? '', text: '', exitCode: null, timedOut: false,
          error: `zerostack has no usable model: ${mapped.reason}`,
        });
        return;
      }

      // NEW is decided by the session DIRECTORY, not by whether an id was supplied: `startTurn`
      // always supplies one (it mints the id so it can return it before the turn finishes).
      const id = args.sessionId ?? randomUUID();
      const dir = sessionDir(id);
      const isNew = !existsSync(dir);
      if (isNew && args.resume) {
        resolve({
          ok: false, sessionId: id, text: '', exitCode: null, timedOut: false,
          error: `no zerostack session "${id}" — omit sessionId to start a new one`,
        });
        return;
      }
      if (isNew) mkdirSync(dir, { recursive: true });
      const isLoop = args.loop !== undefined;
      const ceiling = isLoop ? MAX_LOOP_TIMEOUT_MS : MAX_TURN_TIMEOUT_MS;
      const timeoutMs = Math.min(args.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS, ceiling);

      const argv: string[] = ['-p', '--no-color'];
      // Resume only when the session already existed. Passing `-c` on the very first turn of a
      // fresh data dir asks zerostack to continue a session that does not exist yet.
      if (!isNew) argv.push('-c');
      if (args.verbose) argv.push('--pure-stdout');
      if (args.promptName) argv.push('--load-prompt', args.promptName);
      if (args.loop) {
        argv.push('--loop', '--loop-prompt', args.message);
        if (args.loop.maxIterations !== undefined) argv.push('--loop-max', String(args.loop.maxIterations));
        if (args.loop.validateCmd) argv.push('--loop-run', args.loop.validateCmd);
      }
      // The message is a positional argument (`-p` is the print-and-exit FLAG, not a value flag).
      // `--` first so a message beginning with `-` is never parsed as options.
      argv.push('--', args.message);

      let child: SpawnedProc;
      try {
        child = spawn(bin, argv, {
          cwd: opts.dataDir,
          env: childEnv(id),
          stdio: ['ignore', 'pipe', 'pipe'],
        }) as unknown as SpawnedProc;
      } catch (e) {
        resolve({
          ok: false, sessionId: id, text: '', exitCode: null, timedOut: false,
          error: `could not start zerostack: ${String(e)}`,
        });
        return;
      }

      running.set(id, { child, startedAt: Date.now() });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      const append = (cur: string, chunk: string) => {
        if (cur.length >= MAX_OUTPUT_BYTES) { truncated = true; return cur; }
        return cur + chunk;
      };
      child.stdout?.on('data', (c: Buffer) => { stdout = append(stdout, c.toString('utf8')); });
      child.stderr?.on('data', (c: Buffer) => { stderr = append(stderr, c.toString('utf8')); });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        // SIGTERM first so zerostack can flush its session file; SIGKILL only if it ignores that.
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 5_000);
      }, timeoutMs);

      let settled = false;
      const settle = (r: ZerostackTurnResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running.delete(id);
        resolve(r);
      };

      child.on('error', (e) => {
        settle({
          ok: false, sessionId: id, text: '', exitCode: null, timedOut: false,
          error: `zerostack failed to run: ${e.message}`,
        });
      });

      child.on('close', (code) => {
        const text = stdout.trim() + (truncated ? '\n\n[output truncated by the pod at 2 MB]' : '');
        if (timedOut) {
          settle({
            ok: false, sessionId: id, text, exitCode: code, timedOut: true,
            // The partial output is still returned: a timed-out turn has usually already edited
            // files, and the caller needs to know what it got to before it was stopped.
            error: `zerostack was stopped after ${Math.round(timeoutMs / 1000)}s. Any edits it had already made are on disk. Resume this session to continue.`,
          });
          return;
        }
        if (code !== 0) {
          settle({
            ok: false, sessionId: id, text, exitCode: code, timedOut: false,
            error: stderr.trim() || `zerostack exited ${code}`,
          });
          return;
        }
        settle({
          ok: true,
          sessionId: id,
          text,
          ...(args.verbose ? { transcript: stderr.trim() } : {}),
          exitCode: code,
          timedOut: false,
        });
      });
    });
  }

  /**
   * Start a turn and return its session id WITHOUT waiting for it.
   *
   * The sandbox's `fetch` aborts at 25s and reports the failure as `status: 0`
   * (`libs/core/src/eval/fetch-yield.ts`). A coding turn takes MINUTES, so a blocking `ask` could
   * essentially never succeed — and the caller saw a bare "HTTP 0", which reads as "the service is
   * down" rather than "still working". A live engineer run hit it eight times.
   *
   * So the turn is started here and collected by `wait` below, in slices that each finish well
   * inside the sandbox's limit.
   */
  function startTurn(args: Parameters<typeof runTurn>[0]): { sessionId: string; immediate?: ZerostackTurnResult } {
    const id = args.sessionId ?? randomUUID();
    if (pending.has(id)) {
      return { sessionId: id, immediate: { ok: false, sessionId: id, text: '', exitCode: null, timedOut: false, error: `session "${id}" already has a turn in flight — wait for it, or cancel it first` } };
    }
    finished.delete(id);
    const p = runTurn({ ...args, sessionId: id });
    pending.set(id, p);
    // Recorded HERE rather than in the child's settle(), because a turn that fails validation
    // (no binary, unusable model, unknown session) resolves without ever spawning one — and a
    // `wait` that then found neither a pending nor a finished turn would report the far more
    // confusing "no turn is running" instead of the actual reason.
    void p.then((r) => { finished.set(id, r); }, () => { /* runTurn never rejects */ })
      .finally(() => { pending.delete(id); });
    return { sessionId: id };
  }

  /**
   * Long-poll one turn. Resolves as soon as it finishes, or reports `running` when the slice
   * elapses — deliberately shorter than the sandbox fetch abort, so the caller always gets an
   * answer it can act on instead of a transport error it cannot distinguish from a dead endpoint.
   */
  async function waitTurn(sessionId: string, sliceMs: number): Promise<{ running: boolean; result?: ZerostackTurnResult }> {
    const done = finished.get(sessionId);
    if (done) return { running: false, result: done };
    const p = pending.get(sessionId);
    if (!p) {
      return { running: false, result: { ok: false, sessionId, text: '', exitCode: null, timedOut: false, error: `no turn is running or finished for session "${sessionId}"` } };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slice = new Promise<null>((r) => { timer = setTimeout(() => r(null), sliceMs); });
    const winner = await Promise.race([p, slice]);
    if (timer) clearTimeout(timer);
    return winner === null ? { running: true } : { running: false, result: winner as ZerostackTurnResult };
  }

  async function listSessions(): Promise<Array<{ sessionId: string; updatedAt: number; busy: boolean }>> {
    let names: string[];
    try {
      names = await readdir(sessionsRoot);
    } catch {
      return [];
    }
    const out: Array<{ sessionId: string; updatedAt: number; busy: boolean }> = [];
    for (const n of names) {
      try {
        const s = await stat(join(sessionsRoot, n));
        if (s.isDirectory()) out.push({ sessionId: n, updatedAt: s.mtimeMs, busy: running.has(n) });
      } catch { /* vanished between readdir and stat */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const server: Server = createServer(async (req, res) => {
    const reply = (value: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);

    let body: { op?: string; [k: string]: unknown };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      reply({ ok: false, error: 'malformed request body' });
      return;
    }

    try {
      switch (body.op) {
        case 'status':
          reply({
            ok: bin !== null && version !== null && mapped.ok,
            installed: version !== null,
            version,
            dataDir: opts.dataDir,
            model: mapped.ok ? `${mapped.providerName}:${mapped.model}` : null,
            permissionMode: 'yolo',
            sessions: (await listSessions()).length,
            ...(mapped.ok ? {} : { error: mapped.reason }),
            ...(version === null ? { error: 'the zerostack binary is not installed in this pod' } : {}),
          });
          return;

        // `ask`/`loop` START a turn and answer immediately; `wait` collects it. See `startTurn`.
        case 'ask':
        case 'loop': {
          const resume = typeof body['sessionId'] === 'string' && body['sessionId'].length > 0;
          const started = startTurn({
            ...(resume ? { sessionId: String(body['sessionId']), resume: true } : {}),
            message: String(body['message'] ?? ''),
            ...(body['verbose'] === true ? { verbose: true } : {}),
            ...(typeof body['timeoutMs'] === 'number' ? { timeoutMs: body['timeoutMs'] } : {}),
            ...(typeof body['promptName'] === 'string' ? { promptName: body['promptName'] } : {}),
            ...(body.op === 'loop'
              ? { loop: {
                  ...(typeof body['maxIterations'] === 'number' ? { maxIterations: body['maxIterations'] } : {}),
                  ...(typeof body['validateCmd'] === 'string' ? { validateCmd: body['validateCmd'] } : {}),
                } }
              : {}),
          });
          if (started.immediate) { reply({ ...started.immediate, running: false }); return; }
          reply({ ok: true, sessionId: started.sessionId, running: true });
          return;
        }

        case 'wait': {
          const sessionId = String(body['sessionId'] ?? '');
          if (!sessionId) { reply({ ok: false, running: false, error: 'wait needs a sessionId' }); return; }
          // Capped well under the sandbox's 25s fetch abort so the caller always gets a real answer.
          const sliceMs = Math.min(typeof body['sliceMs'] === 'number' ? body['sliceMs'] : WAIT_SLICE_MS, WAIT_SLICE_MS);
          const w = await waitTurn(sessionId, sliceMs);
          reply(w.running ? { ok: true, sessionId, running: true } : { ...w.result, running: false });
          return;
        }

        case 'sessions':
          reply({ ok: true, sessions: await listSessions() });
          return;

        case 'cancel': {
          const id = String(body['sessionId'] ?? '');
          const t = running.get(id);
          if (!t) { reply({ ok: false, error: `no turn in flight for session "${id}"` }); return; }
          try { t.child.kill('SIGTERM'); } catch { /* already gone */ }
          reply({ ok: true, sessionId: id, ranForMs: Date.now() - t.startedAt });
          return;
        }

        default:
          reply({ ok: false, error: `unknown zerostack op "${String(body.op)}"` });
      }
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;

  // Published unconditionally, even when the binary is missing. The space functions then reach an
  // endpoint that explains WHY zerostack is unavailable, instead of an unset variable that makes
  // every function report the same uninformative "not configured".
  process.env[ZEROSTACK_ENV] = url;

  log(
    version
      ? `[zerostack] ${version} on ${url} (cwd ${opts.dataDir}, model ${mapped.ok ? `${mapped.providerName}:${mapped.model}` : 'UNAVAILABLE'})`
      : `[zerostack] binary not installed — endpoint on ${url} will report why`,
  );

  return {
    url,
    bin: version ? bin : null,
    close: () =>
      new Promise<void>((resolve) => {
        for (const { child } of running.values()) {
          try { child.kill('SIGTERM'); } catch { /* already gone */ }
        }
        running.clear();
        if (process.env[ZEROSTACK_ENV] === url) delete process.env[ZEROSTACK_ENV];
        server.close(() => resolve());
      }),
  };
}
