/**
 * The emitter-def scanner (`emitter-manifests.ts`) — the PRODUCER-side discovery
 * seam, worker-isolated by design (store code never runs on the main thread).
 * Exercises, against scratch `events/` trees:
 *   - cache invalidation on an events file's mtime change AND on add/remove
 *   - SPACE env containment: a def naming a non-namespaced secretEnv is
 *     dropped-with-warn; a properly-namespaced one is honored
 *   - PROJECT defs need no namespace but their env refs are recorded for audit
 *   - HOSTILE defs are contained by the worker: a top-level infinite loop is
 *     killed by the wall-clock timeout, a top-level fs probe stays in the worker
 *     — the scan survives, drops the bad def, and still extracts its siblings
 *   - duplicate event names fail the whole scope (authoring clarity)
 *   - a valid multi-def space extracts every def
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEmitterDefs, clearEmitterDefCache } from './emitter-manifests.js';

const PROJECT = 'proj';
let root: string;

/** Write `<root>/<proj>/events/<name>.ts` (scope 'project') or
 *  `<root>/<proj>/spaces/<scope>/events/<name>.ts` (a space scope). */
function writeEvent(scope: string, name: string, source: string): string {
  const dir = scope === 'project' ? join(root, PROJECT, 'events') : join(root, PROJECT, 'spaces', scope, 'events');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, source);
  return file;
}

/** A minimal, valid webhook def source (builtin verify names no env). */
function webhookDef(path: string, event: string, extra = ''): string {
  return `export default {
  type: 'webhook',
  path: ${JSON.stringify(path)},
  verify: { type: 'builtin', provider: 'slack' },
  ${extra}
  emits: { ${JSON.stringify(event)}: { payload: { text: 'string' } } },
  emit(inbound) { return [{ event: ${JSON.stringify(event)}, payload: { text: 'hi' } }]; },
};`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lm-emit-'));
  clearEmitterDefCache();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearEmitterDefCache();
  vi.restoreAllMocks();
  delete process.env['LMTHING_EMITTER_SCAN_TIMEOUT_MS'];
});

describe('scanEmitterDefs — discovery', () => {
  it('extracts a project def, data-only (no emit function survives)', async () => {
    writeEvent('project', 'orders', webhookDef('orders-inbound', 'order.created'));
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    expect(Object.keys(scopes)).toEqual(['project']);
    expect(scopes['project']!.defs).toHaveLength(1);
    const d = scopes['project']!.defs[0]!;
    expect(d.name).toBe('orders');
    expect(d.scope).toBe('project');
    expect(d.def.type).toBe('webhook');
    expect((d.def as { path: string }).path).toBe('orders-inbound');
    expect((d.def as Record<string, unknown>)['emit']).toBeUndefined(); // never extracted
    expect(scopes['project']!.declaredEvents['order.created']).toEqual({ payload: { text: 'string' } });
    expect(d.file).toContain('events'); // file path recorded for later emit
  });

  it('returns no scopes for a project with no events dirs', async () => {
    mkdirSync(join(root, PROJECT), { recursive: true });
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    expect(scopes).toEqual({});
  });

  it('extracts every def of a valid multi-def space (distinct paths)', async () => {
    writeEvent('integration-slack', 'events', webhookDef('slack-events', 'message.posted'));
    // A second def with a properly-namespaced secret (hmac) — namespaced env is allowed.
    writeEvent(
      'integration-slack',
      'commands',
      `export default {
        type: 'webhook',
        path: 'slack-cmds',
        verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-slack-signature' },
        secretEnv: 'INTEGRATION_SLACK_CMD_SECRET',
        emits: { 'command.invoked': { payload: { cmd: 'string' } } },
        emit(i) { return []; },
      };`,
    );
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    const scope = scopes['integration-slack']!;
    expect(scope.defs.map((d) => d.name).sort()).toEqual(['commands', 'events']);
    expect(Object.keys(scope.declaredEvents).sort()).toEqual(['command.invoked', 'message.posted']);
    expect(scope.envRefs).toEqual(['INTEGRATION_SLACK_CMD_SECRET']); // namespaced env recorded
  });
});

describe('scanEmitterDefs — cache invalidation', () => {
  it('refreshes when an events file mtime changes, and when a file is added/removed', async () => {
    const file = writeEvent('project', 'a', webhookDef('path-a', 'evt.a'));
    expect((await scanEmitterDefs(root, PROJECT)).scopes['project']!.defs[0]!.def).toMatchObject({ path: 'path-a' });

    // Edit the SAME file (bump mtime explicitly — two writes can share a ms).
    writeFileSync(file, webhookDef('path-b', 'evt.b'));
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    expect((await scanEmitterDefs(root, PROJECT)).scopes['project']!.defs[0]!.def).toMatchObject({ path: 'path-b' });

    // Add a second file — the file SET changed → invalidate.
    writeEvent('project', 'b', webhookDef('path-c', 'evt.c'));
    expect((await scanEmitterDefs(root, PROJECT)).scopes['project']!.defs).toHaveLength(2);

    // Remove a file — the set changed again → invalidate.
    rmSync(join(root, PROJECT, 'events', 'b.ts'));
    expect((await scanEmitterDefs(root, PROJECT)).scopes['project']!.defs).toHaveLength(1);
  });
});

describe('scanEmitterDefs — env containment', () => {
  it('DROPS a space def naming a non-namespaced (system) secret, with a warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeEvent(
      'integration-evil',
      'steal',
      `export default {
        type: 'webhook',
        path: 'evil-inbound',
        verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-sig' },
        secretEnv: 'LMTHINGCLOUD_API_KEY',
        emits: { 'evt.one': { payload: { a: 'string' } } },
        emit(i) { return []; },
      };`,
    );
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    // The scope exists (dir has a .ts) but the def was dropped → empty.
    expect(scopes['integration-evil']!.defs).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LMTHINGCLOUD_API_KEY'));
  });

  it('ALLOWS a PROJECT def without a namespace and RECORDS its env refs', async () => {
    writeEvent(
      'project',
      'stripe',
      `export default {
        type: 'webhook',
        path: 'stripe-events',
        verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'stripe-signature' },
        secretEnv: 'STRIPE_SIGNING_SECRET',
        emits: { 'payment.succeeded': { payload: { id: 'string' } } },
        emit(i) { return []; },
      };`,
    );
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    expect(scopes['project']!.defs).toHaveLength(1); // project = user trust domain, no namespace gate
    expect(scopes['project']!.envRefs).toEqual(['STRIPE_SIGNING_SECRET']); // recorded for audit/UI
  });
});

describe('scanEmitterDefs — a duplicate event is ISOLATED, not scope-fatal', () => {
  it('keeps the FIRST def and drops only the later duplicate, with a warn (the scope stays alive)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Deterministic sorted order: "one" < "two" → "one" is kept, "two" dropped.
    writeEvent('integration-dup', 'one', webhookDef('dup-a', 'dup.event'));
    writeEvent('integration-dup', 'two', webhookDef('dup-b', 'dup.event'));
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    // The scope is NOT wiped — the first def survives and its declared event stays live.
    expect(scopes['integration-dup']!.defs.map((d) => d.name)).toEqual(['one']);
    expect(scopes['integration-dup']!.declaredEvents).toHaveProperty('dup.event');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropping def "two".*re-declares event "dup\.event".*"one"/));
  });

  it('a redundant second db emitter never disables the first — the project event still fires', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dbDef = (name: string) =>
      `export default { type: 'db', on: { table: 'tips', event: 'insert' }, emits: { 'tip.added': { payload: { id: 'string' } } }, emit(row) { return [{ event: 'tip.added', payload: { id: String(row.row.id) } }]; } };`;
    writeEvent('project', 'a-tip-writes', dbDef('a-tip-writes'));
    writeEvent('project', 'b-tips-db-events', dbDef('b-tips-db-events'));
    const { scopes } = await scanEmitterDefs(root, PROJECT);
    // Scenario 01 regression: the project scope keeps ONE tip.added emitter (the first),
    // so project/tip.added still fires and the summary agent-trigger hook stays reachable.
    expect(scopes['project']!.defs.map((d) => d.name)).toEqual(['a-tip-writes']);
    expect(scopes['project']!.declaredEvents).toHaveProperty('tip.added');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropping def "b-tips-db-events"/));
  });
});

describe('scanEmitterDefs — hostile defs are contained by the worker', () => {
  it('kills a top-level infinite loop by timeout and drops it — siblings survive', async () => {
    process.env['LMTHING_EMITTER_SCAN_TIMEOUT_MS'] = '500'; // keep the test fast
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Hostile: never returns → never posts a result → main-side timeout terminates it.
    writeEvent('project', 'loop', `while (true) {}\nexport default { type: 'webhook', path: 'x', verify: { type: 'none' }, emits: { 'a.b': { payload: {} } }, emit(i) { return []; } };`);
    // A well-behaved sibling in a DIFFERENT scope proves the pod process is unharmed.
    writeEvent('integration-ok', 'ok', webhookDef('ok-inbound', 'ok.event'));

    const { scopes } = await scanEmitterDefs(root, PROJECT);
    expect(scopes['project']!.defs).toHaveLength(0); // hostile dropped
    expect(scopes['integration-ok']!.defs).toHaveLength(1); // sibling extracted fine
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/timed out/));
  }, 15000);

  it('contains a top-level fs probe in the worker and drops the def — siblings survive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Hostile: pokes the filesystem then blows up at module top-level. The read
    // (whatever it does) happens INSIDE the isolated worker; the ENOENT throw
    // propagates only to the worker, which posts an error → def dropped.
    writeEvent(
      'project',
      'probe',
      `const fs = require('node:fs');\nfs.readFileSync('/nonexistent-lmthing-hostile-probe');\nexport default { type: 'webhook', path: 'p', verify: { type: 'none' }, emits: { 'a.b': { payload: {} } }, emit(i) { return []; } };`,
    );
    writeEvent('integration-ok', 'ok', webhookDef('ok-inbound', 'ok.event'));

    const { scopes } = await scanEmitterDefs(root, PROJECT);
    expect(scopes['project']!.defs).toHaveLength(0); // hostile dropped (worker-contained)
    expect(scopes['integration-ok']!.defs).toHaveLength(1); // scan survived
    expect(warn).toHaveBeenCalled();
  });
});
