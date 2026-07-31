/**
 * `Message` / `AssistantTurn` — memoization regression coverage.
 *
 * Both are now `React.memo`'d (a long session was re-parsing every finished message's markdown on
 * every streamed token, since neither was memoized and `ChatView` re-renders the whole transcript
 * per batch). The naive fix — the DEFAULT shallow-props comparator, or even a custom one that
 * diffs `state`/`answer` — is actively wrong here: `resolveAskBlock` (`store/model.ts`) mutates an
 * open ask's `state`/`answer` IN PLACE rather than replacing the block object, so by the time ANY
 * comparator runs, `prevProps` and `nextProps` are both looking at the same already-mutated
 * object — there is no earlier snapshot left to diff against, so no comparator can tell "was
 * already answered" apart from "just became answered". The only correct rule is to never treat an
 * `ask` block as unchanged by identity — see `blockRenderEqual` — which costs that one block type
 * the memoization win but keeps it exactly as live as it was before. This test proves the ask
 * still updates after an in-place mutation with no new object anywhere in the chain.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '../../test-utils/index';
import { useStore } from '../store/store';
import type { ConvoBlock, ExecNode } from '../store/model';
import { Message, AssistantTurn } from './Message';

const node: ExecNode = {
  id: 'n1', parentId: null, kind: 'session', label: 'THING', status: 'running',
  childIds: [], depTaskIds: [], llmCalls: [], statements: [], yields: [], variables: {},
  eventSeqs: [],
};

beforeEach(() => {
  useStore.setState({ model: { nodes: { n1: node }, rootId: 'n1', blocks: [], rawEvents: [], lastSeq: 0 } });
});

describe('AssistantTurn — ask-block mutation is not hidden by memoization', () => {
  it('reflects an in-place state/answer mutation on rerender with the SAME array reference', () => {
    const askBlock: ConvoBlock = {
      id: 'b1', ts: 0, nodeId: 'n1', type: 'ask', askId: 'a1',
      descriptor: undefined, state: 'open',
    };
    const blocks: ConvoBlock[] = [askBlock];

    const { getByTestId, queryByText, rerender } = render(<AssistantTurn blocks={blocks} />);
    expect(getByTestId('ask-form')).toBeTruthy();
    expect(queryByText(/answered/)).toBeNull();

    // Mutate the SAME object in place — exactly what `resolveAskBlock` does — and rerender with
    // the SAME `blocks` array reference. A naive `React.memo` (default shallow comparator) would
    // bail out here since neither `blocks` nor its length changed.
    askBlock.state = 'answered';
    (askBlock as { answer?: unknown }).answer = 'yes';
    rerender(<AssistantTurn blocks={blocks} />);

    expect(getByTestId('ask-form').textContent).toMatch(/yes/);
  });
});

describe('Message / AssistantTurn are actually memoized', () => {
  it('are wrapped in React.memo (not plain function components)', () => {
    expect(Message.$$typeof).toBe(Symbol.for('react.memo'));
    expect(AssistantTurn.$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('Message — user/display/error blocks still render under memoization', () => {
  it('renders a user block', () => {
    const block: ConvoBlock = { id: 'u1', ts: 0, nodeId: 'n1', type: 'user', content: 'hello there' };
    const { getByText } = render(<Message block={block} />);
    expect(getByText('hello there')).toBeTruthy();
  });

  it('renders a display block with markdown', () => {
    const block: ConvoBlock = { id: 'd1', ts: 0, nodeId: 'n1', type: 'display', descriptor: 'plain text reply' };
    const { getByText } = render(<Message block={block} />);
    expect(getByText('plain text reply')).toBeTruthy();
  });

  it('re-renders when the block reference actually changes', () => {
    const b1: ConvoBlock = { id: 'd1', ts: 0, nodeId: 'n1', type: 'display', descriptor: 'first' };
    const { getByText, queryByText, rerender } = render(<Message block={b1} />);
    expect(getByText('first')).toBeTruthy();
    const b2: ConvoBlock = { id: 'd1', ts: 1, nodeId: 'n1', type: 'display', descriptor: 'second' };
    rerender(<Message block={b2} />);
    expect(queryByText('first')).toBeNull();
    expect(getByText('second')).toBeTruthy();
  });
});

/**
 * Edit-and-resend. `Message.tsx` used to expose only Copy on a sent message — no way to correct
 * a typo without retyping the whole thing. `EditButton` hands the block off to the composer via
 * `startEditMessage`; see `Composer.test.tsx` for what the composer does with it.
 */
describe('Message — user bubble edit-and-resend', () => {
  beforeEach(() => {
    useStore.setState({ mode: 'live', editDraft: null });
  });

  it('clicking Edit populates editDraft with this block’s id and content', () => {
    const block: ConvoBlock = { id: 'u1', ts: 0, nodeId: 'n1', type: 'user', content: 'fix this typo' };
    const { getByLabelText } = render(<Message block={block} />);
    fireEvent.click(getByLabelText('Edit and resend message'));
    expect(useStore.getState().editDraft).toEqual({ blockId: 'u1', content: 'fix this typo' });
  });

  it('is not offered in replay mode — there is no live composer to resend into', () => {
    useStore.setState({ mode: 'replay' });
    const block: ConvoBlock = { id: 'u1', ts: 0, nodeId: 'n1', type: 'user', content: 'fix this typo' };
    const { queryByLabelText } = render(<Message block={block} />);
    expect(queryByLabelText('Edit and resend message')).toBeNull();
  });

  it('is not offered for an attachment-only message with no text to reopen', () => {
    const block: ConvoBlock = { id: 'u1', ts: 0, nodeId: 'n1', type: 'user', content: '' };
    const { queryByLabelText } = render(<Message block={block} />);
    expect(queryByLabelText('Edit and resend message')).toBeNull();
  });
});
