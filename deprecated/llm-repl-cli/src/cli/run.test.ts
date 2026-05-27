import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runSession } from './run.js';

// Use a temp dir per test run
const baseDir = join(tmpdir(), `llm-repl-test-${randomUUID()}`);

describe('runSession (Phase 13 stub)', () => {
  it('creates a SessionAssembly at the expected path', async () => {
    const { existsSync } = await import('node:fs');
    const sessionId = randomUUID();
    await runSession(
      { sessionId, baseDir, provider: 'openai:gpt-4o-mini' },
      'const x = 1;',
    );
    const sessionDir = join(baseDir, `session-${sessionId}`);
    expect(existsSync(sessionDir)).toBe(true);
  });

  it('all engines initialize without throwing', async () => {
    await expect(
      runSession(
        { baseDir, provider: 'openai:gpt-4o-mini' },
        'hello world',
      ),
    ).resolves.toBeDefined();
  });

  it('Router emits a decision for a simple input', async () => {
    const result = await runSession(
      { baseDir, provider: 'openai:gpt-4o-mini' },
      'simple task',
    );
    expect(result.decision).toBeDefined();
    expect(result.decision.role).toBeTypeOf('string');
    expect(result.decision.alias).toBeTypeOf('string');
    expect(['XS', 'S', 'M', 'M_R', 'L', 'L_R']).toContain(result.decision.alias);
  });

  it('reconstruction string contains expected inspect header', async () => {
    const result = await runSession(
      { baseDir, provider: 'openai:gpt-4o-mini' },
      'const y = 42;',
    );
    expect(result.reconstruction).toContain('// ═══ inspect #1 ═══');
  });
});
