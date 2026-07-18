import { describe, expect, it } from 'vitest';
import { parseYaml } from './yaml.mjs';

// This is the minimal YAML-subset parser scenario.yaml is read through. It previously supported
// inline flow ARRAYS (`[a, b]`) but not inline flow MAPS (`{ k: v }`) — a value starting with `{`
// fell through to the bare-scalar branch and came back as the LITERAL STRING `"{ k: v }"` instead
// of an object. Several `scenario.yaml` step verbs use exactly this shape
// (`mutate_schema.change: { column: amount, type: string }`, `inbound[].body: { message: { …,
// chat: { id: '…' } } }`, `set_env: { KEY: "value" }`) — so this went uncaught until a real run's
// `mutate_schema` step threw "change must be {column,type} (retype) or {movePrimaryKeyTo}" because
// `change` was a string, not an object (09-home-renovation run 1, step 14).

describe('parseYaml — inline flow maps', () => {
  it('parses a flat inline flow map to a real object, not a literal string', () => {
    const doc = parseYaml(['steps:', '  - change: { column: amount, type: string }'].join('\n'));
    const change = doc.steps[0].change;
    expect(typeof change).toBe('object');
    expect(change).toEqual({ column: 'amount', type: 'string' });
  });

  it('parses a NESTED inline flow map (map-in-map), the inbound-webhook shape', () => {
    const doc = parseYaml(
      [
        'steps:',
        "  - body: { message: { message_id: 9301, text: \"a b, c\", chat: { id: 'site-updates' }, from: { id: 'astrid' } } }",
      ].join('\n'),
    );
    const body = doc.steps[0].body;
    expect(body).toEqual({
      message: {
        message_id: 9301,
        text: 'a b, c',
        chat: { id: 'site-updates' },
        from: { id: 'astrid' },
      },
    });
  });

  it('parses an inline flow map whose values are quoted strings (set_env shape)', () => {
    const doc = parseYaml(
      ['set_env: { INTEGRATION_DEMO_BASE_URL: "http://x", INTEGRATION_DEMO_API_TOKEN: "tok" }'].join('\n'),
    );
    expect(doc.set_env).toEqual({
      INTEGRATION_DEMO_BASE_URL: 'http://x',
      INTEGRATION_DEMO_API_TOKEN: 'tok',
    });
  });

  it('still parses a plain inline flow array of bare/quoted scalars (unchanged behavior)', () => {
    const doc = parseYaml(['attach: [reno-dump.md, reno-budget.xlsx]'].join('\n'));
    expect(doc.attach).toEqual(['reno-dump.md', 'reno-budget.xlsx']);
  });

  it('parses an empty inline flow map / array', () => {
    const doc = parseYaml(['a: {}', 'b: []'].join('\n'));
    expect(doc.a).toEqual({});
    expect(doc.b).toEqual([]);
  });

  it('parses real scenario.yaml step shapes end-to-end (09-home-renovation mutate_schema + inbound)', () => {
    const doc = parseYaml(
      [
        'steps:',
        '  - mutate_schema:',
        '      table: expenses',
        '      change: { column: amount, type: string }',
        '    fresh_session: true',
        '  - inbound:',
        '      - path: demo',
        "        body: { message: { message_id: 9301, text: \"hi\", chat: { id: 'c1' }, from: { id: 'u1' } } }",
        '        sign: { header: x-demo-signature, prefix: "sha256=", secretEnv: INTEGRATION_DEMO_WEBHOOK_SECRET }',
      ].join('\n'),
    );
    expect(doc.steps[0].mutate_schema.change).toEqual({ column: 'amount', type: 'string' });
    expect(doc.steps[1].inbound[0].body.message.chat).toEqual({ id: 'c1' });
    expect(doc.steps[1].inbound[0].sign).toEqual({
      header: 'x-demo-signature',
      prefix: 'sha256=',
      secretEnv: 'INTEGRATION_DEMO_WEBHOOK_SECRET',
    });
  });
});
