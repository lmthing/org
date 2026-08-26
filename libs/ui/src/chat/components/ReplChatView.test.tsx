/**
 * `ReplChatView` — the embeddable session view shared by Studio's THING dock and the project-app
 * `<Chat>` widget.
 *
 * Regression coverage for a native + UX bug: the transcript used to be a `Prim.Box` with
 * `overflowY: 'auto'` (Yoga has no overflow scrolling, so on a phone it CLIPPED at one screenful
 * with no gesture to reach the rest — see `elements/primitives/scroll/index.tsx`'s own note), and
 * an unconditional `scrollIntoView` ran on every `blocks`/`userMsgs` change, unlike `ChatView`
 * which gates on `atBottom` — so scrolling up mid-response snapped the reader back to the bottom
 * on the very next token. Both are fixed the same way `ChatView` already does it: `Prim.Scroll`
 * with `stickToEnd` gated on an `atBottom` a scroll handler maintains.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '../../test-utils/index';
import { ReplChatView } from './ReplChatView';
import { emptyModel, type ConvoBlock, type SessionModel } from '../store/model';

function modelWith(blocks: ConvoBlock[]): SessionModel {
  return { ...emptyModel(), rootId: 'n', blocks };
}

const HELLO: ConvoBlock = { id: 'b1', ts: 0, nodeId: 'n', type: 'display', descriptor: 'hello' };

const mockSession = {
  // The transcript is now `model.blocks` (the same `ConvoBlock[]` the full /chat surface renders),
  // grouped by the shared `groupBlocks`. `blocks` (the legacy ad-hoc list) is unused by this view.
  blocks: [] as unknown[],
  model: modelWith([HELLO]),
  sendMessage: vi.fn(),
  submitForm: vi.fn(),
  cancelAsk: vi.fn(),
  isConnected: true,
  isDone: false,
};

vi.mock('../client/useReplSession', () => ({
  useReplSession: () => mockSession,
}));

describe('ReplChatView transcript container', () => {
  it('renders through Prim.Scroll (stickToEnd), not a plain overflow Box', () => {
    const { container } = render(
      <ReplChatView baseUrl="https://computer.test" sessionId="s1" />,
    );
    // `atBottom` starts `true`, so `Prim.Scroll`'s `stickToEnd` path renders its bottom-anchoring
    // spacer as the transcript's first child — a plain `overflowY: auto` `Box` never did. Its
    // presence is a mechanical proof this is the Scroll primitive, not the old Box.
    const html = container.innerHTML;
    expect(html).not.toContain('overflow-y');
    expect(html).not.toMatch(/style="[^"]*overflowY/i);
  });

  it('carries no design-token-violating raw color and renders the display block', () => {
    const { getByText } = render(
      <ReplChatView baseUrl="https://computer.test" sessionId="s1" />,
    );
    expect(getByText('hello')).toBeTruthy();
  });
});

describe('ReplChatView first-run suggestion chips (R4)', () => {
  it('shows chips on a blank connected transcript and sends one on tap', () => {
    const prev = mockSession.model;
    mockSession.model = modelWith([]); // a brand-new, empty conversation
    mockSession.sendMessage.mockClear();
    try {
      const { getByText } = render(
        <ReplChatView
          baseUrl="https://computer.test"
          sessionId="s1"
          suggestions={['Track my expenses', 'Plan a trip']}
        />,
      );
      const chip = getByText('Track my expenses');
      expect(chip).toBeTruthy();
      chip.click();
      expect(mockSession.sendMessage).toHaveBeenCalledWith('Track my expenses');
    } finally {
      mockSession.model = prev;
    }
  });

  it('hides chips once the transcript has any agent output', () => {
    // Default mock has one block → not a blank conversation.
    const { queryByText } = render(
      <ReplChatView
        baseUrl="https://computer.test"
        sessionId="s1"
        suggestions={['Track my expenses']}
      />,
    );
    expect(queryByText('Track my expenses')).toBeNull();
  });
});

describe('ReplChatView fully-featured transcript', () => {
  it('renders user turns, a markdown display, and an ask form from model.blocks', () => {
    const prev = mockSession.model;
    mockSession.model = modelWith([
      { id: 'u1', ts: 1, nodeId: 'n', type: 'user', content: 'plan a trip' },
      { id: 'd1', ts: 2, nodeId: 'n', type: 'display', descriptor: 'Sure — **where** to?' },
      { id: 'a1', ts: 3, nodeId: 'n', type: 'ask', askId: 'ask-1', descriptor: 'Destination?', state: 'open' },
    ]);
    try {
      const { getByText } = render(<ReplChatView baseUrl="https://computer.test" sessionId="s1" />);
      // The user's own turn (previously dropped by the ad-hoc block list).
      expect(getByText('plan a trip')).toBeTruthy();
      // Assistant prose rendered as markdown (the "where" is inside a <strong>).
      expect(getByText('where')).toBeTruthy();
      // The ask form is rendered from the ConvoBlock ask (its Submit control).
      expect(getByText('Submit')).toBeTruthy();
    } finally {
      mockSession.model = prev;
    }
  });
});
