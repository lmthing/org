import { describe, it, expect } from 'vitest';
import { buildErrorBlock } from './error-rewind.js';

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
