import { describe, it, expect } from 'vitest';
import { summarizeHistory } from './summarize.js';
import { MessageHistory, type Message } from './history.js';
import { createMockStreamFn } from '../testing/mock-provider.js';

function mkHistory(): Message[] {
  return [
    { role: 'user', content: 'Write TypeScript code to accomplish the following task.\n\nTask: build a pasta recipe', blockType: 'normal' },
    { role: 'assistant', content: 'const x = 1;', blockType: 'normal' },
    {
      role: 'user',
      content: 'VARIABLES\nx: 1\nSCOPE (already declared):\ny, z\nALREADY EXECUTED:\nconst x = 1;\nawait sleep("1s");',
      blockType: 'variables',
    },
    { role: 'assistant', content: 'bad code', blockType: 'normal' },
    { role: 'user', content: 'TypeError: cannot read foo of undefined\n  at line 2', blockType: 'error' },
    { role: 'assistant', content: 'const y = 2;', blockType: 'normal' },
    { role: 'user', content: 'VARIABLES\ny: 2', blockType: 'variables' },
    { role: 'assistant', content: 'recent 1', blockType: 'normal' },
  ];
}

describe('summarizeHistory (deterministic digest)', () => {
  it('preserves the original task', async () => {
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 2 });
    expect(s).toContain('task: build a pasta recipe');
  });

  it('captures resolved variables but NOT the SCOPE / ALREADY EXECUTED dump', async () => {
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 2 });
    expect(s).toContain('var: x: 1');
    expect(s).not.toContain('ALREADY EXECUTED');
    expect(s).not.toContain('sleep'); // the executed-code dump must not leak into the summary
  });

  it('captures errors (first line only)', async () => {
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 2 });
    expect(s).toContain('error: TypeError: cannot read foo of undefined');
    expect(s).not.toContain('at line 2');
  });

  it('returns empty when nothing to summarize', async () => {
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 100 });
    expect(s).toBe('');
  });
});

describe('summarizeHistory (LLM path)', () => {
  it('streams the summary from the LLM and feeds it the to-summarize history only', async () => {
    let seen: { system: string; user: string } | undefined;
    const streamFn = createMockStreamFn((o) => {
      seen = { system: o.system, user: o.messages.map((m) => m.content).join('\n') };
      return ['  SUMMARY: ', 'pasta built, ', 'x=1  ']; // chunked → exercises streaming
    });
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 2, streamFn });
    expect(s).toBe('SUMMARY: pasta built, x=1'); // chunks joined and trimmed

    // The summarizer saw the collapsed history (task + resolved vars + error)…
    expect(seen!.system).toMatch(/summar/i);
    expect(seen!.user).toContain('build a pasta recipe');
    expect(seen!.user).toContain('x: 1');
    // …but NOT the last `keepLast` messages, which stay verbatim.
    expect(seen!.user).not.toContain('recent 1');
  });

  it('does not call the LLM when there is nothing to summarize', async () => {
    let called = false;
    const streamFn = createMockStreamFn(() => { called = true; return 'unused'; });
    const s = await summarizeHistory({ messages: mkHistory(), keepLast: 100, streamFn });
    expect(s).toBe('');
    expect(called).toBe(false);
  });
});

describe('MessageHistory.summarize integration', () => {
  it('collapses to summary + last N verbatim', () => {
    const h = new MessageHistory();
    for (const m of mkHistory()) h.append(m);
    const before = h.messages.length;
    h.summarize('SUMMARY TEXT', 3);
    expect(h.messages.length).toBe(4); // 1 summary + 3 tail
    expect(h.messages[0]!.content).toContain('[CONTEXT SUMMARY]');
    expect(h.messages[0]!.content).toContain('SUMMARY TEXT');
    expect(h.messages[h.messages.length - 1]!.content).toBe('recent 1');
    expect(before).toBeGreaterThan(4);
  });
});
