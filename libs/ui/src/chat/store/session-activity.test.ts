import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import type { WireEvent } from './model';
import type { TraceEvent } from '@lmthing/core';

let seq = 0;
const wire = (event: TraceEvent): WireEvent => ({ seq: ++seq, event });

/**
 * setActivity() reaches the client as a fire-and-forget `activity` trace event.
 * The top-level SESSION scope drives THING's MAIN "currently doing" line (store
 * `activity`, shown under the header title). A fork/delegate scope instead sets
 * that work node's narration (`ExecNode.activity`, shown by WorkBlock) — NOT the
 * header line.
 */
describe('feedLive — activity: THING main line', () => {
  beforeEach(() => {
    seq = 0;
    useStore.getState().resetSession();
  });

  it('sets the main line from a session-scope event, and a later one replaces it', () => {
    expect(useStore.getState().activity).toBe('');
    useStore.getState().feedLive([wire({ ts: 1, type: 'activity', context: 'session', scope: 'session', text: 'Searching…' })]);
    expect(useStore.getState().activity).toBe('Searching…');
    useStore.getState().feedLive([wire({ ts: 2, type: 'activity', context: 'session', scope: 'session', text: 'Comparing 3 options' })]);
    expect(useStore.getState().activity).toBe('Comparing 3 options');
  });

  it('an empty session-scope text clears the main line', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'activity', context: 'session', scope: 'session', text: 'Working' })]);
    useStore.getState().feedLive([wire({ ts: 2, type: 'activity', context: 'session', scope: 'session', text: '' })]);
    expect(useStore.getState().activity).toBe('');
  });

  it('setDone(true) clears the main line (turn idle)', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'activity', context: 'session', scope: 'session', text: 'Planning' })]);
    useStore.getState().setDone(true);
    expect(useStore.getState().activity).toBe('');
  });

  it('resetSession clears the main line (session switch)', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'activity', context: 'session', scope: 'session', text: 'Working' })]);
    useStore.getState().resetSession();
    expect(useStore.getState().activity).toBe('');
  });
});

describe('feedLive — activity: fork/delegate sub-activity → work node narration', () => {
  beforeEach(() => {
    seq = 0;
    useStore.getState().resetSession();
  });

  const startNode = (nodeId: string, label: string): WireEvent =>
    wire({ ts: 1, type: 'node_start', nodeId, parentId: null, kind: 'delegate', label, context: label, status: 'running' });

  it('sets the work node activity and leaves the header main line untouched', () => {
    useStore.getState().feedLive([
      startNode('n1', 'geocoder'),
      wire({ ts: 2, type: 'activity', context: 'geocoder', nodeId: 'n1', scope: 'delegate', text: 'Geocoding addresses…' }),
    ]);
    expect(useStore.getState().activity).toBe('');
    expect(useStore.getState().model.nodes['n1']?.activity).toBe('Geocoding addresses…');
  });

  it('a later sub-activity for the same node replaces it', () => {
    useStore.getState().feedLive([
      startNode('n1', 'geocoder'),
      wire({ ts: 2, type: 'activity', context: 'geocoder', nodeId: 'n1', scope: 'delegate', text: 'Step 1' }),
      wire({ ts: 3, type: 'activity', context: 'geocoder', nodeId: 'n1', scope: 'delegate', text: 'Step 2' }),
    ]);
    expect(useStore.getState().model.nodes['n1']?.activity).toBe('Step 2');
  });

  it('an empty sub-activity clears the node narration (falls back to //-comment)', () => {
    useStore.getState().feedLive([
      startNode('n1', 'geocoder'),
      wire({ ts: 2, type: 'activity', context: 'geocoder', nodeId: 'n1', scope: 'delegate', text: 'Geocoding…' }),
      wire({ ts: 3, type: 'activity', context: 'geocoder', nodeId: 'n1', scope: 'delegate', text: '' }),
    ]);
    expect(useStore.getState().model.nodes['n1']?.activity).toBeUndefined();
  });

  it('a session-scope activity never mints a work node', () => {
    useStore.getState().feedLive([wire({ ts: 1, type: 'activity', context: 'session', scope: 'session', text: 'Planning' })]);
    expect(Object.keys(useStore.getState().model.nodes)).toHaveLength(0);
  });
});
