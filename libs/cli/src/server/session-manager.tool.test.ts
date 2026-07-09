/**
 * SessionManager `tool()` wiring — the pod-only increment that dispatches an
 * agent's `tool('x', input)` call to a loaded OpenClaw `PluginRegistry`
 * (`setToolRegistry`, called from `serve.ts` after `loadOpenClawPlugins`
 * resolves; see `server/openclaw-host.ts`).
 *
 * Exercises the private `withTools` fold directly (same pattern
 * `session-manager.spawn.test.ts` uses to reach `getProjectContracts`) since
 * `withTools` is only applied inside `defaultBuildSession` — a caller-supplied
 * `buildSession` (as most tests use to avoid a real Session/VM) bypasses it,
 * same as the existing `withConnections` fold.
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '@lmthing/openclaw-compat';
import type { RegisteredTool } from '@lmthing/openclaw-compat';
import type { AppGlobalImpls } from '@lmthing/core';
import { SessionManager } from './session-manager.js';

function makeEchoTool(name: string): RegisteredTool {
  return {
    name,
    execute: async (callId, params) => ({
      content: [{ type: 'text', text: `${callId}:${JSON.stringify(params)}` }],
    }),
  };
}

/** Reach the private `withTools(appGlobals)` fold for direct unit coverage. */
function withToolsOf(manager: SessionManager): (appGlobals?: AppGlobalImpls) => AppGlobalImpls | undefined {
  return (manager as unknown as { withTools: (a?: AppGlobalImpls) => AppGlobalImpls | undefined }).withTools.bind(
    manager,
  );
}

describe('SessionManager tool() wiring', () => {
  it('with no registry set, withTools leaves appGlobals untouched (no tool field)', () => {
    const manager = new SessionManager({ streamFn: (async function* () {})() as never });
    expect(withToolsOf(manager)(undefined)).toBeUndefined();
    expect(withToolsOf(manager)({ apiCall: async () => 'x' })?.tool).toBeUndefined();
  });

  it('setToolRegistry(...) makes withTools attach a tool() that dispatches to the registered tool', async () => {
    const manager = new SessionManager({ streamFn: (async function* () {})() as never });
    const registry = new PluginRegistry();
    registry.addTool(makeEchoTool('echo'));
    manager.setToolRegistry(registry);

    const globals = withToolsOf(manager)(undefined);
    expect(typeof globals?.tool).toBe('function');

    const result = await globals!.tool!('echo', { q: 'lmthing' });
    expect(result).toEqual({ content: [{ type: 'text', text: expect.stringContaining('"q":"lmthing"') }] });
  });

  it('dispatching an unregistered tool name throws (fail loud, no silent undefined)', async () => {
    const manager = new SessionManager({ streamFn: (async function* () {})() as never });
    manager.setToolRegistry(new PluginRegistry());
    const globals = withToolsOf(manager)(undefined);
    await expect(globals!.tool!('nope', {})).rejects.toThrow(/tool\("nope"\) not found/);
  });

  it('does not clobber an already-set appGlobals.tool (project-supplied wins)', async () => {
    const manager = new SessionManager({ streamFn: (async function* () {})() as never });
    const registry = new PluginRegistry();
    registry.addTool(makeEchoTool('echo'));
    manager.setToolRegistry(registry);

    const ownResolver = async () => 'project-supplied';
    const globals = withToolsOf(manager)({ tool: ownResolver });
    expect(globals?.tool).toBe(ownResolver);
  });
});
