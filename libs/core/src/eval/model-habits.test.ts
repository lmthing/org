import { describe, it, expect } from 'vitest';
import { sanitizeModelHabits, MODEL_HABITS } from './model-habits.js';

describe('sanitizeModelHabits — reasoning "think" tags', () => {
  it('comments out a stray closing </think> the model leaked into its first statement', () => {
    // The exact DeepSeek habit: the boundary detector carves the leaked closing tag
    // into its own statement ahead of the first real one.
    const r = sanitizeModelHabits('</think>');
    expect(r.text).toBe('// </think>');
    expect(r.applied).toEqual(['reasoning-tags']);
  });

  it('comments out a whole <think>…</think> block emitted as text (multi-line)', () => {
    const block = '<think>\nlet me reason about this\nmore reasoning\n</think>';
    const r = sanitizeModelHabits(block);
    expect(r.text).toBe('// <think>\n// let me reason about this\n// more reasoning\n// </think>');
    expect(r.applied).toEqual(['reasoning-tags']);
  });

  it('comments out an inline single-line block', () => {
    const r = sanitizeModelHabits('<think>quick thought</think>');
    expect(r.text).toBe('// <think>quick thought</think>');
    expect(r.applied).toEqual(['reasoning-tags']);
  });

  it('is case-insensitive and tolerates whitespace/attrs in the tag', () => {
    expect(sanitizeModelHabits('</THINK>').text).toBe('// </THINK>');
    expect(sanitizeModelHabits('</think >').text).toBe('// </think >');
    expect(sanitizeModelHabits('<think signature="x">reason</think>').applied).toEqual(['reasoning-tags']);
  });

  it('handles reasoning-tag variants other models use', () => {
    for (const tag of ['thinking', 'reasoning', 'reflection', 'scratchpad', 'analysis', 'thought', 'monologue']) {
      expect(sanitizeModelHabits(`</${tag}>`).applied).toEqual(['reasoning-tags']);
      expect(sanitizeModelHabits(`<${tag}>\nsome reasoning\n</${tag}>`).applied).toEqual(['reasoning-tags']);
    }
  });

  it('a commented artifact typechecks/evals to nothing — verify it is pure comment lines', () => {
    const r = sanitizeModelHabits('<think>\nabc\n</think>');
    // Every non-blank line begins with a line comment → transpiles to empty JS.
    for (const line of r.text.split('\n')) {
      expect(line === '' || line.startsWith('// ')).toBe(true);
    }
  });
});

describe('sanitizeModelHabits — chat/harmony control tokens', () => {
  it('comments out a lone leaked control token', () => {
    for (const tok of ['<|end|>', '<|im_end|>', '<|im_start|>', '<|channel|>', '<|message|>', '<|assistant|>']) {
      const r = sanitizeModelHabits(tok);
      expect(r.text).toBe(`// ${tok}`);
      expect(r.applied).toEqual(['control-tokens']);
    }
  });

  it('comments out a run of adjacent control tokens', () => {
    const r = sanitizeModelHabits('<|start|><|assistant|>');
    expect(r.text).toBe('// <|start|><|assistant|>');
    expect(r.applied).toEqual(['control-tokens']);
  });

  it('does not touch a bitwise-or comparison or real code with pipes', () => {
    for (const code of ['const y = a | b;', 'if (x < 1 || y > 2) { foo(); }', 'const s = "a|b|c";']) {
      const r = sanitizeModelHabits(code);
      expect(r.text).toBe(code);
      expect(r.applied).toEqual([]);
    }
  });
});

describe('sanitizeModelHabits — leaves real code untouched', () => {
  it('does not touch statements without a think tag', () => {
    for (const code of [
      'const x = 1;',
      'display(report);',
      'await tavilySearch(query, "advanced", 10);',
      'return results.map((r) => r.title);',
    ]) {
      const r = sanitizeModelHabits(code);
      expect(r.text).toBe(code);
      expect(r.applied).toEqual([]);
    }
  });

  it('does NOT corrupt a legitimate string literal that contains </think>', () => {
    // Stripping the tag would leave surviving code, so the whole statement is left as-is.
    const code = 'display("</think>");';
    const r = sanitizeModelHabits(code);
    expect(r.text).toBe(code);
    expect(r.applied).toEqual([]);
  });

  it('does NOT match a JSX element whose name merely starts with "think"', () => {
    const code = 'display(<Thinking>hi</Thinking>);';
    const r = sanitizeModelHabits(code);
    expect(r.text).toBe(code);
    expect(r.applied).toEqual([]);
  });

  it('leaves a statement with real code AND a think tag alone (surviving code guard)', () => {
    const code = 'foo(); // <think>';
    const r = sanitizeModelHabits(code);
    expect(r.text).toBe(code);
    expect(r.applied).toEqual([]);
  });
});

describe('MODEL_HABITS registry', () => {
  it('every habit reports a no-op via string identity, not a copy', () => {
    const untouched = 'const x = 1;';
    for (const habit of MODEL_HABITS) {
      if (!habit.matches(untouched)) continue;
      expect(habit.clean(untouched)).toBe(untouched);
    }
  });
});
