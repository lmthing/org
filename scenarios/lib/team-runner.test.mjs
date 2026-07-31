import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateTeamScenario,
  teamPlanLines,
  summarizeTeamTurn,
  attributeLedger,
  threadSessionFacts,
  compactTeamStep,
  teamTraceLines,
  resolveEmitter,
  scanEmitterDefs,
  jargonHits,
  TeamScenarioRunner,
} from './team-runner.mjs';
import { providerOutageInLog, logSize, providerHosts } from '../harness/lib/provider.mjs';

const tmps = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lmteam-'));
  tmps.push(d);
  return d;
};

const SCENARIO = {
  id: '20-x',
  title: 'T',
  project: 'p',
  persona: 'a persona',
  team: { id: 't1', name: 'Team' },
  cast: [
    { key: 'ana', role: 'editor' },
    { key: 'bo', role: 'editor' },
    { key: 'vic', role: 'viewer' },
  ],
  channels: [{ id: 'general' }, { id: 'studio', category: 'Work' }],
};

describe('validateTeamScenario', () => {
  it('accepts a well-formed team scenario', () => {
    const steps = [
      { as: 'ana', in: 'studio', say: 'hi' },
      { as: 'bo', in: 'studio', reply_to: 1, say: 'me too' },
      { as: 'ana', in: 'studio', reply_to: 1, answer_ask: true, say: 'separately' },
      { concurrent: [{ as: 'ana', in: 'studio', say: 'a' }, { as: 'bo', dm: 'ana', say: 'b' }] },
    ];
    expect(validateTeamScenario({ scenario: SCENARIO, steps })).toEqual([]);
  });

  it('catches the faults that would waste an hour of live LLM time', () => {
    const steps = [
      { as: 'nobody', in: 'studio', say: 'hi' },
      { as: 'ana', in: 'nowhere', say: 'hi' },
      { as: 'ana', say: 'hi' }, // no in/dm
      { in: 'studio', say: 'hi' }, // no as
      { as: 'ana', in: 'studio', reply_to: 9, say: 'hi' }, // forward reference
      { as: 'ana', in: 'studio', answer_ask: true, say: 'hi' }, // no reply_to
      { as: 'ana', in: 'studio', reply_to: 4, say: 'hi' }, // step 4 has a say, so this one is fine
    ];
    const problems = validateTeamScenario({ scenario: SCENARIO, steps });
    expect(problems).toEqual([
      'step 1: `as: nobody` is not in the cast',
      'step 2: `in: nowhere` is not a declared channel',
      'step 3: a message needs `in:` or `dm:`',
      'step 4: a message needs `as:`',
      'step 5: `reply_to: 9` must name an EARLIER step',
      'step 6: `answer_ask` needs `reply_to:` — a question is parked in a specific thread',
    ]);
  });

  it('refuses a reply_to that names a step which never speaks', () => {
    const steps = [{ open_app: true }, { as: 'ana', in: 'studio', reply_to: 1, say: 'hi' }];
    expect(validateTeamScenario({ scenario: SCENARIO, steps })).toEqual([
      'step 2: `reply_to: 1` — step 1 says nothing, so it has no thread',
    ]);
  });
});

describe('teamPlanLines', () => {
  it('shows who speaks where, and flags a concurrent beat as one instant', () => {
    const steps = [
      { as: 'ana', in: 'studio', say: 'hello there' },
      { concurrent: [{ as: 'bo', in: 'studio', say: 'x' }, { as: 'vic', dm: 'ana', say: 'y' }] },
    ];
    const out = teamPlanLines({ scenario: SCENARIO, steps }).join('\n');
    expect(out).toContain('cast (3): ana<editor>, bo<editor>, vic<viewer>');
    expect(out).toContain('ana<editor> in #studio: hello there');
    expect(out).toContain('[concurrent × 2]');
    expect(out).toContain('vic<viewer> in DM with ana');
    expect(out).toContain('✅');
  });
});

describe('summarizeTeamTurn', () => {
  it('records WHO said it, WHERE, and in WHICH thread — the whole difference from a personal turn', () => {
    const turn = {
      status: 'done',
      ok: true,
      text: 'answered',
      blocks: [{ type: 'Heading' }, { type: 'Table' }],
      threadId: 'th-1',
      sessionId: 'sess-1',
      asks: [{ message: { text: 'which one?', ask: { id: 'ask-1', expiresAt: 'soon' } }, answeredWith: 'the first' }],
      answered: 1,
      activity: ['thinking'],
      apps: [{ projectId: 'jobs' }],
      replies: [{}, {}],
      durationMs: 1234,
    };
    const rec = summarizeTeamTurn(turn, { who: 'ana', role: 'editor', channel: 'studio', sent: 'hi' });
    expect(rec).toMatchObject({
      who: 'ana',
      role: 'editor',
      channel: 'studio',
      dm: false,
      threadId: 'th-1',
      sessionId: 'sess-1',
      status: 'done',
      lastText: 'answered',
      blocks: ['Heading', 'Table'],
      blockCount: 2,
      answeredAsks: 1,
      ledgerTracked: false,
    });
    // The pod names an ask now; a turn recorded without one still carries the null explicitly, so
    // "there was no ask id" and "we forgot to record it" stay distinguishable in the evidence.
    expect(rec.asks[0]).toEqual({ text: 'which one?', askId: 'ask-1', expiresAt: 'soon', answeredWith: 'the first' });
  });

  it('survives a turn that never ran (the pod refused the message)', () => {
    const rec = summarizeTeamTurn(null, { who: 'vic', role: 'viewer', channel: 'studio', sent: 'do a thing' });
    expect(rec.status).toBe('not-run');
    expect(rec.ok).toBe(false);
    expect(rec.lastText).toBe('');
  });
});

describe('attributeLedger', () => {
  it('attributes a turn to its OWN session, never a sibling turn\'s', () => {
    const turns = [
      summarizeTeamTurn({ sessionId: 'a' }, { who: 'ana', role: 'editor', channel: 'x', sent: '1' }),
      summarizeTeamTurn({ sessionId: 'b' }, { who: 'bo', role: 'editor', channel: 'y', sent: '2' }),
      summarizeTeamTurn({ sessionId: 'missing' }, { who: 'cai', role: 'editor', channel: 'z', sent: '3' }),
    ];
    attributeLedger(turns, [
      { sessionId: 'a', totalInputTokens: 10, totalOutputTokens: 2, totalCostUsd: 0.1, status: 'done', delegates: [{ target: 'system-viewbuilder/builder', status: 'done', depth: 0, durationMs: 5 }] },
      { sessionId: 'b', totalInputTokens: 4, totalOutputTokens: 1, totalCostUsd: 0.05, status: 'done', delegates: [] },
    ]);
    expect(turns[0].delegates).toEqual(['system-viewbuilder/builder']);
    expect(turns[0].tokens).toEqual({ in: 10, out: 2 });
    expect(turns[0].ledgerTracked).toBe(true);
    expect(turns[1].delegates).toEqual([]);
    // The pod has no ledger record for a channel turn — that must stay visible, not read as zero work.
    expect(turns[2].ledgerTracked).toBe(false);
    expect(turns[2].delegates).toEqual([]);
  });
});

describe('threadSessionFacts', () => {
  function writeSnapshot(dataDir, projectId, sessionId, statements) {
    const dir = join(dataDir, '.lmthing', projectId, 'sessions', sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'snapshot.json'),
      JSON.stringify({
        sessionId,
        history: [{ role: 'user', content: 'build it' }, ...statements.map((s) => ({ role: 'assistant', content: s }))],
      }),
    );
  }

  it('recovers the delegate target and the globals from the code the model wrote', () => {
    const d = mkTmp();
    writeSnapshot(d, 'user', 's1', [
      "const plan = await delegate({ space: 'system-viewbuilder', agent: 'builder', query: 'jobs board' });",
      "await writeProjectTable('jobs', schema); await db.insert('jobs', row); display(<Stack/>);",
    ]);
    const facts = threadSessionFacts(d, 'user', 's1');
    expect(facts.statements).toBe(2);
    expect(facts.delegates).toEqual(['system-viewbuilder/builder']);
    expect(facts.spacesMentioned).toEqual(['system-viewbuilder']);
    expect(facts.globals).toEqual(expect.arrayContaining(['writeProjectTable', 'display']));
    expect(facts.db).toEqual(['db.insert']);
  });

  it('reads the positional delegate form too', () => {
    const d = mkTmp();
    writeSnapshot(d, 'user', 's2', ["await delegate('system-appbuilder/automator', { query: 'x' });"]);
    expect(threadSessionFacts(d, 'user', 's2').delegates).toEqual(['system-appbuilder/automator']);
  });

  it('returns null rather than throwing when the session left no snapshot', () => {
    const d = mkTmp();
    expect(threadSessionFacts(d, 'user', 'nope')).toBeNull();
    expect(threadSessionFacts(d, 'user', undefined)).toBeNull();
  });
});

describe('compactTeamStep / teamTraceLines', () => {
  const rec = {
    step: 3,
    verbs: ['as', 'in', 'say'],
    expect: ['it answers Bo'],
    team: 't1',
    activeProject: 'jobs',
    notes: [],
    turns: [
      {
        ...summarizeTeamTurn(
          { status: 'done', ok: true, text: 'here you go', threadId: 'th-1', sessionId: 's1', durationMs: 2000, asks: [] },
          { who: 'bo', role: 'editor', channel: 'studio', sent: 'can it also show…' },
        ),
        wrote: { statements: 2, delegates: ['system-viewbuilder/builder'], spacesMentioned: ['system-viewbuilder'], globals: ['writeProjectTable'], db: ['db.insert'], code: 'x' },
      },
    ],
    denied: { who: 'vic', role: 'viewer', channel: 'studio', status: 403, body: { error: 'viewers cannot change this team workspace' } },
    crossChannelPosts: [{ channelId: 'studio', kind: 'thing', text: 'Cai says the colour is off' }],
    state: { spaces: [], appTables: { jobs: [1, 2, 3] }, appManifest: null },
  };

  it('keeps every attribution field the judge needs, and the refusal as evidence', () => {
    const c = compactTeamStep(rec);
    expect(c.step).toBe(3);
    expect(c.turns[0]).toMatchObject({ who: 'bo', role: 'editor', channel: 'studio', threadId: 'th-1', status: 'done' });
    expect(c.turns[0].wrote.delegates).toEqual(['system-viewbuilder/builder']);
    expect(c.denied.status).toBe(403);
    expect(c.crossChannelPosts[0].channelId).toBe('studio');
    expect(c.activeProject).toBe('jobs');
    // The shared state projection still works (row COUNTS, not rows).
    expect(c.state.appTables).toEqual({ jobs: 3 });
  });

  it('carries the fired emitter into the compact step — the judge reads that file, not the dump', () => {
    const withEmitter = {
      ...rec,
      runEmitter: { requested: { scope: 'newsroom', name: 'morning_brief' }, resolved: null, how: 'UNRESOLVED', available: { emitterDefs: [], hookSlugs: [] } },
    };
    expect(compactTeamStep(withEmitter).runEmitter.how).toBe('UNRESOLVED');
    expect(compactTeamStep(rec).runEmitter).toBeUndefined();
  });

  it('writes a trace a human can read who-said-what from', () => {
    const md = teamTraceLines(rec).join('\n');
    expect(md).toContain('**bo** <editor> in #studio');
    expect(md).toContain('delegated to: system-viewbuilder/builder');
    expect(md).toContain('⛔ REFUSED by the pod: 403');
    expect(md).toContain('THING posted into channels nobody asked it from');
    expect(md).toContain('- [ ] it answers Bo');
  });
});

describe('resolveEmitter', () => {
  const defs = [
    { scope: 'newsroom-desk', name: 'morningBrief', type: 'cron', slug: '@emitter:newsroom-desk:morningBrief' },
    { scope: 'newsroom-desk', name: 'onStoryFiled', type: 'internal', slug: '@emitter:newsroom-desk:onStoryFiled' },
  ];

  it('matches the model-authored name the scenario could only guess at', () => {
    // The yaml says `{scope: newsroom, name: morning_brief}` — neither the scope nor the exact
    // spelling survives contact with what the model actually wrote.
    const r = resolveEmitter({ scope: 'newsroom', name: 'morning_brief' }, defs);
    expect(r.resolved.slug).toBe('@emitter:newsroom-desk:morningBrief');
    expect(r.how).toMatch(/fuzzy|name-match/);
  });

  it('prefers an exact name in the right scope', () => {
    const r = resolveEmitter({ scope: 'newsroom-desk', name: 'morningBrief' }, defs);
    expect(r.how).toBe('exact');
  });

  it('falls back to the only cron def when nothing matches by name', () => {
    const r = resolveEmitter({ scope: 'x', name: 'zzz' }, defs);
    expect(r.resolved.name).toBe('morningBrief');
    expect(r.how).toMatch(/exactly one cron def/);
  });

  it('reports UNRESOLVED with everything it saw, instead of firing something wrong', () => {
    const r = resolveEmitter({ scope: 'x', name: 'zzz' }, [
      { scope: 's', name: 'aaa', type: 'internal', slug: '@emitter:s:aaa' },
      { scope: 's', name: 'bbb', type: 'internal', slug: '@emitter:s:bbb' },
    ]);
    expect(r.resolved).toBeNull();
    expect(r.how).toBe('UNRESOLVED');
    expect(r.seen.emitterDefs).toHaveLength(2);
  });

  it('passes a literal slug straight through', () => {
    expect(resolveEmitter('weekly-reconcile', defs).how).toBe('literal');
    expect(resolveEmitter('weekly-reconcile', defs).resolved.slug).toBe('weekly-reconcile');
  });
});

describe('scanEmitterDefs', () => {
  it('finds project- and space-scoped defs with their cron type', () => {
    const d = mkTmp();
    const proj = join(d, '.lmthing', 'newsroom');
    mkdirSync(join(proj, 'events'), { recursive: true });
    writeFileSync(join(proj, 'events', 'brief.ts'), `export const morningBrief = { type: 'cron', daily: '07:00', handler: async () => {} };`);
    mkdirSync(join(proj, 'spaces', 'desk', 'events'), { recursive: true });
    writeFileSync(join(proj, 'spaces', 'desk', 'events', 'filed.ts'), `export const onFiled: EmitterDef = { type: 'internal' };`);

    const defs = scanEmitterDefs(d, 'newsroom');
    expect(defs).toEqual([
      expect.objectContaining({ scope: 'newsroom', name: 'morningBrief', type: 'cron', slug: '@emitter:newsroom:morningBrief' }),
      expect.objectContaining({ scope: 'desk', name: 'onFiled', type: 'internal', slug: '@emitter:desk:onFiled' }),
    ]);
  });

  it('is empty, not throwing, for a project with no events dir', () => {
    expect(scanEmitterDefs(mkTmp(), 'nope')).toEqual([]);
  });
});

/**
 * `runTeamStep`'s verb branches, against fakes.
 *
 * The pure helpers above were tested; the DISPATCH was not — and a plain scoping slip
 * (`channelsBefore` read inside `runTeamStep` while it was declared in the run loop) survived every
 * test and killed 21-newsroom's step 5, the one beat that run existed to exercise. A live run is far
 * too expensive to be the first thing that executes a branch.
 */
describe('TeamScenarioRunner.runTeamStep — verb dispatch', () => {
  function mkRunner(steps = []) {
    const r = new TeamScenarioRunner({ scenario: { ...SCENARIO, steps }, steps, scenarioDir: '/tmp/x' });
    r.liveness = null;
    return r;
  }
  const fakePod = () => ({
    member: (w) => ({ name: w, role: 'editor', userId: `u-${w}` }),
    members: () => [{ name: 'ana', role: 'editor', userId: 'u-ana' }],
    listChannels: async () => ({ channels: [{ id: 'newsroom', name: 'newsroom' }] }),
    listMessages: async () => ({ messages: [] }),
  });

  it('run_emitter resolves the real slug, fires it, and waits for the post', async () => {
    const d = mkTmp();
    const proj = join(d, '.lmthing', 'newsroom');
    mkdirSync(join(proj, 'events'), { recursive: true });
    writeFileSync(join(proj, 'events', 'brief.ts'), `export const morningBrief = { type: 'cron', daily: '07:00' };`);

    const fired = [];
    const readPod = {
      listHooks: async () => ({ hooks: [] }),
      runHook: async (p, slug) => {
        fired.push({ p, slug });
        return { ok: true, events: 1 };
      },
      listProjects: async () => ({ projects: [{ id: 'newsroom' }] }),
    };
    const runner = mkRunner();
    // The post lands on the second poll — the wait must actually observe it, not sleep blindly.
    let polls = 0;
    runner.channelSnapshot = async () => [{ id: 'newsroom', count: ++polls > 1 ? 1 : 0 }];

    const rec = { step: 5, verbs: ['run_emitter'], expect: [], turns: [], asks: [], notes: [] };
    const step = { run_emitter: { scope: 'newsroom', name: 'morning_brief' } };
    const project = await runner.runTeamStep({
      step, num: 5, pod: fakePod(), readPod, run: { dataDir: d }, rec,
      activeProject: 'newsroom', setup: { editor: 'ana' }, channelsBefore: [{ id: 'newsroom', count: 0 }],
    });

    expect(project).toBe('newsroom');
    // The yaml said `morning_brief`; the model wrote `morningBrief`. The real slug is what was fired.
    expect(fired).toEqual([{ p: 'newsroom', slug: '@emitter:newsroom:morningBrief' }]);
    expect(rec.runEmitter.resolved.name).toBe('morningBrief');
    expect(rec.runEmitter.requested).toEqual({ scope: 'newsroom', name: 'morning_brief' });
    expect(rec.runEmitter.postedAfterMs).toBeGreaterThanOrEqual(0);
    expect(rec.notes.join(' ')).toMatch(/fired @emitter:newsroom:morningBrief/);
    expect(rec.notes.join(' ')).toMatch(/produced a post in #newsroom/);
  }, 30000);

  it('run_emitter records what the run DOES have when nothing matches, and fires nothing', async () => {
    const d = mkTmp();
    const readPod = { listHooks: async () => ({ hooks: [] }), runHook: async () => { throw new Error('must not fire'); }, listProjects: async () => ({ projects: [] }) };
    const runner = mkRunner();
    runner.channelSnapshot = async () => [];
    const rec = { step: 5, verbs: ['run_emitter'], expect: [], turns: [], asks: [], notes: [] };
    await runner.runTeamStep({
      step: { run_emitter: { scope: 'newsroom', name: 'morning_brief' } },
      num: 5, pod: fakePod(), readPod, run: { dataDir: d }, rec,
      activeProject: 'newsroom', setup: { editor: 'ana' }, channelsBefore: [],
    });
    expect(rec.runEmitter.resolved).toBeNull();
    expect(rec.runEmitter.how).toBe('UNRESOLVED');
    expect(rec.notes.join(' ')).toMatch(/nothing matches/);
  });

  it('open_app records build, check and the served page without throwing on a broken app', async () => {
    const runner = mkRunner();
    const readPod = {
      appBuild: async () => ({ built: false, error: 'boom' }),
      appCheck: async () => ({ ok: false, errors: [{ phase: 'typecheck', file: 'pages/index.tsx', line: 3, message: 'nope' }] }),
      appPage: async () => ({ status: 500 }),
      listProjects: async () => ({ projects: [] }),
    };
    const rec = { step: 8, verbs: ['open_app'], expect: [], turns: [], asks: [], notes: [] };
    await runner.runTeamStep({
      step: { open_app: true }, num: 8, pod: fakePod(), readPod, run: { dataDir: mkTmp() }, rec,
      activeProject: 'newsroom', setup: { editor: 'ana' }, channelsBefore: [],
    });
    expect(rec.appBuild.built).toBe(false);
    expect(rec.appCheck.ok).toBe(false);
    expect(rec.appPageStatus).toBe(500);
  });
});

describe('jargonHits', () => {
  it('catches the machine words THING used on a journalist, with the sentence around each', () => {
    const hits = jargonHits(
      'School closures — now in its own space. The tracking app and specialist space are live. Open it at the Alcalá Post project.',
    );
    expect(hits.map((h) => h.word).sort()).toEqual(['project', 'space', 'specialist']);
    expect(hits[0].context).toContain('its own space');
  });

  it('is quiet for a reply written in the persona\'s own words', () => {
    expect(jargonHits('The Almeida job is waiting on the client — Bo has it. I have put it at the top of the list.')).toEqual([]);
  });

  it('matches whole words only, so ordinary prose is not flagged', () => {
    // "spacious" is not "space"; a scan that fires on substrings is a scan nobody reads.
    expect(jargonHits('the spacious studio')).toEqual([]);
    expect(jargonHits('an apitite for detail')).toEqual([]);
  });

  it('survives an empty or missing reply', () => {
    expect(jargonHits(undefined)).toEqual([]);
    expect(jargonHits('')).toEqual([]);
  });
});

describe('provider outage attribution', () => {
  it('reads an outage out of the step\'s own slice of the server log', () => {
    const d = mkTmp();
    const log = join(d, 'sessions.log');
    writeFileSync(log, 'boot ok\n[turn 1] streaming...\n');
    const mark = logSize(log);
    // Nothing after the mark yet — a failure here is the product's.
    expect(providerOutageInLog(log, mark)).toBeNull();

    writeFileSync(log, readFileSync(log, 'utf8') +
      'Cannot connect to API: Connect Timeout Error (attempted address: lmthing-resource.openai.azure.com:443, timeout: 10000ms)\n');
    const hit = providerOutageInLog(log, mark);
    expect(hit.signature).toBe('Cannot connect to API');
    expect(hit.context).toContain('openai.azure.com:443');
    // And an EARLIER outage must not be blamed on a later step.
    expect(providerOutageInLog(log, logSize(log))).toBeNull();
  });

  it('finds the retry-exhausted signature too', () => {
    const d = mkTmp();
    const log = join(d, 'sessions.log');
    writeFileSync(log, 'Stream error: Failed after 3 attempts.\n');
    expect(providerOutageInLog(log, 0).signature).toMatch(/Failed after 3 attempts/);
  });
});
