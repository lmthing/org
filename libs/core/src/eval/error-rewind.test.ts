import { describe, it, expect } from 'vitest';
import { buildErrorBlock, sandboxApiHint } from './error-rewind.js';

describe('sandboxApiHint', () => {
  it('redirects subprocess attempts to execShell', () => {
    expect(sandboxApiHint("Cannot find module 'child_process'")).toContain('execShell');
    expect(sandboxApiHint("Cannot find module 'node:child_process'")).toContain('execShell');
    expect(sandboxApiHint("Cannot find name 'Bun'")).toContain('execShell');
    expect(sandboxApiHint("Cannot find name 'Deno'")).toContain('execShell');
    expect(sandboxApiHint('execSync is not defined')).toContain('execShell');
  });

  it('redirects fs attempts to the file primitives', () => {
    expect(sandboxApiHint("Cannot find module 'fs'")).toMatch(/readFile|writeFileRaw/);
    expect(sandboxApiHint('readFileSync is not a function')).toMatch(/readFile|writeFileRaw/);
  });

  it('redirects TextDecoder/Buffer use', () => {
    expect(sandboxApiHint("Cannot find name 'TextDecoder'")).toMatch(/execShell|fetch/);
  });

  it('explains the process shim for process.cwd', () => {
    expect(sandboxApiHint("Property 'cwd' does not exist")).toContain('process.env');
  });

  it('returns empty string for unrelated errors', () => {
    expect(sandboxApiHint('Cannot find name foo')).toBe('');
    expect(sandboxApiHint("',' expected.")).toBe('');
  });

  it('is wired into buildErrorBlock', () => {
    const block = buildErrorBlock("const cp = await import('child_process');", "Cannot find module 'child_process'", 1, 3);
    expect(block).toContain('execShell');
  });
});

describe('buildErrorBlock', () => {
  it('includes the attempt count, failing statement, and message', () => {
    const block = buildErrorBlock('const x = foo();', 'Cannot find name foo', 2, 3);
    expect(block).toContain('ERROR (attempt 2 of 3)');
    expect(block).toContain('// const x = foo();');
    expect(block).toContain('// Cannot find name foo');
  });

  it('comments out every line of a multi-line failing statement', () => {
    const block = buildErrorBlock('const x = await fetch(\n  url,\n);', 'boom', 1);
    expect(block).toContain('// const x = await fetch(');
    expect(block).toContain('//   url,');
    expect(block).toContain('// );');
  });

  it('lists variables still in scope and the already-executed statements', () => {
    const scope = 'const searchResults = await webSearch("x");\nconst topUrls = searchResults.slice(0, 12);';
    const block = buildErrorBlock('const pages = badCall();', 'boom', 1, 3, scope);
    // Names from successful statements are advertised so the model does not redeclare them.
    expect(block).toContain('do NOT redeclare');
    expect(block).toContain('searchResults');
    expect(block).toContain('topUrls');
    // The full executed context is echoed back.
    expect(block).toContain('ALREADY EXECUTED');
    expect(block).toContain('const searchResults = await webSearch("x");');
  });

  it('omits the scope section entirely when there is no accumulated context', () => {
    const block = buildErrorBlock('const x = foo();', 'boom', 1, 3, '');
    expect(block).not.toContain('do NOT redeclare');
    expect(block).not.toContain('ALREADY EXECUTED');
  });
});
