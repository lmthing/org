import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import type { ConvoBlock } from './model';

/**
 * The store half of edit-and-resend (`Message.tsx`'s `EditButton` → `Composer`'s `editDraft`
 * effect). `startEditMessage`/`clearEditDraft` are a one-shot mailbox between the two components;
 * `truncateFromBlock` is what makes a resend not leave a stale answer sitting under a now-changed
 * question — see the comment at its call site in `Composer.handleSend` for why that is a
 * LOCAL-transcript-only fix, not a rewrite of what the agent itself remembers.
 */
function userBlock(id: string, content: string): ConvoBlock {
  return { id, ts: 0, nodeId: 'n1', type: 'user', content };
}
function displayBlock(id: string, text: string): ConvoBlock {
  return { id, ts: 0, nodeId: 'n1', type: 'display', descriptor: text };
}

describe('session slice — edit-and-resend plumbing', () => {
  beforeEach(() => {
    useStore.setState({
      model: {
        nodes: {},
        rootId: 'n1',
        blocks: [userBlock('b1', 'first question'), displayBlock('b2', 'first answer'), userBlock('b3', 'second question'), displayBlock('b4', 'second answer')],
        rawEvents: [],
        lastSeq: 0,
      },
      editDraft: null,
    });
  });

  it('startEditMessage sets editDraft to the block id + content', () => {
    useStore.getState().startEditMessage('b3', 'second question');
    expect(useStore.getState().editDraft).toEqual({ blockId: 'b3', content: 'second question' });
  });

  it('clearEditDraft consumes it back to null', () => {
    useStore.getState().startEditMessage('b3', 'second question');
    useStore.getState().clearEditDraft();
    expect(useStore.getState().editDraft).toBeNull();
  });

  it('truncateFromBlock drops that block and everything after it, keeping everything before', () => {
    useStore.getState().truncateFromBlock('b3');
    expect(useStore.getState().model.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('truncateFromBlock is a no-op for an id no longer in the transcript', () => {
    const before = useStore.getState().model.blocks.map((b) => b.id);
    useStore.getState().truncateFromBlock('does-not-exist');
    expect(useStore.getState().model.blocks.map((b) => b.id)).toEqual(before);
  });

  it('resetSession clears a pending editDraft (a stale edit must not bleed into the next session)', () => {
    useStore.getState().startEditMessage('b3', 'second question');
    useStore.getState().resetSession();
    expect(useStore.getState().editDraft).toBeNull();
  });
});
