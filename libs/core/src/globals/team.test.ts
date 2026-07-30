/**
 * Team globals — the capability + yield-side contract:
 *   - `team:read`/`team:post` are TEAM-POD-ONLY grants: on a personal pod they are
 *     dropped at parse time, so nothing is injected and nothing is declared,
 *   - the two ids are separately gated (read without post, post without read) and
 *     drive their own DTS fragments,
 *   - a read-only fork role keeps `team:read` and loses `team:post`,
 *   - the six globals push their kinds with the right args and the router
 *     forwards each to the matching resolver method (clear error when absent).
 *
 * The identity half — who may read a DM, who may post — is enforced HOST-side and
 * tested against the real resolver in
 * `libs/cli/src/server/team-globals.test.ts`; core only proves that it cannot be
 * addressed from the sandbox (no identity ever appears in a yield's args).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import type { YieldRequest } from '../eval/yield.js';
import type { Space } from '../spaces/load.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { sessionCapabilities, forkCapabilities } from '../exec/capability.js';
import { parseCapabilities, isTeamPod } from '../spaces/capabilities.js';
import {
  createTeamContextGlobal,
  createTeamMembersGlobal,
  createTeamChannelsGlobal,
  createTeamHistoryGlobal,
  createTeamPostGlobal,
  createTeamPinAppGlobal,
  type TeamResolver,
} from './team.js';

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

/** Record every call so we can assert the router forwarded the right one. */
function recordingResolver(): { resolver: TeamResolver; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const resolver = {
    context: async () => (calls.push(['context', []]), { teamId: 't', channelId: 'general', channelName: 'general', channelKind: 'channel' as const, caller: { userId: 'u1', role: 'editor' as const } }),
    members: async () => (calls.push(['members', []]), []),
    channels: async () => (calls.push(['channels', []]), []),
    history: async (...a: unknown[]) => (calls.push(['history', a]), { messages: [], hasMore: false, channelId: 'general', channelName: 'general', returned: 0, limit: 30 }),
    post: async (...a: unknown[]) => (calls.push(['post', a]), { ok: true, channelId: 'general', messageId: 'm1' }),
    pinApp: async (...a: unknown[]) => (calls.push(['pinApp', a]), { ok: true, channelId: 'general', apps: ['blog'] }),
  } as unknown as TeamResolver;
  return { resolver, calls };
}

const TEAM_ENV = 'LMTHING_TEAM_MODE';
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[TEAM_ENV];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[TEAM_ENV];
  else process.env[TEAM_ENV] = savedEnv;
});

describe('team capabilities are team-pod only', () => {
  it('isTeamPod tracks LMTHING_TEAM_MODE exactly', () => {
    process.env[TEAM_ENV] = '1';
    expect(isTeamPod()).toBe(true);
    process.env[TEAM_ENV] = '0';
    expect(isTeamPod()).toBe(false);
    delete process.env[TEAM_ENV];
    expect(isTeamPod()).toBe(false);
  });

  it('grants the caps on a TEAM pod (bare; a config is rejected)', () => {
    process.env[TEAM_ENV] = '1';
    const caps = parseCapabilities(['team:read', 'team:post'], { agentId: 'thing' });
    expect(caps['team:read']).toBe(true);
    expect(caps['team:post']).toBe(true);
    expect(() => parseCapabilities([{ 'team:read': { channels: ['general'] } }], { agentId: 'thing' })).toThrow(
      /bare only/,
    );
  });

  it('DROPS the caps on a PERSONAL pod — same frontmatter, no grant, no error', () => {
    delete process.env[TEAM_ENV];
    const caps = parseCapabilities(['db:read', 'team:read', 'team:post'], { agentId: 'thing' });
    expect(caps['team:read']).toBeUndefined();
    expect(caps['team:post']).toBeUndefined();
    // Everything else survives — the drop is surgical, not a whole-list refusal.
    expect(caps['db:read']).toEqual({});
  });

  it('validates a malformed team cap on EVERY pod, so it cannot hide until prod', () => {
    delete process.env[TEAM_ENV];
    expect(() => parseCapabilities([{ 'team:post': { channels: [] } }], { agentId: 'thing' })).toThrow(
      /bare only/,
    );
    expect(() => parseCapabilities(['team:write'], { agentId: 'thing' })).toThrow(
      /unknown capability "team:write"/,
    );
  });
});

describe('team DTS — not granted ⇒ not declared', () => {
  it('declares the READERS only under team:read', () => {
    const dts = buildAmbientDts({ capabilities: sessionCapabilities(true, { 'team:read': true }) });
    expect(dts).toContain('declare function teamContext');
    expect(dts).toContain('declare function teamMembers');
    expect(dts).toContain('declare function teamChannels');
    expect(dts).toContain('declare function teamHistory');
    expect(dts).not.toContain('declare function teamPost');
    expect(dts).not.toContain('declare function teamPinApp');
  });

  it('declares the WRITERS only under team:post', () => {
    const dts = buildAmbientDts({ capabilities: sessionCapabilities(true, { 'team:post': true }) });
    expect(dts).toContain('declare function teamPost');
    expect(dts).toContain('declare function teamPinApp');
    // No DM writer exists on the model surface at all — THING has no user id, so
    // there is no honest way for it to be a participant in a direct message.
    expect(dts).not.toContain('teamDM');
    expect(dts).not.toContain('declare function teamMembers');
  });

  it('declares NONE of them with no grant — a personal pod DTS', () => {
    const dts = buildAmbientDts({ capabilities: sessionCapabilities(true, {}) });
    for (const name of ['teamContext', 'teamMembers', 'teamChannels', 'teamHistory', 'teamPost', 'teamPinApp']) {
      expect(dts).not.toContain(name);
    }
  });

  it('an explore fork keeps the readers and LOSES the writers', () => {
    const caps = forkCapabilities('explore', false, { 'team:read': true, 'team:post': true });
    expect(caps.app['team:read']).toBe(true);
    expect(caps.app['team:post']).toBeUndefined();
    const dts = buildAmbientDts({ capabilities: caps });
    expect(dts).toContain('declare function teamHistory');
    expect(dts).not.toContain('declare function teamPost');
  });

  it('a general fork keeps both', () => {
    const caps = forkCapabilities('general', false, { 'team:read': true, 'team:post': true });
    expect(caps.app['team:post']).toBe(true);
  });
});

describe('team yields route to the resolver', () => {
  it('forwards each global to its resolver method with the sandbox args', async () => {
    const { resolver, calls } = recordingResolver();
    const ctx = baseCtx({ teamResolver: resolver });
    const pushed: YieldRequest[] = [];
    const push = (r: YieldRequest): void => void pushed.push(r);

    void createTeamContextGlobal(push)();
    void createTeamMembersGlobal(push)();
    void createTeamChannelsGlobal(push)();
    void createTeamHistoryGlobal(push)('general', { limit: 10 });
    void createTeamPostGlobal(push)('design', 'hello', { threadId: 'thr' });
    void createTeamPinAppGlobal(push)('general', 'blog');

    expect(pushed.map((p) => p.kind)).toEqual([
      'teamContext',
      'teamMembers',
      'teamChannels',
      'teamHistory',
      'teamPost',
      'teamPinApp',
    ]);
    for (const p of pushed) await routeCommonYield(p, ctx);

    expect(calls.map(([name]) => name)).toEqual([
      'context',
      'members',
      'channels',
      'history',
      'post',
      'pinApp',
    ]);
    expect(calls[3]).toEqual(['history', ['general', { limit: 10 }]]);
    expect(calls[4]).toEqual(['post', ['design', 'hello', { threadId: 'thr' }]]);
    expect(calls[5]).toEqual(['pinApp', ['general', 'blog']]);
  });

  it('carries NO identity in its args — the caller is never sandbox-supplied', () => {
    const pushed: YieldRequest[] = [];
    const push = (r: YieldRequest): void => void pushed.push(r);
    void createTeamContextGlobal(push)();
    void createTeamPostGlobal(push)('design', 'hello');
    // Nothing a model writes can name a user, a role or a team: the globals take
    // channel/text/ids only, so the resolver's closed-over caller is the ONLY
    // identity in play.
    expect(pushed[0]!.args).toEqual([]);
    expect(pushed[1]!.args).toEqual(['design', 'hello', undefined]);
  });

  it('says WHY when the turn has no team context, instead of failing obscurely', async () => {
    for (const kind of ['teamContext', 'teamHistory', 'teamPost'] as const) {
      await expect(routeCommonYield(req(kind, ['general']), baseCtx())).rejects.toThrow(
        /not running in a team channel/,
      );
    }
  });
});
