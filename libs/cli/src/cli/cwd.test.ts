import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { applyCwd } from './cwd.js';

// vitest runs in worker threads where the real process.chdir() throws, so we
// record where applyCwd *would* move instead of actually moving. applyCwd
// returns resolve(raw), so assertions mirror that (resolve normalizes but does
// not follow symlinks — matching the function).
describe('applyCwd', () => {
  let base: string;
  let moves: string[];
  const chdir = (dir: string) => { moves.push(dir); };

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'lmthing-cwd-'));
    moves = [];
  });
  afterEach(() => { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  it('returns undefined and does not chdir when --cwd is absent', () => {
    expect(applyCwd(['serve', '--port', '8080'], chdir)).toBeUndefined();
    expect(moves).toEqual([]);
  });

  it('chdirs into an existing --cwd dir and returns its absolute path', () => {
    const moved = applyCwd(['serve', '--cwd', base], chdir);
    expect(moved).toBe(resolve(base));
    expect(moves).toEqual([resolve(base)]);
  });

  it('creates the --cwd dir if it does not exist, then targets it', () => {
    const target = join(base, 'nested', 'root');
    expect(existsSync(target)).toBe(false);
    const moved = applyCwd(['--cwd', target], chdir);
    expect(existsSync(target)).toBe(true); // created recursively
    expect(moved).toBe(resolve(target));
    expect(moves).toEqual([resolve(target)]);
  });

  it('resolves a relative --cwd against the current working directory', () => {
    // A path relative to cwd that points back into base must resolve to base.
    const rel = relative(process.cwd(), base);
    const moved = applyCwd(['--cwd', rel], chdir);
    expect(moved).toBe(resolve(base));
    expect(moves).toEqual([resolve(base)]);
  });

  it('is a no-op when --cwd has no value (parseArgs reports the error later)', () => {
    expect(applyCwd(['serve', '--cwd'], chdir)).toBeUndefined();
    expect(moves).toEqual([]);
  });
});
