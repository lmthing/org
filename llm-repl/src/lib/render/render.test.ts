import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenderEngine, TimeoutError, SessionEndedError } from './render.js';
import { TraceWriter } from '../sandbox/trace.js';

function makeTraceWriter(dir: string): TraceWriter {
  return new TraceWriter(join(dir, 'trace.jsonl'));
}

function makeEngine(dir: string, opts?: { maxEntries?: number; maxTokens?: number }) {
  return new RenderEngine({
    trace: makeTraceWriter(dir),
    config: {
      maxEntries: opts?.maxEntries ?? 10,
      maxTokens: opts?.maxTokens ?? 2000,
    },
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'render-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('display()', () => {
  it('appends entry with null id', () => {
    const engine = makeEngine(tmpDir);
    engine.display({ $$type: 'Markdown', props: { children: 'hello' }, key: null }, {}, 0);
    const entries = engine.getDisplayEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBeNull();
    expect(entries[0].descriptor).toEqual({ $$type: 'Markdown', props: { children: 'hello' }, key: null });
  });

  it('with stable id replaces existing entry', () => {
    const engine = makeEngine(tmpDir);
    engine.display({ $$type: 'ProgressBar', props: { value: 0 }, key: null }, { id: 'p1' }, 0);
    engine.display({ $$type: 'ProgressBar', props: { value: 50 }, key: null }, { id: 'p1' }, 1);
    engine.display({ $$type: 'ProgressBar', props: { value: 100 }, key: null }, { id: 'p1' }, 2);
    const entries = engine.getDisplayEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('p1');
    expect((entries[0].descriptor as { props: { value: number } }).props.value).toBe(100);
  });

  it('respects maxEntries by dropping oldest non-id entries first', () => {
    const engine = makeEngine(tmpDir, { maxEntries: 3 });
    engine.display({ $$type: 'A' }, {}, 0);
    engine.display({ $$type: 'B' }, {}, 1);
    engine.display({ $$type: 'C' }, {}, 2);
    engine.display({ $$type: 'D' }, {}, 3);
    const entries = engine.getDisplayEntries();
    expect(entries).toHaveLength(3);
    const types = entries.map((e) => (e.descriptor as { $$type: string }).$$type);
    expect(types).not.toContain('A');
  });
});

describe('ask()', () => {
  it('returns a Promise', () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const result = engine.ask({ $$type: 'TextInput' }, {}, 0);
    expect(result).toBeInstanceOf(Promise);
    vi.useRealTimers();
    // clean up pending ask
    const asks = engine.getPendingAsks();
    asks.forEach((a) => engine.submitAsk(a.id, 'x'));
  });

  it('promise resolves when submitAsk called with correct id', async () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const promise = engine.ask<string>({ $$type: 'TextInput' }, {}, 0);
    const asks = engine.getPendingAsks();
    expect(asks).toHaveLength(1);
    engine.submitAsk(asks[0].id, 'hello');
    vi.useRealTimers();
    const result = await promise;
    expect(result).toBe('hello');
  });

  it('rejects with TimeoutError after timeout when no fallback', async () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const promise = engine.ask({ $$type: 'TextInput' }, { timeout: 1000 }, 0);
    vi.advanceTimersByTime(1001);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    vi.useRealTimers();
  });

  it('resolves with fallback on timeout when fallback provided', async () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const promise = engine.ask({ $$type: 'TextInput' }, { timeout: 1000, fallback: 'default' }, 0);
    vi.advanceTimersByTime(1001);
    const result = await promise;
    expect(result).toBe('default');
    vi.useRealTimers();
  });
});

describe('invalidateAfter()', () => {
  it('removes entries after cutoffIndex', () => {
    const engine = makeEngine(tmpDir);
    engine.display({ $$type: 'A' }, {}, 0);
    engine.display({ $$type: 'B' }, {}, 1);
    engine.display({ $$type: 'C' }, {}, 5);
    engine.display({ $$type: 'D' }, {}, 10);
    engine.invalidateAfter(2);
    const entries = engine.getDisplayEntries();
    expect(entries).toHaveLength(2);
    const types = entries.map((e) => (e.descriptor as { $$type: string }).$$type);
    expect(types).toContain('A');
    expect(types).toContain('B');
    expect(types).not.toContain('C');
    expect(types).not.toContain('D');
  });

  it('preserves stable-id entries before cutoff', () => {
    const engine = makeEngine(tmpDir);
    engine.display({ $$type: 'Stable', props: { v: 1 } }, { id: 'stable' }, 0);
    engine.display({ $$type: 'Transient' }, {}, 1);
    engine.display({ $$type: 'Late' }, {}, 5);
    engine.invalidateAfter(2);
    const entries = engine.getDisplayEntries();
    expect(entries.find((e) => e.id === 'stable')).toBeDefined();
    const types = entries.map((e) => (e.descriptor as { $$type: string }).$$type);
    expect(types).not.toContain('Late');
  });
});

describe('endSession()', () => {
  it('resolves pending asks with fallback when provided', async () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const promise = engine.ask({ $$type: 'Confirm' }, { fallback: false }, 0);
    engine.endSession();
    vi.useRealTimers();
    const result = await promise;
    expect(result).toBe(false);
  });

  it('rejects pending asks without fallback with SessionEndedError', async () => {
    const engine = makeEngine(tmpDir);
    vi.useFakeTimers();
    const promise = engine.ask({ $$type: 'TextInput' }, {}, 0);
    engine.endSession();
    vi.useRealTimers();
    await expect(promise).rejects.toBeInstanceOf(SessionEndedError);
  });
});

describe('trace events', () => {
  it('emits display trace event', () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    engine.display({ $$type: 'Markdown' }, {}, 3);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'display', statementIndex: 3 }),
    );
  });

  it('emits ask trace event', () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    vi.useFakeTimers();
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    engine.ask({ $$type: 'Select' }, { timeout: 5000 }, 2);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask', statementIndex: 2, timeout: 5000 }),
    );
    // cleanup
    engine.getPendingAsks().forEach((a) => engine.submitAsk(a.id, 'x'));
    vi.useRealTimers();
  });

  it('emits ask_resolve trace event on submitAsk', async () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    vi.useFakeTimers();
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    const p = engine.ask({ $$type: 'TextInput' }, {}, 1);
    const id = engine.getPendingAsks()[0].id;
    engine.submitAsk(id, 'val');
    vi.useRealTimers();
    await p;
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_resolve', id }),
    );
  });

  it('emits ask_timeout trace event', async () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    vi.useFakeTimers();
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    const p = engine.ask({ $$type: 'TextInput' }, { timeout: 500, fallback: '' }, 0);
    vi.advanceTimersByTime(501);
    await p;
    vi.useRealTimers();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_timeout' }),
    );
  });

  it('emits display_invalidate trace event', () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    engine.display({ $$type: 'A' }, {}, 0);
    engine.display({ $$type: 'B' }, {}, 5);
    engine.invalidateAfter(2);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'display_invalidate', cutoffIndex: 2 }),
    );
  });

  it('emits ask_cancelled trace event on endSession', async () => {
    const trace = makeTraceWriter(tmpDir);
    const writeSpy = vi.spyOn(trace, 'write');
    vi.useFakeTimers();
    const engine = new RenderEngine({
      trace,
      config: { maxEntries: 10, maxTokens: 2000 },
    });
    engine.ask({ $$type: 'Confirm' }, { fallback: false }, 0);
    engine.endSession();
    vi.useRealTimers();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ask_cancelled' }),
    );
  });
});

describe('multiple concurrent asks', () => {
  it('each resolves independently', async () => {
    vi.useFakeTimers();
    const engine = makeEngine(tmpDir);
    const p1 = engine.ask<string>({ $$type: 'TextInput' }, {}, 0);
    const p2 = engine.ask<number>({ $$type: 'Select' }, {}, 1);
    const p3 = engine.ask<boolean>({ $$type: 'Confirm' }, {}, 2);

    const asks = engine.getPendingAsks();
    expect(asks).toHaveLength(3);

    engine.submitAsk(asks[0].id, 'answer1');
    engine.submitAsk(asks[1].id, 42);
    engine.submitAsk(asks[2].id, true);

    vi.useRealTimers();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('answer1');
    expect(r2).toBe(42);
    expect(r3).toBe(true);
  });
});
