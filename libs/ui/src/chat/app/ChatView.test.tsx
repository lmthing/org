/**
 * `ChatView` — two regression coverages that do not fit `Message.test.tsx`.
 *
 * 1. The connection indicator (`ConnectionDot`) used to live inside the same `display="none"
 *    $md={{display:'flex'}}` row as the rest of the desktop-only workbench controls, so on a
 *    phone a dropped socket looked identical to the app simply being stuck. It now renders
 *    unconditionally.
 * 2. `Composer` used to hold its draft (text/attachments/recording/the `@` dropdown) as local
 *    state nothing ever reset on a session switch, so a draft typed in one chat was still
 *    sitting in the box after switching to another. It is now keyed on `activeSessionId`.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '../../test-utils/index';
import { useStore } from '../store/store';
import { ChatView } from './ChatView';

beforeEach(() => {
  useStore.setState({ activeSessionId: 's1' });
});

describe('ChatView — connection indicator always visible', () => {
  it('renders the connection status with no display:none ancestor (no $md gate)', () => {
    const { getByText } = render(<ChatView />);
    // Default store state is `connection: 'connecting'` (session-slice.ts) — ConnectionDot's label.
    let node: HTMLElement | null = getByText('connecting');
    expect(node).toBeTruthy();
    while (node) {
      expect(node.style.display).not.toBe('none');
      expect(node.className).not.toMatch(/_dsp-none\b/);
      node = node.parentElement;
    }
  });
});

describe('ChatView — Composer keyed on the active session', () => {
  it('remounts (and clears) the draft when activeSessionId changes', () => {
    const { container, rerender } = render(<ChatView />);
    const field = container.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement;
    expect(field).toBeTruthy();
    fireEvent.change(field, { target: { value: 'a draft for session one' } });
    expect(field.value).toBe('a draft for session one');

    useStore.setState({ activeSessionId: 's2' });
    rerender(<ChatView />);

    const fieldAfter = container.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement;
    // A remounted Composer is a DIFFERENT node, and its draft starts empty — the two symptoms a
    // draft-preserving (non-keyed) Composer would NOT show: same node, same stale text.
    expect(fieldAfter).not.toBe(field);
    expect(fieldAfter.value).toBe('');
  });
});
