import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Honor an explicit `--cwd <path>` by switching the process working directory
 * before anything else resolves. Every cwd-relative path then hangs off the
 * chosen directory: the `.env` loaded at startup, the runtime root
 * (`<cwd>/.lmthing`, unless `LMTHING_ROOT` overrides it), the default space dir,
 * uploads and the terminal cwd. Scanned straight from argv because it runs
 * before formal arg parsing — the same reason `loadEnv` scans `--env-file`
 * directly. The directory is created if it does not yet exist. Returns the
 * absolute path it moved to, or `undefined` when `--cwd` was not given (the
 * working directory is left untouched).
 *
 * `chdir` is injectable only so the behaviour can be unit-tested — vitest runs
 * in worker threads where the real `process.chdir` throws.
 */
export function applyCwd(argv: string[], chdir: (dir: string) => void = process.chdir): string | undefined {
  const idx = argv.indexOf('--cwd');
  if (idx === -1) return undefined;
  const raw = argv[idx + 1];
  if (!raw) return undefined; // value missing — parseArgs reports the error
  const dir = resolve(raw);
  mkdirSync(dir, { recursive: true });
  chdir(dir);
  return dir;
}
