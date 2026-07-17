import { describe, expect, it } from 'vitest';
import { StepAsks } from './asks.mjs';

const consent = { type: 'ConsentCard', space: 'system-store' };
const question = (prompt) => ({ type: 'Ask', prompt });

describe('StepAsks — the driver ask handler (reentrant)', () => {
  it('approves consent by default and records it', () => {
    const a = new StepAsks();
    a.begin({});
    expect(a.onAsk(consent)).toBe(true);
    expect(a.drain()).toEqual([{ kind: 'consent', answer: true, descriptor: consent }]);
  });

  it('denies consent when the step opts in', () => {
    const a = new StepAsks();
    a.begin({ deny_consent: true });
    expect(a.onAsk(consent)).toBe(false);
  });

  it('answers a question from if_asked by fuzzy key match', () => {
    const a = new StepAsks();
    a.begin({ if_asked: { 'what is your budget': '3000 euros' } });
    expect(a.onAsk(question('So what is your budget for the trip?'))).toBe('3000 euros');
    expect(a.drain()[0].matched).toBe('what is your budget');
  });

  it('falls back to the SOLE if_asked entry when nothing matches', () => {
    const a = new StepAsks();
    a.begin({ if_asked: { 'only-entry-key': 'the-answer' } });
    expect(a.onAsk(question('completely unrelated'))).toBe('the-answer');
  });

  it('records an unmatched multi-entry question as an empty answer', () => {
    const a = new StepAsks();
    a.begin({ if_asked: { 'budget for the safari trip': '3000', 'visa requirements for tanzania': 'evisa' } });
    expect(a.onAsk(question('totally unrelated words xyz'))).toBe('');
    expect(a.drain()[0]).toMatchObject({ kind: 'question', matched: null, answer: '' });
  });

  it('is reentrant — two instances keep independent logs', () => {
    const a = new StepAsks();
    const b = new StepAsks();
    a.begin({});
    b.begin({ deny_consent: true });
    a.onAsk(consent);
    b.onAsk(consent);
    expect(a.drain()).toEqual([{ kind: 'consent', answer: true, descriptor: consent }]);
    expect(b.drain()).toEqual([{ kind: 'consent', answer: false, descriptor: consent }]);
  });

  it('begin() clears the previous step log', () => {
    const a = new StepAsks();
    a.begin({});
    a.onAsk(consent);
    a.begin({});
    expect(a.drain()).toEqual([]);
  });
});
