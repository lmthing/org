/**
 * Team-pod caller identity + role gating (team-guard.ts). Offline, deterministic.
 *
 * The guard is the pod half of the team trust boundary: Envoy proves who is
 * calling, this decides what they may do. The properties that matter:
 *   - it is completely inert on a personal pod (no LMTHING_TEAM_MODE);
 *   - a team pod refuses anything that did not come through the edge;
 *   - a viewer can read everything and chat with THING, but cannot change the
 *     workspace — enforced as default-DENY, so a route added later is refused
 *     to viewers until someone decides otherwise.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { guardRequest, guardWebSocket, readCaller, isTeamMode } from './team-guard.js';

function req(
  method: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage;
}

const EDITOR = {
  'x-user-id': 'u1',
  'x-user-email': 'a@example.com',
  'x-team-id': 't1',
  'x-lmthing-role': 'editor',
};
const VIEWER = { ...EDITOR, 'x-lmthing-role': 'viewer' };

describe('team mode off (a personal pod)', () => {
  beforeEach(() => {
    delete process.env['LMTHING_TEAM_MODE'];
  });

  it('is inert — every request passes, with no caller', () => {
    expect(isTeamMode()).toBe(false);
    for (const [m, p] of [
      ['PUT', '/api/env'],
      ['POST', '/api/projects'],
      ['DELETE', '/api/projects/user'],
    ] as const) {
      expect(guardRequest(req(m), p)).toEqual({ ok: true });
    }
    expect(readCaller(req('GET'))).toBeNull();
  });

  it('ignores identity headers a client might send', () => {
    // Without team mode these are meaningless; nothing should start trusting them.
    expect(readCaller(req('GET', EDITOR))).toBeNull();
  });
});

describe('team mode on', () => {
  beforeEach(() => {
    process.env['LMTHING_TEAM_MODE'] = '1';
  });
  afterEach(() => {
    delete process.env['LMTHING_TEAM_MODE'];
  });

  describe('caller identity', () => {
    it('reads the verified claims Envoy projected', () => {
      expect(readCaller(req('GET', EDITOR))).toEqual({
        userId: 'u1',
        email: 'a@example.com',
        teamId: 't1',
        role: 'editor',
      });
    });

    it.each([
      ['no headers at all', {}],
      ['no team', { 'x-user-id': 'u1', 'x-lmthing-role': 'editor' }],
      ['no user', { 'x-team-id': 't1', 'x-lmthing-role': 'editor' }],
      ['unknown role', { ...EDITOR, 'x-lmthing-role': 'admin' }],
      ['empty role', { ...EDITOR, 'x-lmthing-role': '' }],
    ])('rejects a request with %s', (_label, headers) => {
      expect(readCaller(req('GET', headers))).toBeNull();
      // A request that didn't come through the edge gets nothing, not a guess.
      expect(guardRequest(req('GET', headers), '/api/projects')).toMatchObject({
        ok: false,
        status: 401,
      });
    });
  });

  describe('reads', () => {
    it.each([
      '/api/projects',
      '/api/sessions',
      '/api/fs/tree',
      '/api/projects/user/spaces/s1/files',
      '/api/team/channels',
    ])('lets a viewer read %s', (path) => {
      const d = guardRequest(req('GET', VIEWER), path);
      expect(d.ok).toBe(true);
      expect(d.caller?.role).toBe('viewer');
    });

    it('treats HEAD and OPTIONS as reads', () => {
      expect(guardRequest(req('HEAD', VIEWER), '/api/projects').ok).toBe(true);
      expect(guardRequest(req('OPTIONS', VIEWER), '/api/projects').ok).toBe(true);
    });
  });

  describe('what a viewer may still do', () => {
    it.each([
      ['POST', '/api/sessions', 'start a chat with THING'],
      ['POST', '/api/sessions/abc/message', 'send a message in it'],
      ['DELETE', '/api/sessions/abc', 'close it'],
      ['POST', '/api/team/channels/general/messages', 'talk in a channel'],
      ['POST', '/api/uploads', 'attach a file'],
      ['POST', '/api/keepalive', 'keep the pod warm'],
      ['POST', '/api/report-bug', 'report a bug'],
      ['POST', '/app/blog/api/posts', "use a team app's API"],
      ['POST', '/blog/api/posts', "use it on the root mount"],
    ])('%s %s — %s', (method, path) => {
      expect(guardRequest(req(method, VIEWER), path).ok).toBe(true);
    });
  });

  describe('what a viewer may not do', () => {
    it.each([
      ['PUT', '/api/env', "read/write the team's credentials"],
      ['POST', '/api/restart', 'restart the workspace'],
      ['POST', '/api/projects', 'create a project'],
      ['DELETE', '/api/projects/user', 'delete a project'],
      ['PUT', '/api/projects/user/instructions', 'rewrite the instructions'],
      ['POST', '/api/projects/user/documents', 'add a document'],
      ['PUT', '/api/projects/user/spaces/s1/files', 'edit a space'],
      ['POST', '/api/projects/user/spaces/s1/files', 'add a space file'],
      ['DELETE', '/api/projects/user/spaces/s1/files/agent.md', 'delete a space file'],
      ['POST', '/api/spaces', 'create a space'],
      ['PUT', '/api/fs/write', 'write the filesystem'],
      ['POST', '/api/backup', 'trigger a backup'],
      ['POST', '/api/restore', 'restore over the workspace'],
      ['POST', '/api/projects/user/app/build', 'rebuild an app'],
      ['PATCH', '/api/projects/user/app/data/posts/1', "edit an app's data"],
      ['PUT', '/api/projects/user/app/files/pages/Home.tsx', "edit an app's source"],
      ['POST', '/api/projects/user/hooks/daily/run', 'run a hook'],
      ['POST', '/api/apps/install', 'install an app'],
      ['POST', '/api/store/spaces/install', 'install a space'],
      ['POST', '/api/team/channels', 'create a channel'],
    ])('%s %s — cannot %s', (method, path) => {
      const d = guardRequest(req(method, VIEWER), path);
      expect(d.ok).toBe(false);
      expect(d.status).toBe(403);
      // The caller still comes back, so the refusal can be logged/attributed.
      expect(d.caller?.userId).toBe('u1');
    });

    it('denies an unknown mutating route by default', () => {
      // The point of default-deny: a route added later is refused to viewers
      // until someone deliberately allows it.
      expect(guardRequest(req('POST', VIEWER), '/api/some/future/route').ok).toBe(false);
    });
  });

  describe('what an editor may do', () => {
    it.each([
      ['PUT', '/api/env'],
      ['POST', '/api/projects'],
      ['PUT', '/api/projects/user/spaces/s1/files'],
      ['POST', '/api/team/channels'],
      ['POST', '/api/some/future/route'],
    ])('%s %s', (method, path) => {
      expect(guardRequest(req(method, EDITOR), path).ok).toBe(true);
    });
  });

  describe('websockets', () => {
    it('lets both roles open the agent and channel sockets', () => {
      for (const who of [VIEWER, EDITOR]) {
        expect(guardWebSocket(req('GET', who), '/api/ws').ok).toBe(true);
        expect(guardWebSocket(req('GET', who), '/api/team/ws').ok).toBe(true);
      }
    });

    it('refuses a viewer a terminal — that is shell access to the workspace', () => {
      const d = guardWebSocket(req('GET', VIEWER), '/api/terminals/t1');
      expect(d.ok).toBe(false);
      expect(d.status).toBe(403);
      expect(guardWebSocket(req('GET', EDITOR), '/api/terminals/t1').ok).toBe(true);
    });

    it('refuses a socket with no verified caller', () => {
      expect(guardWebSocket(req('GET', {}), '/api/ws')).toMatchObject({
        ok: false,
        status: 401,
      });
    });
  });
});
