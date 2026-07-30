import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
} from './team-runner.mjs';

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
      asks: [{ message: { text: 'which one?' }, answeredWith: 'the first' }],
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
    expect(rec.asks[0]).toEqual({ text: 'which one?', answeredWith: 'the first' });
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

  it('writes a trace a human can read who-said-what from', () => {
    const md = teamTraceLines(rec).join('\n');
    expect(md).toContain('**bo** <editor> in #studio');
    expect(md).toContain('delegated to: system-viewbuilder/builder');
    expect(md).toContain('⛔ REFUSED by the pod: 403');
    expect(md).toContain('THING posted into channels nobody asked it from');
    expect(md).toContain('- [ ] it answers Bo');
  });
});
