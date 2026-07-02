import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store.js';
import type { WireEvent } from './model.js';
import type { TraceEvent } from '@lmthing/core';

let seq = 0;
const wire = (event: TraceEvent): WireEvent => ({ seq: ++seq, event });

/**
 * The agent names the session via setSessionMeta(), which the core runtime emits
 * as a `session_meta` trace event. It reaches the client as a normal 'trace'
 * message and flows through feedLive — feedLive must lift the title into the
 * store's `sessionTitle` (the header + active sidebar row read it live).
 */
describe('feedLive — session_meta → sessionTitle', () => {
  beforeEach(() => {
    seq = 0;
    useStore.getState().resetSession();
  });

  it('sets sessionTitle from a session_meta event', () => {
    expect(useStore.getState().sessionTitle).toBe('');
    useStore.getState().feedLive([
      wire({ ts: 1, type: 'session_meta', nodeId: 'sid', title: 'Pasta night', slug: 'pasta-night' }),
    ]);
    expect(useStore.getState().sessionTitle).toBe('Pasta night');
  });

  it('a later session_meta overrides the earlier title', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'session_meta', title: 'First' })]);
    useStore.getState().feedLive([wire({ ts: 2, type: 'session_meta', title: 'Second' })]);
    expect(useStore.getState().sessionTitle).toBe('Second');
  });

  it('resetSession clears the title (session switch)', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'session_meta', title: 'Pasta night' })]);
    expect(useStore.getState().sessionTitle).toBe('Pasta night');
    useStore.getState().resetSession();
    expect(useStore.getState().sessionTitle).toBe('');
  });

  it('ignores a session_meta with no title (slug-only)', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'session_meta', slug: 'x' })]);
    expect(useStore.getState().sessionTitle).toBe('');
  });
});
