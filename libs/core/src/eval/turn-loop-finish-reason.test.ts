import { describe, it, expect } from 'vitest';
import { createVM } from '../sandbox/quickjs.js';
import { runTurnLoop } from './turn-loop.js';
import { MessageHistory } from '../context/history.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { Tracer, type TraceEvent } from '../sandbox/trace.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession, StreamFinishReason } from './stream-types.js';

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

/** A scripted session per turn: the chunks it emits and why it stopped. `finishReason`
 *  is only visible once the stream ENDS (never after abort) — exactly what a provider
 *  does, since the terminal `finish` part never arrives on an aborted request. */
function scriptedStreamFn(turns: Array<{ text: string; finishReason?: StreamFinishReason }>) {
  const calls: number[] = [];
  const streamFn = async (): Promise<StreamSession> => {
    const turn = turns[calls.length] ?? { text: '' };
    calls.push(1);
    let aborted = false;
    let finished = false;
    async function* gen() {
      if (!aborted && turn.text) yield turn.text;
      finished = true;
    }
    return {
      textStream: gen(),
      abort() { aborted = true; },
      get finishReason() { return finished && !aborted ? turn.finishReason : undefined; },
    } as StreamSession;
  };
  return { streamFn, callCount: () => calls.length };
}

function collectingTracer(): { tracer: Tracer; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const tracer = new Tracer(null);
  tracer.subscribe((e) => events.push(e));
  return { tracer, events };
}

describe('turn loop — finishReason: length (output-cap truncation)', () => {
  it('retries the request when a length cut produced no usable statement', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    // Turn 1: cut mid-statement — nothing parses, so nothing ran. Turn 2 completes.
    const { streamFn, callCount } = scriptedStreamFn([
      { text: 'const partial = "unterminated', finishReason: 'length' },
      { text: 'const recovered = true;', finishReason: 'stop' },
    ]);
    const { tracer, events } = collectingTracer();

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn, tracer,
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('done');
    expect(callCount()).toBe(2); // the truncated turn was RE-ISSUED, not settled 'done'
    expect(events.some((e) => e.type === 'turn_end' && e.reason === 'length_cut')).toBe(true);
    const h = vm.ctx.getProp(vm.ctx.global, 'recovered');
    try { expect(vm.ctx.dump(h)).toBe(true); } finally { h.dispose(); }
    vm.dispose();
  });

  it('continues (does not settle done) when the cut came AFTER statements already ran', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const { streamFn, callCount } = scriptedStreamFn([
      { text: 'const a = 1;', finishReason: 'length' },
      { text: 'const b = 2;', finishReason: 'stop' },
    ]);
    const { tracer, events } = collectingTracer();

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn, tracer,
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('done');
    expect(callCount()).toBe(2);
    // Continued rather than re-run: the executed statement stayed in history and the
    // model was told it was cut off (re-issuing would double every side effect).
    expect(events.some((e) => e.type === 'turn_end' && e.reason === 'length_cut_continue')).toBe(true);
    expect(history.messages.some((m) => m.content.includes('cut off by the output limit'))).toBe(true);
    for (const name of ['a', 'b']) {
      const h = vm.ctx.getProp(vm.ctx.global, name);
      try { expect(vm.ctx.dump(h)).toBe(name === 'a' ? 1 : 2); } finally { h.dispose(); }
    }
    vm.dispose();
  });

  it('records finishReason on the llm_response trace event', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const { streamFn } = scriptedStreamFn([
      { text: 'const a = 1;', finishReason: 'length' },
      { text: 'const b = 2;', finishReason: 'stop' },
    ]);
    const { tracer, events } = collectingTracer();

    await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn, tracer,
      processYield: async () => undefined,
      maxRetries: 3,
    });

    const responses = events.filter((e): e is Extract<TraceEvent, { type: 'llm_response' }> => e.type === 'llm_response');
    expect(responses.map((e) => e.finishReason)).toEqual(['length', 'stop']);
    vm.dispose();
  });

  it('gives up with `error` when every attempt is cut at the output cap (mock harness)', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    // The mock's new `finishReason` argument: every scripted turn reports a length cut.
    let calls = 0;
    const streamFn = createMockStreamFn(() => { calls++; return 'const partial = "unterminated'; }, 'length');

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn,
      processYield: async () => undefined,
      maxRetries: 2,
    });

    expect(result).toBe('error');   // NOT a silent 'done' on a half-finished program
    expect(calls).toBe(2);
    vm.dispose();
  });

  it('leaves a normal `stop` finish alone (one call, settles done)', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const { streamFn, callCount } = scriptedStreamFn([{ text: 'const only = 1;', finishReason: 'stop' }]);
    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn,
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('done');
    expect(callCount()).toBe(1);
    vm.dispose();
  });
});
