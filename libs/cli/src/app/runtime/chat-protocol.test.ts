import { describe, it, expect, vi, afterEach } from 'vitest';
import { sessionCreateBody, listChatSessions } from './chat-protocol.js';

/**
 * `<Chat>` dock protocol helpers. `sessionCreateBody` picks the right session shape; `listChatSessions`
 * powers the dock's history switcher — newest-first, and quiet (never throws) so a missing history
 * cannot break the dock.
 */
describe('sessionCreateBody', () => {
  it('sends a bare slug as agentSlug (the project THING) and a ref as spaceRef', () => {
    expect(sessionCreateBody('thing', 'p1')).toEqual({ agentSlug: 'thing', projectId: 'p1' });
    expect(sessionCreateBody('newsroom/curator', 'p1')).toEqual({ spaceRef: 'newsroom/curator', projectId: 'p1' });
  });
});

describe('listChatSessions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the project sessions newest-first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            sessions: [
              { sessionId: 'a', title: 'Older', lastActivity: 100 },
              { sessionId: 'b', title: 'Newer', lastActivity: 900 },
            ],
          }),
        ),
      ),
    );
    const out = await listChatSessions('p1', 'https://pod.test', 'tok');
    expect(out.map((s) => s.sessionId)).toEqual(['b', 'a']);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/projects/p1/sessions');
    expect((init as RequestInit | undefined)?.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('is quiet on a non-2xx or a thrown fetch — never breaks the dock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await listChatSessions('p1', 'https://pod.test')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await listChatSessions('p1', 'https://pod.test')).toEqual([]);
  });
});
