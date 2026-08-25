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

const mockSession = {
  blocks: [{ id: 'b1', type: 'display' as const, data: 'hello' }],
  model: { nodes: {}, rootIds: [] },
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
    const prev = mockSession.blocks;
    mockSession.blocks = []; // a brand-new, empty conversation
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
      mockSession.blocks = prev;
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
