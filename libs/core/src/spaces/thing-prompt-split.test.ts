import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace } from './load.js';
import { loadPointsIn } from './agent-prompt-corpus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_THING = join(__dirname, '..', '..', 'system-spaces', 'user-thing');
const THING_INSTRUCT = join(USER_THING, 'agents', 'thing', 'instruct.md');
const PLAYBOOKS = join(USER_THING, 'knowledge', 'playbooks');

const instruct = () => readFileSync(THING_INSTRUCT, 'utf8');

/**
 * THING's `instruct.md` was one 1110-line file: every routing decision AND the full detail of
 * every route, on every turn, whether or not the turn went near that route. It is now split —
 * the body carries the decisions and the rules that must hold always, and the detail behind each
 * route sits in `knowledge/playbooks/<field>/<aspect>.md`, pulled in with `loadKnowledge` at the
 * moment THING takes that route.
 *
 * That split only works if three things stay true, and each fails SILENTLY if it stops being
 * true — a load that resolves to nothing, an aspect nothing ever tells THING to load, or a body
 * that quietly re-absorbs the detail until the split is decorative. This suite pins all three.
 */
describe('user-thing/thing — the instruct/knowledge split holds together', () => {
  /** `playbooks/<field>/<aspect>` for every aspect file on disk (index.md is the field overview,
   *  never an aspect — `spaces/load.ts#loadKnowledge` skips it). */
  function aspectsOnDisk(): string[] {
    const out: string[] = [];
    for (const field of readdirSync(PLAYBOOKS, { withFileTypes: true })) {
      if (!field.isDirectory()) continue;
      for (const file of readdirSync(join(PLAYBOOKS, field.name))) {
        if (!file.endsWith('.md') || file === 'index.md') continue;
        out.push(`playbooks/${field.name}/${file.slice(0, -3)}`);
      }
    }
    return out.sort();
  }

  /**
   * A `loadKnowledge('playbooks','paths','reserch')` typo does not throw at load time and does not
   * fail typecheck — the call yields, the host misses on disk, and THING carries on having been
   * told the detail was unavailable. The load points and the files must agree exactly.
   */
  it('every loadKnowledge(...) the instruct names resolves to a real aspect file', () => {
    const points = [...loadPointsIn(instruct())];
    expect(points.length, 'the instruct must actually name its load points').toBeGreaterThan(10);

    const missing = points.filter((p) => !existsSync(join(USER_THING, 'knowledge', `${p}.md`)));
    expect(
      missing,
      'a load point with no file behind it silently hands THING nothing at the moment it needed the detail',
    ).toEqual([]);
  });

  /**
   * The reverse direction, and the one a split actually loses work to: an aspect can be written,
   * be correct, and never be read, because nothing in the always-on body tells THING it exists.
   * Knowledge is lazy — an aspect no load point names is dead prose.
   */
  it('every aspect on disk is named by a load point in the instruct', () => {
    const points = loadPointsIn(instruct());
    const orphans = aspectsOnDisk().filter((a) => !points.has(a));
    expect(
      orphans,
      'an aspect nothing tells THING to load is unreachable — the detail is on disk and never in a prompt',
    ).toEqual([]);
  });

  /**
   * The frontmatter refs are what put the field, its overview and its aspect list in the
   * `# Knowledge` section of the system block (`context/system-block.ts`), so THING can see the
   * menu without loading anything. A ref that names a field the space does not ship fails the
   * whole space load, so this also pins the two lists together.
   */
  it('declares every playbook field in frontmatter, and each field ships an overview plus 2+ aspects', async () => {
    const space = await loadSpace(USER_THING, { requireAgents: false });
    const refs = space.agents['thing']!.config.knowledge;
    const fieldsOnDisk = readdirSync(PLAYBOOKS, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `playbooks/${e.name}`)
      .sort();

    expect(
      refs.filter((r) => r.startsWith('playbooks/')).sort(),
      'a playbook field missing from frontmatter never appears in the # Knowledge menu',
    ).toEqual(fieldsOnDisk);

    for (const [slug, field] of Object.entries(space.knowledge.domains['playbooks']!.fields)) {
      // The overview is what THING reads to decide whether this field is the one to load.
      expect(field.description ?? '', `playbooks/${slug} needs an index.md body`).not.toEqual('');
      expect((field.description ?? '').length, `playbooks/${slug} overview is too thin to route on`).toBeGreaterThan(40);
      // Two aspects minimum — the same rule the architect's validateSpace enforces on a built
      // space: one file is an "overview.md" in disguise and belongs in index.md.
      expect(
        Object.keys(field.options).length,
        `playbooks/${slug} must split its detail across 2+ aspects`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * The split exists to shrink what THING carries on EVERY turn, including the turns that just
   * answer a question. Nothing stops the body growing back one paragraph at a time, and the cost
   * is invisible — the prompt just gets more expensive for every user on every message. This is a
   * ratchet, not a style rule: if a change genuinely needs more always-on prose, move something
   * else behind a load, or raise this number deliberately and say why.
   */
  it('keeps the always-on body under the ratchet', () => {
    const lines = instruct().split('\n').length;
    expect(
      lines,
      `thing/instruct.md is ${lines} lines — it was 1110 before the split. Move detail into a playbooks aspect rather than raising this.`,
    ).toBeLessThanOrEqual(560);
  });

  /**
   * A load costs a turn, so the body must say when to spend it — otherwise THING either loads
   * nothing (and runs a route without its failure modes) or loads on every turn (and pays the
   * turn on the path that needs it least).
   */
  it('tells THING when to load, and that the plain-answer path needs no load', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Load in the SAME statement you decide/i);
    expect(flat).toMatch(/needs no load at all/i);
    expect(flat).toMatch(/Load the playbook before you act on the path, not after it went wrong/i);
  });
});
