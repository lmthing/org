import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace } from './load.js';
import { loadPointsIn, splitAspectsOnDisk } from './agent-prompt-corpus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES = join(__dirname, '..', '..', 'system-spaces');

/**
 * The STRUCTURAL guards every split agent needs, applied to each one.
 *
 * An agent's prompt is no longer one file: the always-on `instruct.md` body carries the DECISION
 * and the rules that hold whatever happens, and the detail behind each route lives in
 * `knowledge/<domain>/<field>/<aspect>.md`, pulled in with `loadKnowledge` at the moment the agent
 * takes that route. Two agents are split this way today, for the same reason — a prompt that
 * charged every turn for detail almost every turn never reaches:
 *
 * - `user-thing/thing` — 1270 lines on every message, including the whole team surface a personal
 *   workspace can never use.
 * - `system-appbuilder/automator` — 781 lines on every delegate turn, in a job where the common
 *   case (a first whole-app build) answers with ONE statement that runs the `build_live_project`
 *   tasklist and touches no writer at all.
 *
 * Each of the three checks below covers a failure that is otherwise SILENT — nothing throws, no
 * gate goes red, the agent simply gets worse:
 *
 *  1. a load point with no file behind it (`loadKnowledge` yields, misses on disk, and the agent
 *     carries on having been told the detail was unavailable — a typo does not fail typecheck);
 *  2. an aspect no load point names (correct, hard-won prose that nothing ever reads);
 *  3. the body growing back one paragraph at a time until the split is decorative.
 *
 * Agent-specific claims — WHICH rules must stay always-on for a given agent — live next to that
 * agent, in `thing-prompt-split.test.ts` and in `prompt-contract.test.ts`/`system.test.ts`. This
 * file only proves the machinery holds together, so a THIRD split gets these three for free.
 */
const SPLIT_AGENTS = [
  {
    label: 'user-thing/thing',
    space: 'user-thing',
    agent: 'thing',
    /** The domains its INSTRUCT routes into. `organizing`/`recording` are deliberately excluded:
     *  they are loaded by tasklist NODES, not by the instruct, so they are not orphans. */
    domains: ['playbooks'],
    /** Deliberate ratchet. Raise it only with a reason — see the body-growth check. */
    maxBodyLines: 560,
    priorLines: 1270,
  },
  {
    label: 'system-appbuilder/automator',
    space: 'system-appbuilder',
    agent: 'automator',
    domains: ['app_building'],
    maxBodyLines: 230,
    priorLines: 781,
  },
] as const;

describe.each(SPLIT_AGENTS)('$label — the instruct/knowledge split holds together', (subject) => {
  const spaceDir = join(SYSTEM_SPACES, subject.space);
  const instruct = () => readFileSync(join(spaceDir, 'agents', subject.agent, 'instruct.md'), 'utf8');

  /**
   * A `loadKnowledge('app_building','authoring','seding-data')` typo does not throw at load time and
   * does not fail typecheck — the call yields, the host misses on disk, and the agent carries on
   * having been told the detail was unavailable. The load points and the files must agree exactly.
   */
  it('every loadKnowledge(...) the instruct names resolves to a real aspect file', () => {
    const points = [...loadPointsIn(instruct())];
    expect(points.length, 'the instruct must actually name its load points').toBeGreaterThan(3);

    const missing = points.filter((p) => !existsSync(join(spaceDir, 'knowledge', `${p}.md`)));
    expect(
      missing,
      'a load point with no file behind it silently hands the agent nothing at the moment it needed the detail',
    ).toEqual([]);
  });

  /**
   * The reverse direction, and the one a split actually loses work to: an aspect can be written,
   * be correct, and never be read, because nothing in the always-on body tells the agent it exists.
   * Knowledge is lazy — an aspect no load point names is dead prose.
   */
  it('every aspect on disk is named by a load point in the instruct', () => {
    const points = loadPointsIn(instruct());
    const orphans = splitAspectsOnDisk(spaceDir, [...subject.domains]).filter((a) => !points.has(a));
    expect(
      orphans,
      'an aspect nothing tells the agent to load is unreachable — the detail is on disk and never in a prompt',
    ).toEqual([]);
  });

  /**
   * The frontmatter refs are what put each field, its overview and its aspect list into the
   * `# Knowledge` section of the system block (`context/system-block.ts`), so the agent can see the
   * MENU without loading anything. A field missing from frontmatter is invisible: its aspects exist,
   * a load point names them, and the agent has no reason to believe they are there. (A ref naming a
   * field the space does not ship fails the whole space load, so this pins the two lists together in
   * both directions.)
   */
  it('declares every split field in frontmatter, and each ships an overview plus 2+ aspects', async () => {
    const space = await loadSpace(spaceDir, { requireAgents: false });
    const refs = space.agents[subject.agent]!.config.knowledge;

    for (const domain of subject.domains) {
      const fieldsOnDisk = readdirSync(join(spaceDir, 'knowledge', domain), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${domain}/${e.name}`)
        .sort();
      expect(
        refs.filter((r) => r.startsWith(`${domain}/`)).sort(),
        `a ${domain} field missing from frontmatter never appears in the # Knowledge menu`,
      ).toEqual(fieldsOnDisk);

      for (const [slug, field] of Object.entries(space.knowledge.domains[domain]!.fields)) {
        // The overview is what the agent reads to decide whether this field is the one to load.
        expect(field.description ?? '', `${domain}/${slug} needs an index.md body`).not.toEqual('');
        expect(
          (field.description ?? '').length,
          `${domain}/${slug} overview is too thin to route on`,
        ).toBeGreaterThan(40);
        // Two aspects minimum — the same rule the architect's validateSpace enforces on a built
        // space: one file is an "overview.md" in disguise and belongs in index.md.
        expect(
          Object.keys(field.options).length,
          `${domain}/${slug} must split its detail across 2+ aspects`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  /**
   * The split exists to shrink what the agent carries on EVERY turn, including the turns that need
   * none of the detail. Nothing stops the body growing back one paragraph at a time, and the cost is
   * invisible — the prompt just gets more expensive for every user on every message. This is a
   * ratchet, not a style rule: if a change genuinely needs more always-on prose, move something else
   * behind a load, or raise this number deliberately and say why.
   */
  it('keeps the always-on body under the ratchet', () => {
    const lines = instruct().split('\n').length;
    expect(
      lines,
      `${subject.label}'s instruct.md is ${lines} lines — it was ${subject.priorLines} before the split. ` +
        'Move detail into an aspect rather than raising this.',
    ).toBeLessThanOrEqual(subject.maxBodyLines);
  });

  /**
   * A load costs a turn, so the body must say WHEN to spend it. Without that the agent either loads
   * nothing (and runs a route without the failure modes that route has already produced) or loads
   * on every turn (and pays the turn on the path that needs it least).
   */
  it('tells the agent to load in the same statement it decides, before it acts', () => {
    const flat = instruct().replace(/\s+/g, ' ');
    expect(flat).toMatch(/Load in the SAME statement you decide/i);
  });
});
