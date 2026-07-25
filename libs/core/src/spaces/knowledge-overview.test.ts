import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSpace } from './load.js';

/** Build a minimal space with one knowledge field: index.md (overview body) + 2 aspects. */
function makeSpace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'space-'));
  const agent = join(dir, 'agents', 'expert');
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, 'instruct.md'), '---\ntitle: Expert\nknowledge:\n  - chess/pieces\n---\nYou are an expert.', 'utf8');
  const field = join(dir, 'knowledge', 'chess', 'pieces');
  mkdirSync(field, { recursive: true });
  writeFileSync(join(field, 'index.md'), '---\nvariable: piecesKnowledge\ndefault: movement\n---\n\nEach chess piece has its own movement pattern, relative value, and special rules.', 'utf8');
  writeFileSync(join(field, 'movement.md'), '# Movement\n\nHow each piece moves.', 'utf8');
  writeFileSync(join(field, 'value.md'), '# Value\n\nRelative point values.', 'utf8');
  return dir;
}

describe('knowledge field overview (index.md body)', () => {
  let dir: string;
  beforeEach(() => { dir = makeSpace(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  it('captures the field index.md body as field.description', async () => {
    const space = await loadSpace(dir);
    const field = space.knowledge.domains['chess']!.fields['pieces']!;
    expect(field.description).toContain('movement pattern, relative value');
    expect(Object.keys(field.options).sort()).toEqual(['movement', 'value']);
    expect(field.options).not.toHaveProperty('index');
  });
});
