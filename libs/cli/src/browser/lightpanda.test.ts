import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  findLightpandaBinary,
  lightpandaServeArgs,
  autostartDisabled,
  pingLightpanda,
  ensureLightpanda,
} from './lightpanda.js';

describe('findLightpandaBinary', () => {
  it('honors an explicit LIGHTPANDA_BIN that exists', () => {
    const bin = findLightpandaBinary({ LIGHTPANDA_BIN: '/opt/lp/lightpanda' }, (p) => p === '/opt/lp/lightpanda');
    expect(bin).toBe('/opt/lp/lightpanda');
  });

  it('returns undefined when LIGHTPANDA_BIN is set but missing', () => {
    const bin = findLightpandaBinary({ LIGHTPANDA_BIN: '/nope/lightpanda' }, () => false);
    expect(bin).toBeUndefined();
  });

  it('searches PATH for a lightpanda binary', () => {
    const env = { PATH: ['/usr/bin', '/home/me/bin'].join(':') };
    const bin = findLightpandaBinary(env, (p) => p === '/home/me/bin/lightpanda');
    expect(bin).toBe('/home/me/bin/lightpanda');
  });

  it('returns undefined when nothing is on PATH', () => {
    expect(findLightpandaBinary({ PATH: '/usr/bin' }, () => false)).toBeUndefined();
  });
});

describe('lightpandaServeArgs', () => {
  it('builds serve argv exposing CDP + MCP on one port', () => {
    expect(lightpandaServeArgs('127.0.0.1', 9223)).toEqual(['serve', '--host', '127.0.0.1', '--port', '9223']);
  });
});

describe('autostartDisabled', () => {
  it('is off by default (undefined)', () => {
    expect(autostartDisabled(undefined)).toBe(false);
  });
  it.each(['0', 'false', 'no', 'off', ''])('treats %s as opt-out', (v) => {
    expect(autostartDisabled(v)).toBe(true);
  });
  it.each(['1', 'true', 'yes'])('treats %s as opt-in', (v) => {
    expect(autostartDisabled(v)).toBe(false);
  });
});

describe('pingLightpanda', () => {
  it('POSTs a tools/list JSON-RPC probe and returns ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    expect(await pingLightpanda('http://127.0.0.1:9223', fetchImpl)).toBe(true);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
  });

  it('returns false when the endpoint throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await pingLightpanda('http://127.0.0.1:9223', fetchImpl)).toBe(false);
  });
});

describe('ensureLightpanda', () => {
  it('uses an external LIGHTPANDA_MCP_URL without spawning', async () => {
    const spawn = vi.fn();
    const r = await ensureLightpanda({ env: { LIGHTPANDA_MCP_URL: 'http://host:9223' }, spawn: spawn as never });
    expect(r).toEqual({ url: 'http://host:9223', spawned: false, reason: 'external' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not spawn when no binary is resolvable', async () => {
    const spawn = vi.fn();
    const r = await ensureLightpanda({ env: { PATH: '/usr/bin' }, spawn: spawn as never, exists: () => false });
    expect(r.reason).toBe('no-binary');
    expect(r.spawned).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('respects LIGHTPANDA_AUTOSTART=0', async () => {
    const spawn = vi.fn();
    const r = await ensureLightpanda({
      env: { LIGHTPANDA_BIN: '/opt/lightpanda', LIGHTPANDA_AUTOSTART: '0' },
      spawn: spawn as never,
      exists: () => true,
    });
    expect(r.reason).toBe('autostart-disabled');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns lightpanda serve and publishes the endpoint once ready', async () => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void };
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    const env: NodeJS.ProcessEnv = { LIGHTPANDA_BIN: '/opt/lightpanda' };
    // Not ready on the first poll, ready on the second.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 }) as unknown as typeof fetch;

    const r = await ensureLightpanda({
      env,
      spawn: spawn as never,
      exists: () => true,
      fetchImpl,
      sleep: async () => {},
      pollIntervalMs: 1,
      readyTimeoutMs: 100,
    });

    expect(spawn).toHaveBeenCalledWith('/opt/lightpanda', ['serve', '--host', '127.0.0.1', '--port', '9223'], { stdio: 'ignore' });
    expect(r).toMatchObject({ url: 'http://127.0.0.1:9223', spawned: true, reason: 'spawned' });
    expect(env['LIGHTPANDA_MCP_URL']).toBe('http://127.0.0.1:9223');
  });

  it('reports spawn-not-ready when the server never answers in time', async () => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void };
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const r = await ensureLightpanda({
      env: { LIGHTPANDA_BIN: '/opt/lightpanda' },
      spawn: spawn as never,
      exists: () => true,
      fetchImpl,
      sleep: async () => {},
      pollIntervalMs: 10,
      readyTimeoutMs: 30,
    });
    expect(r.reason).toBe('spawn-not-ready');
  });
});
