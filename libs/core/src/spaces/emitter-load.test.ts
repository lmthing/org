import { describe, it, expect } from 'vitest';
import { validateEmitterDef, collectDeclaredEvents, buildEventPayloadsDts } from './emitter-load.js';
import type { EmitterDef, EmitsSchema, LoadedEmitter } from './emitter-def.js';

const emit = () => [];
const asyncEmit = async () => [];

describe('validateEmitterDef — per-type', () => {
  it('accepts a webhook emitter with a declarative verify spec', () => {
    const def = validateEmitterDef(
      {
        type: 'webhook',
        path: 'slack-inbound',
        verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-sig' },
        secretEnv: 'INTEGRATION_SLACK_SECRET',
        emits: { 'message.posted': { payload: { text: 'string', user: 'string' } } },
        emit,
      },
      'events/slack.ts',
    );
    expect(def.type).toBe('webhook');
  });

  it('accepts the builtin verify shorthand (slack/github)', () => {
    for (const provider of ['slack', 'github'] as const) {
      const def = validateEmitterDef(
        {
          type: 'webhook',
          path: 'in',
          verify: { type: 'builtin', provider },
          emits: { 'e.one': { payload: { a: 'number' } } },
          emit,
        },
        'w.ts',
      ) as Extract<EmitterDef, { type: 'webhook' }>;
      expect(def.verify).toEqual({ type: 'builtin', provider });
    }
  });

  it('accepts a cron emitter with exactly one schedule', () => {
    const def = validateEmitterDef(
      {
        type: 'cron',
        every: '30m',
        connections: ['slack'],
        emits: { 'poll.tick': { payload: { count: 'number' } } },
        emit: asyncEmit,
      },
      'events/poll.ts',
    );
    expect(def.type).toBe('cron');
    expect((def as Extract<EmitterDef, { type: 'cron' }>).connections).toEqual(['slack']);
  });

  it('accepts a db emitter', () => {
    const def = validateEmitterDef(
      {
        type: 'db',
        on: { table: 'raw_items', event: 'insert' },
        emits: { 'item.created': { payload: { id: 'string', row: 'object' } } },
        emit,
      },
      'events/item.ts',
    );
    expect(def.type).toBe('db');
    expect((def as Extract<EmitterDef, { type: 'db' }>).on).toEqual({ table: 'raw_items', event: 'insert' });
  });

  it('accepts an internal emitter', () => {
    const def = validateEmitterDef(
      {
        type: 'internal',
        on: { signal: 'session.completed' },
        emits: { 'lmthing.session.completed': { payload: { projectId: 'string', ok: 'boolean' } } },
        emit,
      },
      'events/lmthing.ts',
    );
    expect(def.type).toBe('internal');
  });
});

describe('validateEmitterDef — rejections', () => {
  it('rejects an unknown type', () => {
    expect(() =>
      validateEmitterDef({ type: 'wat', emits: { 'a.b': { payload: {} } }, emit }, 'x.ts'),
    ).toThrow(/`type` must be/);
  });

  it('rejects a missing emit function', () => {
    expect(() =>
      validateEmitterDef({ type: 'db', on: { table: 't', event: 'insert' }, emits: {} }, 'x.ts'),
    ).toThrow(/needs an `emit` function/);
  });

  it('rejects a bad verify spec on a webhook', () => {
    expect(() =>
      validateEmitterDef(
        { type: 'webhook', path: 'p', verify: { type: 'bogus' }, emits: { 'a.b': { payload: {} } }, emit },
        'x.ts',
      ),
    ).toThrow(/invalid `verify`/);
  });

  it('rejects an unsupported builtin provider', () => {
    expect(() =>
      validateEmitterDef(
        { type: 'webhook', path: 'p', verify: { type: 'builtin', provider: 'discord' }, emits: { 'a.b': { payload: {} } }, emit },
        'x.ts',
      ),
    ).toThrow(/provider 'slack' \| 'github'/);
  });

  it('rejects a bad webhook path', () => {
    expect(() =>
      validateEmitterDef(
        { type: 'webhook', path: 'bad path', verify: { type: 'none' }, emits: { 'a.b': { payload: {} } }, emit },
        'x.ts',
      ),
    ).toThrow(/invalid `path`/);
  });

  it('rejects a cron with both every and daily', () => {
    expect(() =>
      validateEmitterDef(
        { type: 'cron', every: '5m', daily: '08:00', emits: { 'a.b': { payload: {} } }, emit: asyncEmit },
        'x.ts',
      ),
    ).toThrow(/exactly one of `every` or `daily`/);
  });

  it('rejects a cron with an invalid every', () => {
    expect(() =>
      validateEmitterDef({ type: 'cron', every: 'soon', emits: { 'a.b': { payload: {} } }, emit: asyncEmit }, 'x.ts'),
    ).toThrow(/invalid `every`/);
  });

  it('rejects a db emitter with a bad event', () => {
    expect(() =>
      validateEmitterDef({ type: 'db', on: { table: 't', event: 'upsert' }, emits: { 'a.b': { payload: {} } }, emit }, 'x.ts'),
    ).toThrow(/`on.event` must be/);
  });

  it('rejects an internal emitter without a signal', () => {
    expect(() =>
      validateEmitterDef({ type: 'internal', on: {}, emits: { 'a.b': { payload: {} } }, emit }, 'x.ts'),
    ).toThrow(/needs `on: { signal }`/);
  });

  it('rejects an invalid event name', () => {
    expect(() =>
      validateEmitterDef({ type: 'db', on: { table: 't', event: 'insert' }, emits: { 'Bad.Name': { payload: {} } }, emit }, 'x.ts'),
    ).toThrow(/invalid event name/);
  });

  it('rejects an invalid payload typeString', () => {
    expect(() =>
      validateEmitterDef(
        { type: 'db', on: { table: 't', event: 'insert' }, emits: { 'a.b': { payload: { x: 'int' } } }, emit },
        'x.ts',
      ),
    ).toThrow(/invalid typeString/);
  });

  it('rejects an empty emits block', () => {
    expect(() =>
      validateEmitterDef({ type: 'db', on: { table: 't', event: 'insert' }, emits: {}, emit }, 'x.ts'),
    ).toThrow(/at least one event/);
  });
});

describe('collectDeclaredEvents', () => {
  const load = (name: string, emits: EmitsSchema): LoadedEmitter => ({
    name,
    def: { type: 'db', on: { table: 't', event: 'insert' }, emits, emit } as EmitterDef,
  });

  it('merges emits across defs in a scope', () => {
    const union = collectDeclaredEvents([
      load('a', { 'a.one': { payload: { x: 'string' } } }),
      load('b', { 'b.two': { payload: { y: 'number' } } }),
    ]);
    expect(Object.keys(union).sort()).toEqual(['a.one', 'b.two']);
  });

  it('throws fail-loud on a duplicate event name across two defs', () => {
    expect(() =>
      collectDeclaredEvents([
        load('a', { 'shared.evt': { payload: { x: 'string' } } }),
        load('b', { 'shared.evt': { payload: { y: 'number' } } }),
      ]),
    ).toThrow(/duplicate event "shared.evt"/);
  });
});

describe('buildEventPayloadsDts', () => {
  it('builds an EventPayloads interface with mapped TS types, sorted', () => {
    const dts = buildEventPayloadsDts({
      'z.last': { payload: { flag: 'boolean' } },
      'a.first': { payload: { name: 'string', count: 'number', meta: 'object', items: 'array', misc: 'any' } },
    });
    expect(dts).toContain('declare interface EventPayloads {');
    // sorted: a.first before z.last
    expect(dts.indexOf('"a.first"')).toBeLessThan(dts.indexOf('"z.last"'));
    expect(dts).toContain('"count": number');
    expect(dts).toContain('"name": string');
    expect(dts).toContain('"meta": Record<string, unknown>');
    expect(dts).toContain('"items": unknown[]');
    expect(dts).toContain('"misc": unknown');
    expect(dts).toContain('"flag": boolean');
  });

  it('handles an empty union', () => {
    expect(buildEventPayloadsDts({})).toBe('declare interface EventPayloads {\n}');
  });

  it('emits optional members for `?`-suffixed typeStrings', () => {
    const dts = buildEventPayloadsDts({
      'message.received': { payload: { text: 'string', threadKey: 'string?', userName: 'string?' } },
    });
    // required field: non-optional; optional fields: `?:` with the base type
    expect(dts).toContain('"text": string');
    expect(dts).toContain('"threadKey"?: string');
    expect(dts).toContain('"userName"?: string');
  });
});

describe('optional (`?`) payload typeStrings', () => {
  const base = {
    name: 'integration-x',
    lmthing: { kind: 'integration', title: 'X' },
  };
  it('accepts a payload field with a trailing `?`', () => {
    const def = {
      type: 'webhook',
      path: 'x',
      verify: { type: 'builtin', provider: 'slack' },
      emits: { 'message.received': { payload: { text: 'string', threadKey: 'string?', userName: 'string?' } } },
      emit: () => [],
    };
    expect(() => validateEmitterDef(def, 'integration-x/events/messages.ts')).not.toThrow();
  });
  it('still rejects an unknown base type even with `?`', () => {
    const def = {
      type: 'webhook',
      path: 'x',
      verify: { type: 'builtin', provider: 'slack' },
      emits: { 'message.received': { payload: { text: 'weird?' } } },
      emit: () => [],
    };
    expect(() => validateEmitterDef(def, 'integration-x/events/messages.ts')).toThrow(/invalid typeString/);
  });
  void base;
});
