/**
 * Store globals (plan S10) — the yield-side contract:
 *   - the three globals push their kinds with the right args,
 *   - the router resolves search/inspect via the host resolver (clear error
 *     when absent),
 *   - `installSpace` runs consent → install → register → republish IN ORDER,
 *     live-registers the installed dir into the shared dynamicSpaces map, and
 *     passes the divergence guard's refusal through as a value,
 *   - the capability gating: `store:read`/`store:install` parse as bare caps and
 *     drive the DTS fragments (not granted ⇒ not declared ⇒ typecheck excludes).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import type { YieldRequest } from '../eval/yield.js';
import type { Space } from '../spaces/load.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { sessionCapabilities } from '../exec/capability.js';
import { parseCapabilities } from '../spaces/capabilities.js';
import {
  createStoreSearchGlobal,
  createStoreInspectGlobal,
  createInstallSpaceGlobal,
  type StoreResolver,
  type InstallSpaceResult,
} from './store.js';

const noopDeferred = { resolve: () => {}, reject: () => {} };
function req(kind: YieldRequest['kind'], args: unknown[]): YieldRequest {
  return { kind, args, deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
}

function baseCtx(over: Partial<YieldRouterContext> = {}): YieldRouterContext {
  return {
    space: {} as Space,
    runDelegate: async () => {
      throw new Error('runDelegate not expected');
    },
    ...over,
  };
}

// ── A real installable space fixture (loadSpace target for live registration) ──

const AGENT_INSTRUCT = `---\ntitle: Helper\nknowledge: []\nfunctions: []\ncomponents: []\n---\n\nYou are the helper agent.\n`;

let fixtureDir: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'lm-store-global-'));
  const spaceDir = join(fixtureDir, 'spaces', 'integration-demo');
  await mkdir(join(spaceDir, 'agents', 'helper'), { recursive: true });
  await writeFile(join(spaceDir, 'agents', 'helper', 'instruct.md'), AGENT_INSTRUCT, 'utf8');
  await writeFile(
    join(spaceDir, 'package.json'),
    JSON.stringify({ name: 'integration-demo', version: '1.0.0', private: true }),
    'utf8',
  );
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

const installedDir = () => join(fixtureDir, 'spaces', 'integration-demo');

describe('store globals — yield shapes', () => {
  it('storeSearch pushes its kind with the query and resolves via the deferred', async () => {
    const yields: YieldRequest[] = [];
    const p = createStoreSearchGlobal((r) => yields.push(r))('slack');
    expect(yields[0]!.kind).toBe('storeSearch');
    expect(yields[0]!.args).toEqual(['slack']);
    yields[0]!.deferred.resolve([{ id: 'integration-slack' }]);
    expect(await p).toEqual([{ id: 'integration-slack' }]);
  });

  it('storeInspect pushes its kind with the spaceId', () => {
    const yields: YieldRequest[] = [];
    void createStoreInspectGlobal((r) => yields.push(r))('integration-demo');
    expect(yields[0]!.kind).toBe('storeInspect');
    expect(yields[0]!.args).toEqual(['integration-demo']);
  });

  it('installSpace pushes its kind with the spaceId', () => {
    const yields: YieldRequest[] = [];
    void createInstallSpaceGlobal((r) => yields.push(r))('integration-demo');
    expect(yields[0]!.kind).toBe('installSpace');
    expect(yields[0]!.args).toEqual(['integration-demo']);
  });
});

describe('yield router — storeSearch / storeInspect', () => {
  it('resolves catalog entries via the resolver, passing entries through verbatim', async () => {
    const entry = { id: 'a', title: 'A', events: { 'x.y': { payload: {} } }, extra: 'S12-enrichment' };
    const store: StoreResolver = {
      search: async (q) => [{ ...entry, q }],
      inspect: async () => entry,
      install: async () => ({ ok: false, spaceId: 'a' }),
    };
    const s = await routeCommonYield(req('storeSearch', ['a']), baseCtx({ storeResolver: store }));
    expect(s).toEqual({ handled: true, value: [{ ...entry, q: 'a' }] });
    const i = await routeCommonYield(req('storeInspect', ['a']), baseCtx({ storeResolver: store }));
    expect(i).toEqual({ handled: true, value: entry });
  });

  it('rejects with a clear error when no resolver is configured', async () => {
    await expect(routeCommonYield(req('storeSearch', [undefined]), baseCtx())).rejects.toThrow(
      /storeSearch is not available here/,
    );
    await expect(routeCommonYield(req('storeInspect', ['a']), baseCtx())).rejects.toThrow(
      /storeInspect is not available here/,
    );
  });
});

describe('yield router — installSpace (consent → install → register → republish)', () => {
  function orderedResolver(order: string[], result?: Partial<ReturnType<StoreResolver['install']> extends Promise<infer T> ? T : never>): StoreResolver {
    return {
      search: async () => [],
      inspect: async () => undefined,
      install: async (spaceId) => {
        order.push('install');
        return { ok: true, spaceId, projectId: 'user', installedDir: installedDir(), ...result };
      },
      republish: async () => {
        order.push('republish');
      },
    };
  }

  it('runs the four steps in order and live-registers into dynamicSpaces', async () => {
    const order: string[] = [];
    const dynamicSpaces = new Map<string, Space>();
    // Registration order is observed via the map mutation between install & republish.
    const store = orderedResolver(order);
    const origSet = dynamicSpaces.set.bind(dynamicSpaces);
    dynamicSpaces.set = (k, v) => {
      order.push('register');
      return origSet(k, v);
    };

    const r = await routeCommonYield(
      req('installSpace', ['integration-demo']),
      baseCtx({
        storeResolver: store,
        dynamicSpaces,
        requestConsent: async () => {
          order.push('consent');
          return true;
        },
      }),
    );

    expect(order).toEqual(['consent', 'install', 'register', 'republish']);
    expect(r.handled).toBe(true);
    const value = (r as { value: InstallSpaceResult }).value;
    expect(value.ok).toBe(true);
    expect(value.spaceId).toBe('integration-demo');
    expect(value.projectId).toBe('user');
    expect(value.spaceKey).toBe(installedDir());
    expect(value.agentSlug).toBe('helper');
    // The registered space is reachable by the session's later delegate().
    expect(dynamicSpaces.has(installedDir())).toBe(true);
  });

  it('passes the divergence guard through as ok:false (no register, no republish)', async () => {
    const order: string[] = [];
    const store: StoreResolver = {
      search: async () => [],
      inspect: async () => undefined,
      install: async (spaceId) => {
        order.push('install');
        return { ok: false, spaceId, projectId: 'user', diverged: true, message: 'local edits — pass force' };
      },
      republish: async () => {
        order.push('republish');
      },
    };
    const dynamicSpaces = new Map<string, Space>();
    const r = await routeCommonYield(
      req('installSpace', ['integration-demo']),
      baseCtx({ storeResolver: store, dynamicSpaces, requestConsent: async () => true }),
    );
    expect(r).toEqual({
      handled: true,
      value: {
        ok: false,
        spaceId: 'integration-demo',
        projectId: 'user',
        diverged: true,
        message: 'local edits — pass force',
      },
    });
    expect(dynamicSpaces.size).toBe(0);
    expect(order).toEqual(['install']); // no register step, no republish
  });

  it('a completed install is still ok when live registration fails (bad dir)', async () => {
    const store: StoreResolver = {
      search: async () => [],
      inspect: async () => undefined,
      install: async (spaceId) => ({ ok: true, spaceId, installedDir: join(fixtureDir, 'no-such-dir') }),
    };
    const r = await routeCommonYield(
      req('installSpace', ['integration-demo']),
      baseCtx({ storeResolver: store, requestConsent: async () => true }),
    );
    const value = (r as { value: InstallSpaceResult }).value;
    expect(value.ok).toBe(true);
    expect(value.spaceKey).toBeUndefined();
    expect(value.error).toMatch(/live registration failed/);
  });
});

describe('capability gating — store:read / store:install', () => {
  it('parse as bare capabilities (config rejected)', () => {
    const caps = parseCapabilities(['store:read', 'store:install'], { agentId: 'a' });
    expect(caps['store:read']).toBe(true);
    expect(caps['store:install']).toBe(true);
    expect(() => parseCapabilities([{ 'store:read': { x: 1 } }], { agentId: 'a' })).toThrow(/bare only/);
  });

  it('DTS declares the globals ONLY under their grants (typecheck excludes otherwise)', () => {
    const withRead = buildAmbientDts({ capabilities: sessionCapabilities(true, { 'store:read': true }) });
    expect(withRead).toContain('declare function storeSearch');
    expect(withRead).toContain('declare function storeInspect');
    expect(withRead).not.toContain('declare function installSpace');

    const withInstall = buildAmbientDts({ capabilities: sessionCapabilities(true, { 'store:install': true }) });
    expect(withInstall).toContain('declare function installSpace');
    expect(withInstall).not.toContain('declare function storeSearch');

    const none = buildAmbientDts({ capabilities: sessionCapabilities(true, {}) });
    expect(none).not.toContain('storeSearch');
    expect(none).not.toContain('installSpace');
  });
});
