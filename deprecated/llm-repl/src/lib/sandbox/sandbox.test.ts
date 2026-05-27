import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import { BoundaryDetector } from './boundary.js';
import { analyzeCapture } from './capture.js';
import { TraceWriter } from './trace.js';
import { scanFileBlocks } from './file-blocks.js';

// ── BoundaryDetector ──────────────────────────────────────────────────────────

describe('BoundaryDetector', () => {
  let detector: BoundaryDetector;

  beforeEach(() => {
    detector = new BoundaryDetector();
  });

  it('detects a simple statement ending with semicolon', () => {
    const stmts = detector.feed('const x = 1;');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const x = 1');
  });

  it('detects a function declaration as one statement', () => {
    const stmts = detector.feed('function foo() { return 1; }');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('function foo()');
  });

  it('detects a class declaration as one statement', () => {
    const stmts = detector.feed('class Foo { method() { return 2; } }');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('class Foo');
  });

  it('detects JSX expression statement', () => {
    const stmts = detector.feed('const el = <div className="x" />;');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const el');
  });

  it('detects template literal with embedded expression', () => {
    const stmts = detector.feed('const s = `hello ${name}`;');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const s');
  });

  it('detects arrow function with body block', () => {
    const stmts = detector.feed('const fn = () => { return 42; };');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const fn');
  });

  it('returns multiple statements from multi-statement input', () => {
    const stmts = detector.feed('const a = 1; const b = 2;');
    expect(stmts).toHaveLength(2);
  });

  it('returns empty array for partial input', () => {
    const stmts = detector.feed('function foo() {');
    expect(stmts).toHaveLength(0);
  });

  it('completes partial input after more chunks are fed', () => {
    const first = detector.feed('function foo() {');
    expect(first).toHaveLength(0);
    const second = detector.feed(' return 1; }');
    expect(second).toHaveLength(1);
    expect(second[0]).toContain('function foo()');
  });

  it('flush returns remaining partial text', () => {
    detector.feed('const x = 1');
    const remainder = detector.flush();
    expect(remainder).toContain('const x = 1');
  });

  it('flush returns null when buffer is empty', () => {
    const remainder = detector.flush();
    expect(remainder).toBeNull();
  });

  it('reset clears state', () => {
    detector.feed('const x = 1');
    detector.reset();
    const remainder = detector.flush();
    expect(remainder).toBeNull();
  });
});

// ── analyzeCapture ────────────────────────────────────────────────────────────

describe('analyzeCapture - positive cases', () => {
  it('function declaration → kind: function', () => {
    const result = analyzeCapture('function foo() {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('function');
      expect(result.result.name).toBe('foo');
    }
  });

  it('class declaration → kind: class', () => {
    const result = analyzeCapture('class Foo {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('class');
      expect(result.result.name).toBe('Foo');
    }
  });

  it('const arrow function → kind: function', () => {
    const result = analyzeCapture('const foo = () => {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('function');
      expect(result.result.name).toBe('foo');
    }
  });

  it('const function expression → kind: function', () => {
    const result = analyzeCapture('const foo = function() {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('function');
      expect(result.result.name).toBe('foo');
    }
  });

  it('const class expression → kind: class', () => {
    const result = analyzeCapture('const Foo = class {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('class');
      expect(result.result.name).toBe('Foo');
    }
  });

  it('view component (JSX return) → kind: view_component', () => {
    const result = analyzeCapture(
      'const MyView = (props: { title: string }) => <div>{props.title}</div>',
    );
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('view_component');
      expect(result.result.name).toBe('MyView');
    }
  });

  it('form component (submit prop) → kind: form_component', () => {
    const result = analyzeCapture(
      'const MyForm = (props: { submit: (v: string) => void }) => <form></form>',
    );
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('form_component');
      expect(result.result.name).toBe('MyForm');
    }
  });

  it('exported function declaration → kind: function', () => {
    const result = analyzeCapture('export function foo() {}');
    expect(result.capturable).toBe(true);
    if (result.capturable) {
      expect(result.result.kind).toBe('function');
      expect(result.result.name).toBe('foo');
    }
  });
});

describe('analyzeCapture - negative cases', () => {
  it('let binding → not capturable', () => {
    const result = analyzeCapture('let f = () => {}');
    expect(result.capturable).toBe(false);
    if (!result.capturable) {
      expect(result.reason).toContain('const');
    }
  });

  it('multi-declarator const → not capturable', () => {
    const result = analyzeCapture('const a = 1, b = () => {}');
    expect(result.capturable).toBe(false);
  });

  it('array destructuring → not capturable', () => {
    const result = analyzeCapture('const [a, b] = [1, 2]');
    expect(result.capturable).toBe(false);
  });

  it('call expression initializer → not capturable', () => {
    const result = analyzeCapture('const handler = makeHandler()');
    expect(result.capturable).toBe(false);
  });

  it('object literal initializer → not capturable', () => {
    const result = analyzeCapture('const obj = { method() {} }');
    expect(result.capturable).toBe(false);
  });

  it('HOC wrapping (call expression) → not capturable', () => {
    const result = analyzeCapture('const Card = memo((p) => <div/>)');
    expect(result.capturable).toBe(false);
  });
});

// ── TraceWriter ───────────────────────────────────────────────────────────────

describe('TraceWriter', () => {
  let tmpDir: string;
  let traceFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trace-test-'));
    traceFile = join(tmpDir, 'trace.jsonl');
  });

  it('cleans up', () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON lines', () => {
    const writer = new TraceWriter(traceFile);
    writer.write({ type: 'session_start', sessionId: 'abc' });

    const events = writer.readSuffix(0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_start');
    expect(typeof events[0].ts).toBe('number');
    expect((events[0] as unknown as { sessionId: string }).sessionId).toBe('abc');
  });

  it('writes multiple events as separate lines', () => {
    const writer = new TraceWriter(traceFile);
    writer.write({ type: 'statement_received', code: 'const x = 1;' });
    writer.write({ type: 'execute', code: 'const x = 1;' });

    const events = writer.readSuffix(0);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('statement_received');
    expect(events[1].type).toBe('execute');
  });

  it('readSuffix returns events from offset', () => {
    const writer = new TraceWriter(traceFile);
    writer.write({ type: 'session_start' });
    writer.write({ type: 'statement_received' });
    writer.write({ type: 'execute' });

    const suffix = writer.readSuffix(1);
    expect(suffix).toHaveLength(2);
    expect(suffix[0].type).toBe('statement_received');
  });

  it('readSuffix returns empty array if no file', () => {
    const writer = new TraceWriter(join(tmpDir, 'nonexistent', 'trace.jsonl'));
    // No writes — file doesn't exist
    // Create a new writer that points at a non-existent path
    const emptyWriter = new TraceWriter(join(tmpDir, 'sub', 'trace.jsonl'));
    const events = emptyWriter.readSuffix(0);
    expect(events).toEqual([]);
  });
});

// ── scanFileBlocks ────────────────────────────────────────────────────────────

describe('scanFileBlocks', () => {
  it('extracts a write block', () => {
    const text = '````src/hello.ts\nconsole.log("hi");\n````\n';
    const result = scanFileBlocks(text);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('write');
    expect(result.blocks[0].path).toBe('src/hello.ts');
    expect(result.blocks[0].content).toBe('console.log("hi");');
  });

  it('extracts a diff block', () => {
    const text = '````diff src/hello.ts\n@@ -1 +1 @@\n-old\n+new\n````\n';
    const result = scanFileBlocks(text);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('diff');
    expect(result.blocks[0].path).toBe('src/hello.ts');
    expect(result.blocks[0].content).toContain('@@ -1 +1 @@');
  });

  it('returns remaining text after removing blocks', () => {
    const text = 'before\n````src/hello.ts\ncode\n````\nafter';
    const result = scanFileBlocks(text);
    expect(result.remaining).toContain('before');
    expect(result.remaining).toContain('after');
    expect(result.remaining).not.toContain('````');
  });

  it('leaves unterminated block in remaining', () => {
    const text = 'before\n````src/hello.ts\ncode without closing fence';
    const result = scanFileBlocks(text);
    expect(result.blocks).toHaveLength(0);
    expect(result.remaining).toContain('````src/hello.ts');
  });

  it('handles multiple blocks in one input', () => {
    const text =
      '````a.ts\nconst a = 1;\n````\n````b.ts\nconst b = 2;\n````\n';
    const result = scanFileBlocks(text);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].path).toBe('a.ts');
    expect(result.blocks[1].path).toBe('b.ts');
  });

  it('returns all text as remaining when no blocks present', () => {
    const text = 'just some code without blocks';
    const result = scanFileBlocks(text);
    expect(result.blocks).toHaveLength(0);
    expect(result.remaining).toBe(text);
  });
});
