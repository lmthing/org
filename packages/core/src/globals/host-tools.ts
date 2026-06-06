import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VM } from '../sandbox/quickjs.js';
import { marshalToQuickJS } from '../sandbox/host-bridge.js';
import type { RenderHost } from '../session/types.js';

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
}

const READ_BYTE_CAP = 256 * 1024;
const BINARY_SCAN_BYTES = 8192;

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

  // console — routes through renderHost.log
  setGlobal('console', {
    log: (...args: unknown[]) => renderHost.log(args.map(String).join(' ')),
    warn: (...args: unknown[]) => renderHost.log('[warn] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => renderHost.log('[error] ' + args.map(String).join(' ')),
  });

  // execShell — synchronous shell execution. Read-only profiles block mutating commands.
  setGlobal('execShell', (cmd: string) => {
    if (!allowWrite && !isReadOnlyCommand(cmd)) {
      return { ok: false, stdout: '', stderr: `read-only role: command "${commandHead(cmd)}" is blocked` };
    }
    try {
      const result = execSync(cmd, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      return { ok: true, stdout: result.toString(), stderr: '' };
    } catch (e: unknown) {
      const err = e as { message?: string; stdout?: Buffer; stderr?: Buffer };
      renderHost.log(`[execShell error] ${err.message ?? String(e)}`);
      return { ok: false, stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? String(e) };
    }
  });

  // process.env + process.exit — read-only env shim with LMTHING_SPACE_DIR injected
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
  env['LMTHING_SPACE_DIR'] = opts.spaceDir;
  setGlobal('process', { env, exit: (code?: number) => { throw new Error(`process.exit(${code ?? 0})`); } });

  // fetch — synchronous HTTP via curl; returns a plain object so `await fetch(...)` works
  setGlobal('fetch', (url: string, fetchOpts?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    try {
      const method = (fetchOpts?.method ?? 'GET').toUpperCase();
      const headers = Object.entries(fetchOpts?.headers ?? {})
        .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
        .join(' ');
      const bodyArg = fetchOpts?.body ? `--data-binary ${JSON.stringify(fetchOpts.body)}` : '';
      const cmd = `curl -s --max-time 30 -w "\\n__STATUS__%{http_code}" -X ${method} ${headers} ${bodyArg} ${JSON.stringify(String(url))}`;
      // timeout is a stopgap until fetch moves to a yield-based async client (Wave 2);
      // without it a hung endpoint blocks the single Node thread (and all forks) forever.
      const raw = execSync(cmd, { maxBuffer: 8 * 1024 * 1024, timeout: 31000 }).toString();
      const statusMatch = raw.match(/\n__STATUS__(\d+)$/);
      const status = statusMatch ? parseInt(statusMatch[1]!) : 200;
      const text = statusMatch ? raw.slice(0, raw.lastIndexOf('\n__STATUS__')) : raw;
      const ok = status >= 200 && status < 300;
      return { ok, status, text: () => text, json: () => JSON.parse(text) };
    } catch (e) {
      renderHost.log(`[fetch error] ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, status: 0, text: () => '', json: () => ({}) };
    }
  });

  // readFileRaw — binary-safe file read via Node fs (no shell quoting hazards)
  setGlobal('readFileRaw', (path: string, readOpts?: { offset?: number; limit?: number }) => {
    try {
      const buf = readFileSync(path);
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
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, String(content), 'utf8');
      return { ok: true, bytes: Buffer.byteLength(String(content), 'utf8') };
    } catch (e) {
      return { ok: false, bytes: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
