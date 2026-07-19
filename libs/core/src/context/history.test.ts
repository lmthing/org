import { describe, it, expect } from 'vitest';
import { MessageHistory, type Message } from './history.js';

describe('MessageHistory.totalChars', () => {
  it('sums the content length across every message', () => {
    const h = new MessageHistory();
    expect(h.totalChars()).toBe(0);
    h.append({ role: 'user', content: 'abcde' }); // 5
    h.append({ role: 'assistant', content: 'xyz' }); // 3
    expect(h.totalChars()).toBe(8);
  });

  it('grows as history grows — the signal a size-triggered compaction reads', () => {
    const h = new MessageHistory();
    const before = h.totalChars();
    for (let i = 0; i < 50; i++) h.append({ role: 'user', content: 'x'.repeat(100) });
    expect(h.totalChars()).toBe(before + 50 * 100);
  });
});

describe('MessageHistory.summarize (size-triggered compaction contract)', () => {
  it('keeps the last keepLast messages VERBATIM and folds the rest into one summary', () => {
    // This is exactly what maybeCompactHistoryBySize relies on: after a mid-turn compaction the
    // most recent messages — crucially the just-appended VARIABLES block that carries the pending
    // yield's continuation — must survive byte-for-byte, so the binding is never disturbed.
    const h = new MessageHistory();
    const msgs: Message[] = [];
    for (let i = 0; i < 12; i++) {
      const m: Message = { role: i % 2 === 0 ? 'user' : 'assistant', content: `MSG_${i}` };
      msgs.push(m);
      h.append(m);
    }
    h.summarize('DIGEST', 6);

    // Shape: one [CONTEXT SUMMARY] head + the last 6 verbatim.
    expect(h.messages).toHaveLength(7);
    expect(h.messages[0]!.content).toBe('[CONTEXT SUMMARY]\nDIGEST');
    expect(h.messages[0]!.role).toBe('user');
    // The tail (the 6 most recent) is preserved verbatim, in order.
    expect(h.messages.slice(1).map((m) => m.content)).toEqual([
      'MSG_6', 'MSG_7', 'MSG_8', 'MSG_9', 'MSG_10', 'MSG_11',
    ]);
  });

  it('is a no-op when there is nothing to fold away (history ≤ keepLast)', () => {
    const h = new MessageHistory();
    h.append({ role: 'user', content: 'only' });
    h.summarize('DIGEST', 6);
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]!.content).toBe('only'); // untouched — no summary head inserted
  });
});
