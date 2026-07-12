import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RenderHost } from '../session/types.js';
import {
  readFileRawAt, writeFileRawAt, runShell,
  type ReadFileResult, type WriteFileResult, type ShellResult,
} from './host-tools.js';

/**
 * The engineer's scratch sandbox — the ONLY generic filesystem/shell surface in
 * the runtime. Every OTHER agent persists a change to a space or project through
 * a TYPED writer (`writeProject*`, the architect builder functions), which is
 * rooted by construction and cannot mis-root; the generic `readFile`/`writeFile`/
 * `execShell` family was removed from the model DTS (see typecheck/library-dts.ts
 * + exec/bootstrap.ts). The engineer keeps that family, but jailed here:
 *
 *   - `createScratch()` (model-facing) mkdirs a fresh throwaway dir under
 *     `<projectRoot ?? spaceDir>/.lmthing/scratch/<random>` and returns its path.
 *     Nothing works until it is called.
 *   - `scratchReadRaw`/`scratchWriteRaw`/`scratchExec` (internal, NOT on the DTS)
 *     are what the engineer's six wrapper functions and its model-facing
 *     `execShell` call. Every path is `safeResolve`d against the scratch root, so
 *     an absolute path or a `..` escape is REJECTED — that guard IS the sandbox.
 *
 * These are DISTINCT from `readFileRaw`/`writeFileRaw`/`execShell` (host-tools),
 * which stay space-rooted for the trusted internal callers (memory/todos build
 * absolute paths from `LMTHING_SPACE_DIR`; the architect builders write via
 * `resolveSpaceDir`). Re-rooting those to scratch would break memory persistence —
 * hence a separate primitive set, not a reroute.
 */
export interface ScratchTools {
  /** Create (once) and return the scratch dir. Idempotent — returns the existing path. */
  createScratch: () => string;
  scratchReadRaw: (path: string, opts?: { offset?: number; limit?: number }) => ReadFileResult;
  scratchWriteRaw: (path: string, content: string) => WriteFileResult;
  scratchExec: (cmd: string, opts?: { timeout?: number }) => ShellResult;
}

const NOT_CREATED = 'create a scratch dir first — call createScratch()';

export function createScratchTools(opts: {
  projectRoot?: string;
  spaceDir: string;
  renderHost: RenderHost;
}): ScratchTools {
  const base = resolve(opts.projectRoot ?? opts.spaceDir);
  let scratchRoot: string | null = null;

  const createScratch = (): string => {
    if (scratchRoot) return scratchRoot;
    const dir = resolve(base, '.lmthing/scratch', randomBytes(6).toString('hex'));
    mkdirSync(dir, { recursive: true });
    scratchRoot = dir;
    return dir;
  };

  /** Resolve `rel` inside the scratch root, or null if it escapes (absolute or `..`). */
  const safeResolve = (rel: string): string | null => {
    if (!scratchRoot) return null;
    const target = isAbsolute(rel) ? resolve(rel) : resolve(scratchRoot, rel);
    if (target === scratchRoot || target.startsWith(scratchRoot + sep)) return target;
    return null;
  };

  const escaped = (path: string): string => `path escapes the scratch sandbox: ${path}`;

  const scratchReadRaw: ScratchTools['scratchReadRaw'] = (path, readOpts) => {
    if (!scratchRoot) return { ok: false, content: '', lines: 0, truncated: false, error: NOT_CREATED };
    const target = safeResolve(String(path));
    if (!target) return { ok: false, content: '', lines: 0, truncated: false, error: escaped(String(path)) };
    return readFileRawAt(target, readOpts);
  };

  const scratchWriteRaw: ScratchTools['scratchWriteRaw'] = (path, content) => {
    if (!scratchRoot) return { ok: false, bytes: 0, error: NOT_CREATED };
    const target = safeResolve(String(path));
    if (!target) return { ok: false, bytes: 0, error: escaped(String(path)) };
    return writeFileRawAt(target, content);
  };

  const scratchExec: ScratchTools['scratchExec'] = (cmd, execOpts) => {
    if (!scratchRoot) return { ok: false, stdout: '', stderr: NOT_CREATED, exitCode: 1 };
    return runShell(String(cmd), { cwd: scratchRoot, timeout: execOpts?.timeout }, opts.renderHost);
  };

  return { createScratch, scratchReadRaw, scratchWriteRaw, scratchExec };
}
