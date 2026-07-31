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

/**
 * Knowledge is LAZY BY DEFAULT — a 2-part `knowledge:` ref puts a field's overview and its aspect
 * NAMES in the `# Knowledge` menu, and nothing else ever injects an aspect body. So any space can
 * ship a correct, expensive aspect that no prompt ever tells its agent to load: the file is on disk,
 * the menu names it, and it is never once in a prompt. That is the same failure the split guards
 * catch, except it predates the split and applies to every shipped space, so it is swept here rather
 * than per-agent.
 *
 * TWO shapes count as reaching an aspect, and only counting the first is what produces false
 * orphans:
 *
 *  - a LITERAL triple — `loadKnowledge('playbooks', 'paths', 'research')`. The split agents' routing
 *    tables are all of this shape, because the aspect a route needs is known when the route is
 *    picked.
 *  - a MENU load — a 2-part `loadKnowledge('documents', 'formats')` that returns the real option
 *    list off disk, followed by a 3-part call whose third argument comes FROM that list. This is the
 *    right shape when the aspect is keyed on something only the request knows: `system-files` picks
 *    a format by what was actually attached, THING's `organize_material` picks a life-area split by
 *    what the material turned out to be about (20 aspects), and a synthesized specialist's `answer`
 *    task is BUILT to do exactly this (`system-architect/.../05-write_tasks.md`). Reading only for
 *    literal triples would flag all 26 of those as dead prose and invite someone to delete them.
 */
describe('shipped system spaces — no knowledge aspect is unreachable', () => {
  const TRIPLE = /\(\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*\)/g;
  const MENU = /loadKnowledge\(\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*\)/g;

  /** Every `.md` under `dir`, recursively; [] when absent. */
  function mdUnder(dir: string): string[] {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((e) =>
      e.isDirectory() ? mdUnder(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
    );
  }

  const spaces = readdirSync(SYSTEM_SPACES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => mdUnder(join(SYSTEM_SPACES, name, 'knowledge')).length > 0);

  it.each(spaces)('%s', (name) => {
    const spaceDir = join(SYSTEM_SPACES, name);
    const kdir = join(spaceDir, 'knowledge');

    // `<domain>/<field>/<aspect>` for every loadable option. `index.md` is the field OVERVIEW —
    // rendered inline in the menu, never offered as a `loadKnowledge` option — so it is not an aspect.
    const aspects = mdUnder(kdir)
      .map((f) => f.slice(kdir.length + 1).split(/[/\\]/))
      .filter((parts) => parts.length === 3 && parts[2] !== 'index.md')
      .map((parts) => `${parts[0]}/${parts[1]}/${parts[2]!.replace(/\.md$/, '')}`);
    if (aspects.length === 0) return;

    // Everything an agent in this space can actually be reading: its instructs and its task nodes.
    const corpus = [...mdUnder(join(spaceDir, 'agents')), ...mdUnder(join(spaceDir, 'tasklists'))]
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const named = new Set([...corpus.matchAll(TRIPLE)].map((m) => `${m[1]}/${m[2]}/${m[3]}`));
    const menus = new Set([...corpus.matchAll(MENU)].map((m) => `${m[1]}/${m[2]}`));

    const unreachable = aspects.filter(
      (a) => !named.has(a) && !menus.has(a.slice(0, a.lastIndexOf('/'))),
    );
    expect(
      unreachable,
      `${name} ships knowledge no prompt can reach: neither a literal loadKnowledge triple nor a ` +
        'menu load of its field appears in any instruct or task node. Name it where it is actionable, ' +
        'or delete it — an aspect nothing reads is prose that costs review and buys nothing.',
    ).toEqual([]);
  });
});
