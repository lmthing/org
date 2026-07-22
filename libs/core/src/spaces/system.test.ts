import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadSystemSpaces,
  systemFunctionNames,
  systemFunctionSources,
  defaultSystemSpaceDirs,
  filterUniversalFunctions,
  GRANTED_ONLY_SYSTEM_FUNCTIONS,
} from './system.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/spaces → libs/core/system-spaces
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const GLOBAL_DIR = join(SYSTEM_SPACES_ROOT, 'system-global');
const ARCHITECT_DIR = join(SYSTEM_SPACES_ROOT, 'system-architect');

describe('system spaces', () => {
  it('loads the system-global system space (no agents/ required)', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    expect(spaces.length).toBe(1);
    const global = spaces[0]!;
    // The generic fs wrappers (readFile/writeFile/editFile/listDir/glob/grep) were REMOVED
    // from system-global (they mis-rooted at the caller's space dir). They now live only in
    // system-engineer/functions, scoped to the engineer + jailed to a scratch sandbox.
    expect(Object.keys(global.functions).sort()).toEqual([
      'forget', 'recall', 'recallAll', 'remember',
      'todoRead', 'todoWrite', 'webFetch', 'webSearch',
    ]);
  });

  it('exposes system-global function names universally', async () => {
    const spaces = await loadSystemSpaces([GLOBAL_DIR]);
    const names = systemFunctionNames(spaces);
    expect(names.has('webSearch')).toBe(true);
    expect(names.has('remember')).toBe(true);
    // the generic fs wrappers are no longer universal — they moved to system-engineer.
    expect(names.has('readFile')).toBe(false);
    expect(names.has('grep')).toBe(false);
  });

  it('ONLY system-global functions are universal — agent-bearing spaces stay scoped', async () => {
    // system-global + system-architect loaded together: the toolkit is universal, but
    // the architect's own functions are NOT (they reach the architect via its frontmatter).
    const spaces = await loadSystemSpaces([GLOBAL_DIR, ARCHITECT_DIR]);
    const universal = systemFunctionSources(spaces);
    expect('webSearch' in universal).toBe(true);
    expect('remember' in universal).toBe(true);
    // fs wrappers are engineer-scoped now, not universal.
    expect('readFile' in universal).toBe(false);
    expect('writeTaskFile' in universal).toBe(false);
    expect('writeAgentFile' in universal).toBe(false);
    expect('validateSpace' in universal).toBe(false);
  });

  it('defaultSystemSpaceDirs points under libs/core/system-spaces', () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.some((d) => d.endsWith('system-spaces/system-global'))).toBe(true);
    expect(dirs.length).toBe(11);
    expect(dirs.some((d) => d.endsWith('system-spaces/solver'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-research'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-browser'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-appbuilder'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-vision'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-files'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/system-store'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-google'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-slack'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/integration-github'))).toBe(false);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-memory'))).toBe(true);
    expect(dirs.some((d) => d.endsWith('system-spaces/user-thing'))).toBe(true);
  });

  it('defaultSystemSpaceDirs resolves to dirs that actually exist (dist + src layouts)', () => {
    // Probing both layouts means the path is real whether run from dist/ or src/.
    const dirs = defaultSystemSpaceDirs();
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-global'))!)).toBe(true);
    expect(existsSync(dirs.find((d) => d.endsWith('system-spaces/system-architect'))!)).toBe(true);
  });

  // ── The appbuilder's shipped judgment ────────────────────────────────────────────
  //
  // Live-prod evidence (scenario 06): the automator built 7 tables with 96 real seeded rows,
  // 4 pages and 6 endpoints — and NOT ONE declared relation, so `db.query(t, {include})`
  // (a shipped, documented feature) had nothing to expand and no page could fetch a parent
  // with its children; and NOT ONE components/<Name>.tsx, though it holds the writer.
  it('the automator + data-modeler are told to DECLARE RELATIONS and factor shared components', async () => {
    const spaces = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'system-appbuilder')]);
    const automator = spaces[0]?.agents['automator'];
    const modeler = spaces[0]?.agents['data-modeler'];
    expect(automator, 'system-appbuilder must ship an "automator"').toBeDefined();
    expect(modeler, 'system-appbuilder must ship a "data-modeler"').toBeDefined();

    // A child table with no declared relation is a modeling bug — both authors are told so.
    expect(automator!.instructBody).toMatch(/DECLARE THE RELATION when one table's rows belong/);
    expect(automator!.instructBody).toMatch(/include: \['items'\]/);
    expect(modeler!.instructBody).toMatch(/declare the relation/i);

    // Repeated UI becomes a named component (the writer exists; it was never used).
    expect(automator!.instructBody).toMatch(/appears on more than one page is a COMPONENT/);
    expect(automator!.instructBody).toMatch(/writeProjectComponent\('<Name>'/);
  });

  // ── No shipped prompt may carry a live scenario's fixture data ───────────────────
  //
  // A previous round taught the automator this scenario's ANSWERS: its examples contained the
  // real booking reference (ZZJQUU), flight number and hotel name straight out of scenario 06's
  // fixtures. That is overfitting, and it is worse than useless — scenario 06 Act III asserts
  // that "ZZJQUU landed in a db row" PROVES the agent actually read the attached file, but an
  // agent with ZZJQUU in its own system prompt can emit it having read nothing at all. A prompt
  // that memorizes the exam invalidates the exam. Keep the shipped brains domain-neutral.
  it('no system-space prompt contains a scenario fixture value (no overfitting to the exam)', async () => {
    const spaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    // Tokens that exist ONLY inside sdk/org/scenarios/*/fixtures — never in a real user's project.
    const FIXTURE_TOKENS = /\b(ZZJQUU|A3932|Eileen Hotel|Suricata|Kutoka|ZNZ-PERMIT-77)\b/;
    for (const space of spaces) {
      for (const [slug, agent] of Object.entries(space.agents)) {
        const hit = FIXTURE_TOKENS.exec(agent.instructBody);
        expect(
          hit?.[0],
          `${space.packageName ?? space.dir}/${slug} embeds the scenario fixture value "${hit?.[0]}" — that is the exam's ` +
            `answer key, and it makes the assertion that proves the file was READ meaningless`,
        ).toBeUndefined();
      }
    }
  });

  // ── THING's shipped judgment: the propose/consent contract ───────────────────────
  //
  // Live-prod evidence (scenario 06, baseline run): handed five documents and "I can't keep
  // this straight — can you help me get on top of it?", THING read every file correctly and
  // then did NOTHING — no offer, no spaces, no app. A bare "Yes please." (23s) and even an
  // explicit "Is it ready? Can I open it yet?" (33s) produced zero tables and zero spaces,
  // and the turn's final display() was a bare character count ("24872") rather than a reply.
  //
  // The cause was entirely in the prompt: it taught RESTRAINT (never scaffold an app on a
  // vague request) with no counterweight telling THING to PROPOSE, and never said that the
  // last thing it displays is the only thing the user reads. Users do not know an app is on
  // the menu, so if THING never offers, it is never asked. These assertions pin the three
  // load-bearing promises into CI so a future edit cannot quietly delete them again.
  it('THING is told to PROPOSE (offer→consent), to build the parts, and to end on a real reply', async () => {
    const spaces = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'user-thing')]);
    const thing = spaces[0]?.agents['thing'];
    expect(thing, 'user-thing must ship a "thing" agent').toBeDefined();
    const instruct = thing!.instructBody;

    // 1. It must OFFER unasked when handed material + an ongoing need — and wait, not build.
    expect(instruct).toMatch(/OFFER — do not wait to be asked/);
    expect(instruct).toMatch(/Do not author anything on the same turn as the offer/);
    expect(instruct).toMatch(/A turn that has decided something must END WITH THE DECISION/);
    expect(instruct).toMatch(/Ask, then\s+stop, then\s+wait/);

    // 2. A bare "yes" to its OWN offer is the consent path 4 requires (no re-spec, no re-offer).
    expect(instruct).toMatch(/A bare yes to YOUR OWN offer is CONSENT/);
    expect(instruct).toMatch(/The organizer owns the complete build/);
    expect(instruct).toMatch(/Do NOT delegate to the automator or architect/);

    // 3. The organizer, not a second free-form path, creates every distinct scope.
    expect(instruct).toMatch(/inventories independently\s+owned scopes,\s+builds every grounded specialist/);
    expect(instruct).toMatch(/hands the complete source to the live-project\s+builder/);

    // 4. A turn may never end on a raw artifact (the "24872" failure).
    expect(instruct).toMatch(/LAST `display\(\)` is the only thing the user actually reads/);

    // …and the restraint it counterbalances must SURVIVE: propose, but still never scaffold
    // an app onto a vague opener. Losing this would trade one failure mode for the other.
    expect(instruct).toMatch(/Do NOT scaffold an app on a vague or exploratory request/);
  });

  // Live-prod evidence (scenario 06, Act V): asked a question his own files did NOT answer (how
  // long a policy actually covers him for), THING delegated it to the domain space it had just
  // built FROM THOSE SAME FILES — zero web yields. The space cannot know what was never in the
  // material, so the user got a confident guess and could not tell. Routing-by-topic silently
  // beat routing-by-what-is-knowable.
  it('THING is told a space built from the user\'s material cannot answer beyond it — research instead', async () => {
    const spaces = await loadSystemSpaces([join(SYSTEM_SPACES_ROOT, 'user-thing')]);
    const instruct = spaces[0]!.agents['thing']!.instructBody;

    expect(instruct).toMatch(/A space you built from the user's own material knows ONLY that material/);
    // The decision rule, and the escalation when the space itself admits the gap.
    expect(instruct).toMatch(/was this in what they gave me\?/);
    expect(instruct).toMatch(/believe it, and\s+escalate\./);
    // …and the finding must be kept, not left in one chat reply.
    expect(instruct).toMatch(/Then KEEP what you found/);
  });
});

// ── filterUniversalFunctions — the granted-only two-set split (Slice B) ─────────────
//
// webSearch/webFetch are UNIVERSAL for `systemFunctionSources`/`systemFunctionNames` (the
// pins above stay true — those are the raw/pool primitives, untouched) but GRANTED-ONLY for
// the top-level INJECTED view: a specialist that calls them directly at top level (bypassing
// research_and_store's persistence step) is exactly the bug this closes — see
// `.issues/research-store-noop-diagnosis.md` (Slice B).
describe('filterUniversalFunctions', () => {
  const map = { webSearch: 'src-webSearch', webFetch: 'src-webFetch', remember: 'src-remember', recall: 'src-recall' };

  it('GRANTED_ONLY_SYSTEM_FUNCTIONS is exactly {webSearch, webFetch}', () => {
    expect([...GRANTED_ONLY_SYSTEM_FUNCTIONS].sort()).toEqual(['webFetch', 'webSearch']);
  });

  it('drops webSearch/webFetch when not granted, keeping every other universal function', () => {
    const out = filterUniversalFunctions(map, []);
    expect('webSearch' in out).toBe(false);
    expect('webFetch' in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(['recall', 'remember']);
    expect(out['remember']).toBe('src-remember');
    expect(out['recall']).toBe('src-recall');
  });

  it('an undefined grant list behaves like an empty one (withholds granted-only names)', () => {
    const out = filterUniversalFunctions(map, undefined);
    expect('webSearch' in out).toBe(false);
    expect('webFetch' in out).toBe(false);
  });

  it('keeps ONLY the granted-only name the agent actually named — a partial grant', () => {
    const out = filterUniversalFunctions(map, ['webSearch']);
    expect(out['webSearch']).toBe('src-webSearch');
    expect('webFetch' in out).toBe(false); // not granted — still withheld
    expect(out['remember']).toBe('src-remember'); // ordinary universal fn unaffected
  });

  it('keeps both granted-only names when both are named in functions:', () => {
    const out = filterUniversalFunctions(map, ['webSearch', 'webFetch']);
    expect(out['webSearch']).toBe('src-webSearch');
    expect(out['webFetch']).toBe('src-webFetch');
    expect(Object.keys(out).sort()).toEqual(['recall', 'remember', 'webFetch', 'webSearch']);
  });

  it('is a no-op on a map with none of the granted-only names, however it is called', () => {
    const noGrantedNames = { remember: 'src-remember', recall: 'src-recall', forget: 'src-forget' };
    expect(filterUniversalFunctions(noGrantedNames, [])).toEqual(noGrantedNames);
    expect(filterUniversalFunctions(noGrantedNames, undefined)).toEqual(noGrantedNames);
    expect(filterUniversalFunctions(noGrantedNames, ['webSearch'])).toEqual(noGrantedNames);
  });
});
