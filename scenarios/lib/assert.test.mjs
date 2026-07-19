import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, evaluateAll, isRawReply, flattenReply } from './assert.mjs';

// A minimal context: appTables carry ROWS (the full snapshot, not the compacted counts), turns carry
// the reply + yield kinds — exactly what ScenarioRunner returns in `rec.state` / `rec.turns`.
const ctx = (over = {}) => ({
  state: {
    appTables: {
      safari_segments: [
        { id: 's1', day: 'Aug 8', place: 'Lake Manyara', note: 'ranger tip ~5000 TZS' },
        { id: 's2', day: 'Aug 9', place: 'Ngorongoro', note: 'crater descent' },
      ],
      recipes: [{ id: 'r1', name: 'Μουσακάς', favorite: true }, { id: 'r2', name: 'Χωριάτικη', favorite: false }],
    },
    spaces: ['Zanzibar Stay Advisor'],
  },
  turns: [{ lastText: JSON.stringify({ type: 'Stack', children: ['Tarangire then Lake Manyara'] }), yieldKinds: ['inspect', 'delegate'] }],
  dataDir: null,
  projectId: 'p',
  ...over,
});

describe('db asserts', () => {
  it('count with each operator', () => {
    expect(evaluate('db safari_segments count == 2', ctx()).pass).toBe(true);
    expect(evaluate('db safari_segments count >= 2', ctx()).pass).toBe(true);
    expect(evaluate('db safari_segments count > 2', ctx()).pass).toBe(false);
    expect(evaluate('db safari_segments count < 3', ctx()).pass).toBe(true);
    expect(evaluate('db safari_segments count != 1', ctx()).pass).toBe(true);
  });
  it('a missing table is zero rows, not a throw', () => {
    expect(evaluate('db nope count == 0', ctx()).pass).toBe(true);
  });
  it('where exists / absent', () => {
    expect(evaluate('db safari_segments where day="Aug 9" exists', ctx()).pass).toBe(true);
    expect(evaluate('db safari_segments where day="Aug 7" exists', ctx()).pass).toBe(false);
    expect(evaluate('db safari_segments where day="Aug 7" absent', ctx()).pass).toBe(true);
  });
  it('quoted values keep their spaces', () => {
    expect(evaluate('db safari_segments where place="Lake Manyara" exists', ctx()).pass).toBe(true);
  });
  it('where field empty / nonempty (row-vs-field grain)', () => {
    // the retract-fact fix: the record survives, only the note field is cleared
    const cleared = ctx();
    cleared.state.appTables.safari_segments[0].note = '';
    expect(evaluate('db safari_segments where day="Aug 8" note empty', cleared).pass).toBe(true);
    expect(evaluate('db safari_segments where day="Aug 8" note empty', ctx()).pass).toBe(false);
    expect(evaluate('db safari_segments where day="Aug 9" note nonempty', ctx()).pass).toBe(true);
  });
  it('where field == / !=', () => {
    expect(evaluate('db recipes where name="Μουσακάς" favorite == true', ctx()).pass).toBe(true);
    expect(evaluate('db recipes where name="Χωριάτικη" favorite == true', ctx()).pass).toBe(false);
    expect(evaluate('db recipes where name="Χωριάτικη" favorite != true', ctx()).pass).toBe(true);
  });
  it('a where-field assert on a non-existent row FAILS (never silently passes)', () => {
    expect(evaluate('db safari_segments where day="Aug 1" note empty', ctx()).pass).toBe(false);
  });
});

describe('reply asserts', () => {
  it('not_raw: a raw data dump fails, a component AST / prose passes', () => {
    const raw = ctx({ turns: [{ lastText: JSON.stringify({ ok: true, entries: ['.data', 'api', 'database'] }), yieldKinds: [] }] });
    expect(evaluate('reply not_raw', raw).pass).toBe(false);
    expect(evaluate('reply not_raw', ctx()).pass).toBe(true); // component AST
    const prose = ctx({ turns: [{ lastText: 'Your safari runs Aug 7–9.', yieldKinds: [] }] });
    expect(evaluate('reply not_raw', prose).pass).toBe(true);
    const arr = ctx({ turns: [{ lastText: '[{"id":1},{"id":2}]', yieldKinds: [] }] });
    expect(evaluate('reply not_raw', arr).pass).toBe(false); // a bare rows array is raw
  });
  it('matches / not_matches over the FLATTENED reply text', () => {
    expect(evaluate('reply matches /Tarangire/', ctx()).pass).toBe(true);
    expect(evaluate('reply matches /webSearch/', ctx()).pass).toBe(false);
    expect(evaluate('reply not_matches /nothing scheduled/i', ctx()).pass).toBe(true);
  });
});

describe('yield asserts', () => {
  it('present / absent across all turns', () => {
    expect(evaluate('yield present delegate', ctx()).pass).toBe(true);
    expect(evaluate('yield absent webSearch', ctx()).pass).toBe(true);
    expect(evaluate('yield present webSearch', ctx()).pass).toBe(false);
  });
});

describe('isRawReply / flattenReply', () => {
  it('isRawReply distinguishes data dumps from component trees', () => {
    expect(isRawReply('{"ok":true,"entries":[]}')).toBe(true);
    expect(isRawReply('{"type":"Stack","children":[]}')).toBe(false);
    expect(isRawReply('just prose')).toBe(false);
    expect(isRawReply('[1,2,3]')).toBe(true);
  });
  it('flattenReply pulls text out of an AST (titles, items, children)', () => {
    const ast = JSON.stringify({ type: 'Stack', children: [{ type: 'Heading', children: ['Requirements'] }, { type: 'List', props: { items: ['Visa', 'Permit'] } }] });
    const text = flattenReply(ast);
    expect(text).toContain('Requirements');
    expect(text).toContain('Visa');
    expect(text).toContain('Permit');
  });
});

describe('malformed asserts never silently pass', () => {
  it('an unrecognized assert returns pass:false with an error', () => {
    const r = evaluate('db safari_segments frobnicate 3', ctx());
    expect(r.pass).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('knowledge asserts (reads space knowledge files on disk)', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'repro-know-'));
    const kd = join(dir, '.lmthing', 'p', 'spaces', 'zanzibar-stay-advisor', 'knowledge', 'zanzibar', 'logistics');
    mkdirSync(kd, { recursive: true });
    writeFileSync(join(kd, 'zic-insurance.md'), '# ZIC\nCovers up to 90 days.\nsource: https://example.com\n');
  });
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  it('matches a finding persisted to the right space, misses when absent', () => {
    const c = { dataDir: dir, projectId: 'p', state: {}, turns: [] };
    expect(evaluate('knowledge zanzibar matches /90 days/', c).pass).toBe(true);
    expect(evaluate('knowledge * matches /source:/', c).pass).toBe(true);
    expect(evaluate('knowledge zanzibar matches /Protergia/', c).pass).toBe(false);
    expect(evaluate('knowledge household matches /90 days/', c).pass).toBe(false); // wrong space scope
  });
});

describe('evaluateAll', () => {
  it('green only when every assert passes', () => {
    expect(evaluateAll(['db safari_segments count == 2', 'reply not_raw'], ctx()).green).toBe(true);
    expect(evaluateAll(['db safari_segments count == 2', 'reply matches /webSearch/'], ctx()).green).toBe(false);
  });
});
