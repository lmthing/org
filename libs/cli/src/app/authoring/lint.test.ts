/**
 * Unit tests for the write-time artifact lint ({@link ./lint.ts}) — each validator in isolation,
 * with explicit FALSE-REJECT guards (valid real-world source shapes must pass) so the lint never
 * blocks a legal write.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LintError,
  existingApiNames,
  lintApiHandler,
  lintComponentSource,
  lintHookSource,
  lintPageSource,
} from './lint.js';

describe('lintApiHandler', () => {
  const named = "export const name = 'itemsList';\nexport default async (req, ctx) => ({ ok: true });";

  it('rejects a handler with no `export const name` (the round-1 failure)', () => {
    expect(lintApiHandler('export default async () => ({});')).toMatch(/export const name/);
  });
  it('rejects a named module with no default/handler export', () => {
    expect(lintApiHandler("export const name = 'x';")).toMatch(/handler/i);
  });
  it('accepts a named endpoint with a default export', () => {
    expect(lintApiHandler(named)).toBeNull();
  });
  it('accepts `export function handler` instead of a default export', () => {
    expect(lintApiHandler("export const name = 'x';\nexport function handler() {}")).toBeNull();
  });
  it('rejects a name already claimed by a DIFFERENT endpoint file', () => {
    const existing = new Map([['itemsList', 'api/other/GET.ts']]);
    expect(lintApiHandler(named, { existingNames: existing })).toMatch(/already used by api\/other\/GET\.ts/);
  });
  it('allows a name that belongs to no other file', () => {
    expect(lintApiHandler(named, { existingNames: new Map() })).toBeNull();
  });
});

describe('lintPageSource / lintComponentSource', () => {
  it('rejects a page with no default export', () => {
    expect(lintPageSource('export const x = 1;')).toMatch(/default export/);
  });
  it('rejects a component with no default export', () => {
    expect(lintComponentSource('export function Card() { return null; }')).toMatch(/default export/);
  });
  it('accepts `export default function`', () => {
    expect(lintPageSource('export default function Page() { return null; }')).toBeNull();
  });
  it('accepts an arrow default export', () => {
    expect(lintComponentSource('export default () => null;')).toBeNull();
  });
  it('accepts `export { X as default }` (no false-reject)', () => {
    expect(lintPageSource('function Page() { return null; }\nexport { Page as default };')).toBeNull();
    expect(lintComponentSource('const C = () => null;\nexport { C as default };')).toBeNull();
  });
});

describe('lintHookSource', () => {
  const file = join(tmpdir(), 'x', 'hooks', 'h.ts');

  it('rejects a default export that is a function, not an object', () => {
    expect(lintHookSource('export default async function () {}', 'h', file)).toMatch(/must be a hook OBJECT/);
  });
  it('rejects an object with a missing or unknown type', () => {
    expect(lintHookSource('export default {};', 'h', file)).toMatch(/type/);
    expect(lintHookSource("export default { type: 'nope' };", 'h', file)).toMatch(/cron/);
  });
  it('accepts a valid cron / event / webhook hook object', () => {
    expect(lintHookSource("export default { type: 'cron', every: '1d', handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'event', on: { event: 'x/y' }, handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'webhook', path: 'incoming', trigger: 'x' };", 'h', file)).toBeNull();
  });
  it('rejects source that fails to evaluate', () => {
    expect(lintHookSource("throw new Error('boom'); export default { type: 'cron' };", 'h', file)).toMatch(/failed to evaluate/);
  });
});

describe('existingApiNames', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-lint-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps each endpoint name to its file and EXCLUDES the target being written', () => {
    mkdirSync(join(root, 'api', 'items'), { recursive: true });
    writeFileSync(join(root, 'api', 'items', 'GET.ts'), "export const name = 'itemsList';\nexport default () => ({});");
    mkdirSync(join(root, 'api', 'items', 'x'), { recursive: true });
    const target = join(root, 'api', 'items', 'x', 'POST.ts');
    writeFileSync(target, "export const name = 'itemsCreate';\nexport default () => ({});");

    const names = existingApiNames(root, target);
    expect(names.get('itemsList')).toBe(join('api', 'items', 'GET.ts'));
    expect(names.has('itemsCreate')).toBe(false); // the target file is excluded from its own scan
  });

  it('returns an empty map when there is no api/ dir', () => {
    expect(existingApiNames(root, join(root, 'api', 'x', 'GET.ts')).size).toBe(0);
  });
});

describe('LintError', () => {
  it('is an Error subclass named LintError', () => {
    const e = new LintError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LintError');
  });
});
