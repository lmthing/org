import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSelfAuthoringGlobals } from './globals.js';

/**
 * The `self:author` host writers — the per-project THING rewriting its OWN space
 * (`<project>/spaces/user-thing/`). `appendSelfInstruct` is ADDITIVE by construction (it never
 * overwrites), `writeSelfKnowledge` lands a loadable aspect file, and both stay inside the space.
 */
describe('createSelfAuthoringGlobals', () => {
  let root: string;
  let spaceRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-self-'));
    spaceRoot = join(root, 'spaces', 'user-thing');
    const agentDir = join(spaceRoot, 'agents', 'thing');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'instruct.md'), '---\ntitle: THING\n---\n\nBase persona.\n', 'utf8');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  it('appendSelfInstruct APPENDS to the body and preserves the base persona + frontmatter', () => {
    const g = createSelfAuthoringGlobals({ spaceRoot });
    const r1 = g.appendSelfInstruct('The user tracks expenses in EUR.');
    expect(r1.ok).toBe(true);
    const r2 = g.appendSelfInstruct('They prefer terse replies.');
    expect(r2.ok).toBe(true);

    const text = readFileSync(join(spaceRoot, 'agents', 'thing', 'instruct.md'), 'utf8');
    // Base persona + frontmatter survive; both appends are present, in order.
    expect(text).toContain('title: THING');
    expect(text).toContain('Base persona.');
    expect(text.indexOf('EUR')).toBeLessThan(text.indexOf('terse replies'));
    expect(text).toContain('## Learned about this project');
  });

  it('appendSelfInstruct rejects empty text and a missing THING without throwing', () => {
    const g = createSelfAuthoringGlobals({ spaceRoot });
    expect(g.appendSelfInstruct('   ').ok).toBe(false);

    const gMissing = createSelfAuthoringGlobals({ spaceRoot: join(root, 'nope', 'user-thing') });
    const r = gMissing.appendSelfInstruct('x');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no editable THING|no such/i);
  });

  it('writeSelfKnowledge lands a plain-body aspect under knowledge/self/<field>/<aspect>.md', () => {
    const g = createSelfAuthoringGlobals({ spaceRoot });
    const r = g.writeSelfKnowledge('preferences', 'currency', 'The user works in EUR.');
    expect(r.ok).toBe(true);
    const p = join(spaceRoot, 'knowledge', 'self', 'preferences', 'currency.md');
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, 'utf8');
    expect(body.startsWith('# currency')).toBe(true); // never mistaken for frontmatter
    expect(body).toContain('EUR');
  });

  it('writeSelfKnowledge rejects unsafe/non-slug field or aspect (no traversal)', () => {
    const g = createSelfAuthoringGlobals({ spaceRoot });
    expect(g.writeSelfKnowledge('../escape', 'x', 'y').ok).toBe(false);
    expect(g.writeSelfKnowledge('ok', 'Bad Aspect', 'y').ok).toBe(false);
    expect(g.writeSelfKnowledge('ok', 'x', '   ').ok).toBe(false);
    // Nothing escaped the space root.
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('readSelf returns the instruct by default and an error for a missing path', () => {
    const g = createSelfAuthoringGlobals({ spaceRoot });
    const r = g.readSelf();
    expect(r.ok).toBe(true);
    expect(r.content).toContain('Base persona.');
    expect(g.readSelf('knowledge/self/nope/none.md').ok).toBe(false);
  });
});
