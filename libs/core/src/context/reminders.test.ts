import { describe, it, expect } from 'vitest';
import { ReminderRegistry } from './reminders.js';

describe('ReminderRegistry — generic per-turn reminders', () => {
  it('composes non-empty providers in registration order, blank-line separated', () => {
    const r = new ReminderRegistry()
      .add(() => 'first')
      .add(() => undefined)
      .add(() => '  ')       // whitespace-only → dropped
      .add(() => 'second');
    expect(r.collect()).toBe('first\n\nsecond');
    expect(r.size).toBe(4);
  });

  it('returns undefined when no provider has anything to say', () => {
    const r = new ReminderRegistry().add(() => undefined).add(() => '');
    expect(r.collect()).toBeUndefined();
  });

  it('trims each provider output', () => {
    const r = new ReminderRegistry().add(() => '  hi  ');
    expect(r.collect()).toBe('hi');
  });

  it('isolates a throwing provider — one broken reminder never breaks the turn', () => {
    const r = new ReminderRegistry()
      .add(() => 'ok')
      .add(() => { throw new Error('boom'); })
      .add(() => 'still here');
    expect(r.collect()).toBe('ok\n\nstill here');
  });

  it('re-evaluates providers every call (dynamic state)', () => {
    let named = false;
    const r = new ReminderRegistry().add(() => (named ? undefined : 'name it'));
    expect(r.collect()).toBe('name it');
    named = true;
    expect(r.collect()).toBeUndefined();
  });
});
