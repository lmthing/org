/**
 * `<Chat>` non-visual logic — the pieces that carry the pod chat protocol.
 *
 * Runs under the root node vitest runner (no jsdom), so we test the pure helpers
 * + the reused `@lmthing/ui` round-trip machinery with `fetch` mocked, rather
 * than rendering the component. This covers the three protocol-critical shapes:
 *   - the `POST /api/sessions` body (`{ spaceRef, projectId }`),
 *   - the same-origin base → WS url derivation from `window.location`,
 *   - the `ask` answer round-trip (`POST …/ask/:id { value }`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The reused chat client — imported from its source (not the `@lmthing/ui/chat`
// package specifier, which only resolves inside the pages esbuild build) so we
// can assert the exact message shapes `<Chat>` relies on.
import { ReplRpcClient } from '../../../../ui/src/chat/client/rpc-client.js';

import {
  resolveProjectId,
  sessionCreateBody,
  originBase,
  createChatSession,
} from './chat-protocol.js';

function mockFetch(status = 200, body: unknown = { sessionId: 'sess-1' }): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveProjectId', () => {
  it('takes the <project> segment of the …/app/<project> prefix', () => {
    expect(resolveProjectId('/app/feed/items/5')).toBe('feed');
    expect(resolveProjectId('/studio/app/notes')).toBe('notes');
  });

  it('honours the __APP_BASE__ / override (the /app-stripped host)', () => {
    expect(resolveProjectId('/blog/post/3', '/blog')).toBe('blog');
  });

  it('is "" when there is no /app/<project> prefix', () => {
    expect(resolveProjectId('/random/path')).toBe('');
  });
});

describe('sessionCreateBody', () => {
  it('is the Phase 7A { spaceRef, projectId } shape for a project space agent', () => {
    expect(sessionCreateBody('cooking/chef', 'feed')).toEqual({
      spaceRef: 'cooking/chef',
      projectId: 'feed',
    });
  });

  // A bare slug is the project's OWN top-level agent (THING), not a project space — the sessions
  // route resolves it by `agentSlug`. Sending it as a `spaceRef` would look for a project space
  // named "thing" and fail, so an app-embedded chat could never reach the authoring agent.
  it('is the { agentSlug, projectId } shape for the project agent (in-app THING)', () => {
    expect(sessionCreateBody('thing', 'life-admin')).toEqual({
      agentSlug: 'thing',
      projectId: 'life-admin',
    });
  });
});

describe('originBase / WS url derivation', () => {
  it('is protocol//host, and ReplRpcClient turns it into wss://host/api/ws', () => {
    const base = originBase({ protocol: 'https:', host: 'lmthing.studio' });
    expect(base).toBe('https://lmthing.studio');
    // The reused rpc client swaps the scheme http→ws: https → wss.
    const wsBase = base.replace(/^http/, 'ws');
    expect(`${wsBase}/api/ws?sessionId=sess-1`).toBe('wss://lmthing.studio/api/ws?sessionId=sess-1');
  });

  it('preserves an insecure origin (http → ws)', () => {
    expect(originBase({ protocol: 'http:', host: 'localhost:8080' }).replace(/^http/, 'ws')).toBe(
      'ws://localhost:8080',
    );
  });
});

describe('createChatSession', () => {
  it('POSTs { spaceRef, projectId } to <base>/api/sessions and returns the sessionId', async () => {
    const fetchFn = mockFetch(200, { sessionId: 'sess-42' });
    const sid = await createChatSession('cooking/chef', 'feed', 'https://lmthing.studio');
    expect(sid).toBe('sess-42');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lmthing.studio/api/sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ spaceRef: 'cooking/chef', projectId: 'feed' });
  });

  it('sends Authorization: Bearer when an access token is supplied (JWT-gated /api/*)', async () => {
    const fetchFn = mockFetch(200, { sessionId: 's' });
    await createChatSession('a/b', 'blog', 'https://lmthing.app', 'tok-abc');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-abc');
  });

  it('omits Authorization when no token (local/no-auth direct pod)', async () => {
    const fetchFn = mockFetch(200, { sessionId: 's' });
    await createChatSession('a/b', 'blog', 'https://x');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('throws on a non-2xx response', async () => {
    mockFetch(500, { error: 'boom' });
    await expect(createChatSession('a/b', 'p', 'https://x')).rejects.toThrow(/session create failed: 500/);
  });
});

describe('ask round-trip (reused ReplRpcClient)', () => {
  it('submitForm POSTs { value } to /api/sessions/:id/ask/:askId', async () => {
    const fetchFn = mockFetch(200, {});
    const client = new ReplRpcClient({ baseUrl: 'https://lmthing.studio', sessionId: 'sess-1' });
    client.submitForm('ask-7', { answer: 'yes' });
    // submitForm fires a fire-and-forget POST; let the microtask flush.
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lmthing.studio/api/sessions/sess-1/ask/ask-7');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ value: { answer: 'yes' } });
  });
});
