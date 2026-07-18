import { describe, it, expect } from 'vitest';
import { createVM } from '../sandbox/quickjs.js';
import { runTurnLoop, formatReadDocuments, formatLoadKnowledgeContents } from './turn-loop.js';
import { MessageHistory } from '../context/history.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession, StreamOpts } from './stream-types.js';
import type { YieldRequest } from './yield.js';

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

describe('formatReadDocuments', () => {
  const ydoc = (): YieldRequest =>
    ({ kind: 'readDocument', args: ['id', undefined], deferred: { resolve() {}, reject() {} }, vmPromiseHandle: undefined } as unknown as YieldRequest);
  const yother = (): YieldRequest =>
    ({ kind: 'fetch', args: [], deferred: { resolve() {}, reject() {} }, vmPromiseHandle: undefined } as unknown as YieldRequest);

  it('surfaces the FULL text of a read document (bypassing the 200-char preview cap)', () => {
    const longText = 'A'.repeat(5000) + ' END';
    const out = formatReadDocuments(
      [ydoc()],
      [{ ok: true, attachmentId: 'abc', mediaType: 'application/pdf', filename: 'report.pdf', kind: 'text', text: longText }],
    );
    expect(out).toContain('DOCUMENT CONTENTS');
    expect(out).toContain('report.pdf (application/pdf)');
    expect(out).toContain(longText); // whole text present, not truncated to 200 chars
    expect(out).not.toContain('chars total');
  });

  it('flags a host-truncated document and aligns yields with resolved values by index', () => {
    const out = formatReadDocuments(
      [yother(), ydoc()],
      [{ some: 'other yield' }, { ok: true, attachmentId: 'x', mediaType: 'text/plain', kind: 'text', text: 'hi', truncated: true }],
    );
    expect(out).toContain('truncated');
    expect(out).toContain('x (text/plain)'); // no filename → falls back to attachmentId
    expect(out).toContain('hi');
  });

  it('returns empty string for no documents, failed reads, and unsupported results', () => {
    expect(formatReadDocuments([], [])).toBe('');
    expect(formatReadDocuments([ydoc()], [{ ok: false, attachmentId: 'x', mediaType: '', kind: 'unsupported', error: 'nope' }])).toBe('');
    expect(formatReadDocuments([yother()], [{ ok: true, kind: 'text', text: 'not a doc yield' }])).toBe('');
  });
});

describe('formatLoadKnowledgeContents', () => {
  const yk = (path = 'domain/field/opt'): YieldRequest =>
    ({ kind: 'loadKnowledge', args: [path], deferred: { resolve() {}, reject() {} }, vmPromiseHandle: undefined } as unknown as YieldRequest);
  const yother = (): YieldRequest =>
    ({ kind: 'fetch', args: [], deferred: { resolve() {}, reject() {} }, vmPromiseHandle: undefined } as unknown as YieldRequest);

  it('surfaces the FULL text of a loaded knowledge file (bypassing the 200-char preview cap)', () => {
    const longText = 'B'.repeat(5000) + ' END';
    const out = formatLoadKnowledgeContents([yk('organizing/split/household')], [longText]);
    expect(out).toContain('KNOWLEDGE CONTENTS');
    expect(out).toContain('organizing/split/household');
    expect(out).toContain(longText); // whole text present, not truncated to 200 chars
    expect(out).not.toContain('chars total');
  });

  it('reads the `body` off a { frontmatter, body } resolution (a knowledge file WITH frontmatter)', () => {
    const longText = 'C'.repeat(1000) + ' TAIL';
    const out = formatLoadKnowledgeContents([yk()], [{ frontmatter: { description: 'x' }, body: longText }]);
    expect(out).toContain(longText);
  });

  it('truncates a pathologically large file with a marked total length', () => {
    const longText = 'D'.repeat(30_000);
    const out = formatLoadKnowledgeContents([yk()], [longText]);
    expect(out).toContain('truncated');
    expect(out).toContain('30000 chars total');
    expect(out.length).toBeLessThan(longText.length);
  });

  it('returns empty string for no loadKnowledge yields, non-text resolutions, and non-matching kinds', () => {
    expect(formatLoadKnowledgeContents([], [])).toBe('');
    expect(formatLoadKnowledgeContents([yk()], [undefined])).toBe('');
    expect(formatLoadKnowledgeContents([yother()], ['some text'])).toBe('');
  });
});

describe('turn loop — beforeTurn soft reminder', () => {
  it('appends the beforeTurn reminder to the request messages without persisting it', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const seenMessages: Array<Array<{ role: string; content: string }>> = [];
    let calls = 0;
    const streamFn = async (o: StreamOpts): Promise<StreamSession> => {
      seenMessages.push(o.messages);
      const text = calls++ === 0 ? 'const x = 1;' : '';
      let aborted = false;
      async function* gen() { if (!aborted && text) yield text; }
      return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
    };

    await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn,
      processYield: async () => undefined,
      beforeTurn: () => '## Open todos\n- [ ] finish the thing',
    });

    // The reminder rode along on the request as a trailing user message...
    const firstReq = seenMessages[0]!;
    expect(firstReq[firstReq.length - 1]!.content).toContain('Open todos');
    // ...but was NOT written to history (so it re-injects fresh, never duplicating).
    expect(history.messages.some((m) => m.content.includes('Open todos'))).toBe(false);
    vm.dispose();
  });
});

describe('turn loop — idle watchdog', () => {
  it('retries a stream that stalls with no tokens (treats the stall as transient)', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    let calls = 0;
    const streamFn = async (): Promise<StreamSession> => {
      const turn = calls++;
      const stall = turn === 0; // first turn emits no tokens and never ends → idle timeout
      let aborted = false;
      async function* gen() {
        if (stall) { await new Promise<void>(() => {}); }      // hangs forever
        else if (!aborted) yield 'const recovered = true;';    // binds → globalThis via the loop
      }
      return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
    };

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn,
      processYield: async () => undefined,
      maxRetries: 3,
      streamIdleMs: 40, // tiny so the stalled turn trips the watchdog fast
    });

    expect(result).toBe('done');
    expect(calls).toBeGreaterThanOrEqual(2); // the stalled turn was retried
    const h = vm.ctx.getProp(vm.ctx.global, 'recovered');
    try { expect(vm.ctx.dump(h)).toBe(true); } finally { h.dispose(); }
    vm.dispose();
  });
});
