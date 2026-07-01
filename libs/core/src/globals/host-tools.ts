import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { VM } from '../sandbox/quickjs.js';
import { marshalToQuickJS } from '../sandbox/host-bridge.js';
import type { RenderHost } from '../session/types.js';
import { runTsc } from '../typecheck/tsc.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';

/**
 * Capability profile controlling which host primitives a VM receives.
 * Used by fork roles (explore/plan) to withhold mutation capability at
 * injection time rather than trusting the model's prompt.
 */
export interface HostToolsProfile {
  /** When false, writeFileRaw is replaced by a no-op that returns an error, and
   *  execShell rejects mutating commands. Defaults to true (full capability). */
  allowWrite?: boolean;
}

export interface HostToolsOpts {
  renderHost: RenderHost;
  /** Directory used to root per-space state (memory/todo stores) via LMTHING_SPACE_DIR. */
  spaceDir: string;
  profile?: HostToolsProfile;
  /** Live read-only progress accessor, surfaced to the VM as `progress()`. The
   *  worker can observe the "complexity factor" (turns/tool-calls/elapsed) but
   *  cannot mutate host state through it. */
  progress?: () => { episodes: number; toolCalls: number; elapsedMs: number };
  /** Absolute path to the project's spaces/ dir. Exposed as LMTHING_PROJECT_SPACES_DIR
   *  so the architect can target it when scaffolding new spaces. */
  projectSpacesDir?: string;
}

const READ_BYTE_CAP = 256 * 1024;
const BINARY_SCAN_BYTES = 8192;
// Default execShell timeout. Generous so first-run `npm install` / `npx <pkg>`
// (which download on first use) are not killed; callers can override per call.
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

/** First token of a shell command, used by the read-only execShell guard. */
function commandHead(cmd: string): string {
  return cmd.trim().split(/\s+/)[0] ?? '';
}

const MUTATING_COMMANDS = new Set([
  'rm', 'mv', 'cp', 'mkdir', 'rmdir', 'touch', 'tee', 'dd', 'truncate',
  'chmod', 'chown', 'ln', 'install', 'sed', 'npm', 'pnpm', 'yarn', 'git',
]);

/** A command is read-only unless its head is a known mutator or it redirects to a file. */
function isReadOnlyCommand(cmd: string): boolean {
  if (/(^|\s)>>?\s*\S/.test(cmd)) return false; // output redirection
  const head = commandHead(cmd);
  if (MUTATING_COMMANDS.has(head)) {
    // Allow read-only git subcommands explicitly.
    if (head === 'git' && /\bgit\s+(status|log|diff|show|branch|rev-parse|ls-files|blame|cat-file)\b/.test(cmd)) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Inject the shared synchronous host primitives onto a VM's global object:
 * console, execShell, process.env (+ LMTHING_SPACE_DIR), fetch, readFileRaw, writeFileRaw.
 *
 * This is the single source of truth for the host substrate — both the main
 * session VM and every fork VM call it, so the shims are not duplicated.
 */
export function injectHostTools(vm: VM, opts: HostToolsOpts): void {
  const ctx = vm.ctx;
  const { renderHost } = opts;
  const allowWrite = opts.profile?.allowWrite ?? true;

  const setGlobal = (name: string, value: unknown): void => {
    const handle = marshalToQuickJS(ctx, value);
    ctx.setProp(ctx.global, name, handle);
    handle.dispose();
  };

  // The space dir is the working root for an agent's file operations. Relative
  // paths resolve against it — the SAME root that execShell runs in
  // (cwd: spaceDir). Without this, a fork that does
  // writeFile("work/x.ts") would write relative to process.cwd() while execShell
  // looks under spaceDir, so they only agree when the CLI is launched from inside
  // the space. Absolute paths pass through untouched.
  // Absolute so that paths already built from LMTHING_SPACE_DIR (memory/todo's
  // `LMTHING_SPACE_DIR + '/.lmthing/...'`) stay absolute and pass through inSpace
  // untouched rather than being re-resolved (doubled) against the space root.
  const spaceRoot = resolve(opts.spaceDir);
  const inSpace = (path: string): string => (isAbsolute(path) ? path : resolve(spaceRoot, path));

  // console — routes through renderHost.log
  setGlobal('console', {
    log: (...args: unknown[]) => renderHost.log(args.map(String).join(' ')),
    warn: (...args: unknown[]) => renderHost.log('[warn] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => renderHost.log('[error] ' + args.map(String).join(' ')),
  });

  // execShell — synchronous shell execution. Read-only profiles block mutating commands.
  // `exitCode` lets the model distinguish failure modes (127 not-found, 126 denied,
  // 1 generic, etc.); `opts.timeout` overrides the default for slow first-run installs.
  // Runs with `cwd: spaceRoot` so relative paths agree with readFileRaw/writeFileRaw —
  // a fork that writeFile("work/x.ts") can then run it with
  // execShell("npx tsx work/x.ts") regardless of where the CLI was launched.
  setGlobal('execShell', (cmd: string, execOpts?: { timeout?: number }) => {
    if (!allowWrite && !isReadOnlyCommand(cmd)) {
      return { ok: false, stdout: '', stderr: `read-only role: command "${commandHead(cmd)}" is blocked`, exitCode: 126 };
    }
    const timeout = execOpts?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;
    try {
      const result = execSync(cmd, { maxBuffer: 8 * 1024 * 1024, timeout, cwd: spaceRoot });
      return { ok: true, stdout: result.toString(), stderr: '', exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { message?: string; stdout?: Buffer; stderr?: Buffer; status?: number | null };
      renderHost.log(`[execShell error] ${err.message ?? String(e)}`);
      return {
        ok: false,
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? String(e),
        // execSync sets `status` to the exit code (null on signal/timeout → 1).
        exitCode: typeof err.status === 'number' ? err.status : 1,
      };
    }
  });

  // process.env + process.exit — read-only env shim with LMTHING_SPACE_DIR injected
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
  env['LMTHING_SPACE_DIR'] = spaceRoot;
  if (opts.projectSpacesDir) {
    env['LMTHING_PROJECT_SPACES_DIR'] = opts.projectSpacesDir;
  }
  setGlobal('process', { env, exit: (code?: number) => { throw new Error(`process.exit(${code ?? 0})`); } });

  // fetch is now a value-yielding global (see globals/fetch.ts + eval/fetch-yield.ts) —
  // a real, non-blocking HTTP call instead of execSync(curl), injected alongside the
  // other yielding globals (sleep/ask/etc.) at each of the 3 injection sites
  // (session.ts/delegate.ts/fork.ts), not here.

  // readFileRaw — binary-safe file read via Node fs (no shell quoting hazards)
  setGlobal('readFileRaw', (path: string, readOpts?: { offset?: number; limit?: number }) => {
    try {
      const buf = readFileSync(inSpace(path));
      const scan = buf.subarray(0, BINARY_SCAN_BYTES);
      for (let i = 0; i < scan.length; i++) {
        if (scan[i] === 0) {
          return { ok: false, content: '', lines: 0, truncated: false, error: 'binary file' };
        }
      }
      let content = buf.toString('utf8');
      let truncated = false;
      if (readOpts?.offset !== undefined || readOpts?.limit !== undefined) {
        const allLines = content.split('\n');
        const start = Math.max(0, readOpts?.offset ?? 0);
        const end = readOpts?.limit !== undefined ? start + readOpts.limit : allLines.length;
        content = allLines.slice(start, end).join('\n');
      }
      if (content.length > READ_BYTE_CAP) {
        content = content.slice(0, READ_BYTE_CAP);
        truncated = true;
      }
      const lines = content.length === 0 ? 0 : content.split('\n').length;
      return { ok: true, content, lines, truncated };
    } catch (e) {
      return { ok: false, content: '', lines: 0, truncated: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // progress — read-only view of the run's budget counters ("complexity factor").
  // Returns a fresh snapshot each call; the VM cannot write back through it.
  const progressFn = opts.progress;
  if (progressFn) {
    setGlobal('progress', () => progressFn());
  }

  // writeFileRaw — file write via Node fs. Withheld for read-only profiles.
  setGlobal('writeFileRaw', (path: string, content: string) => {
    if (!allowWrite) {
      return { ok: false, bytes: 0, error: 'read-only role: writeFileRaw is blocked' };
    }
    try {
      const target = inSpace(path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, String(content), 'utf8');
      return { ok: true, bytes: Buffer.byteLength(String(content), 'utf8') };
    } catch (e) {
      return { ok: false, bytes: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // spacePath — join path segments with '/'. Replaces node:path.join inside the
  // QuickJS VM (there is no Node there). Semantics match the joinPath helper the
  // architect's builder functions used to carry verbatim in every file: the first
  // segment keeps its leading slash (absolute paths stay absolute) and loses any
  // trailing slashes; later segments are trimmed of leading+trailing slashes;
  // empty segments are dropped.
  const spacePathImpl = (...parts: string[]): string =>
    parts
      .map((p, i) => (i === 0 ? String(p).replace(/\/+$/, '') : String(p).replace(/^\/+|\/+$/g, '')))
      .filter(Boolean)
      .join('/');
  setGlobal('spacePath', spacePathImpl);

  // resolveSpaceDir — resolve a space arg (bare slug OR already-resolved dir) to
  // its directory. Same semantics as the resolveSpaceDir helper previously
  // duplicated across the architect builders: a value containing "/" is used
  // verbatim (trailing slashes trimmed — the iterate flow passes a discovered
  // dir); a bare slug resolves under the project spaces dir
  // (LMTHING_PROJECT_SPACES_DIR, default .lmthing/user/spaces).
  setGlobal('resolveSpaceDir', (space: string) => {
    const s = String(space ?? '').replace(/\/+$/, '');
    if (s.includes('/')) return s;
    const base = (opts.projectSpacesDir || '.lmthing/user/spaces').replace(/\/+$/, '');
    return spacePathImpl(base, s);
  });

  // typecheckSource — run tsc over a standalone TS source string (e.g. a space
  // function the architect just wrote) against the library DTS, returning a
  // self-correctable error list. Pure/read-only, so available regardless of profile.
  // "Cannot find name" diagnostics (2304/2552) are DROPPED: a single function may
  // legitimately reference sibling space functions not present in this isolated
  // check, so flagging them would be a false rejection. Syntax and real type
  // errors still surface.
  setGlobal('typecheckSource', (src: string) => {
    try {
      const result = runTsc({ ambientDts: LIBRARY_DTS, sessionContext: '', statement: String(src) });
      const errors = result.diagnostics
        .filter((d) => d.code !== 2304 && d.code !== 2552)
        .map((d) => `line ${d.line + 1}:${d.col} TS${d.code}: ${d.message}`);
      return { ok: errors.length === 0, errors };
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }
  });
}
