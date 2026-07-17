import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadScenario, planLines } from './scenario.mjs';
import { FatalError } from './errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = dirname(HERE); // scenarios/
const golden = (p) => readFileSync(join(HERE, '__fixtures__', p), 'utf8');

describe('loadScenario', () => {
  it('resolves a bare id against the injected scenarios dir', () => {
    const { scenario, steps, scenarioDir, fixturesDir } = loadScenario('06-tanzania', { here: SCENARIOS });
    expect(scenario.id).toBe('06-tanzania');
    expect(steps.length).toBeGreaterThan(0);
    expect(scenarioDir).toBe(join(SCENARIOS, '06-tanzania'));
    expect(fixturesDir).toBe(join(SCENARIOS, '06-tanzania', 'fixtures'));
  });
  it('throws FatalError when the yaml is missing', () => {
    expect(() => loadScenario('does-not-exist', { here: SCENARIOS })).toThrow(FatalError);
  });
});

describe('planLines (byte golden — the --plan output)', () => {
  for (const id of ['06-tanzania', '07-life-admin']) {
    it(`reproduces --plan for ${id}`, () => {
      const { scenario, steps, fixturesDir } = loadScenario(id, { here: SCENARIOS });
      // The shim prints each line with console.log → lines.join('\n') + a trailing newline.
      const printed = planLines({ scenario, steps, fixturesDir }).join('\n') + '\n';
      expect(printed).toBe(golden(`${id.slice(0, 2)}/plan.txt`));
    });
  }
});

describe('planLines — the direct-pod-probe step verbs', () => {
  it('renders a detail line for every new verb, and NEVER a set_env/blank_env VALUE', () => {
    const scenario = { id: 'x', title: 'T', project: 'p', persona: 'a persona', invariants: [], knows: [] };
    const steps = [
      { space_session: 'stock/advisor', say: 'q?', expect: [] },
      { call_app_api: { method: 'POST', path: 'costs', body: { a: 1 } }, expect: [] },
      { run_emitter: { scope: 'household', name: 'weekly_plan' }, expect: [] },
      { run_emitter: 'weekly-reconcile', expect: [] },
      {
        inbound: [
          { path: 'demo', body: {} },
          { path: 'demo', body: {}, headers: { 'x-demo-signature': 'bad' } },
        ],
        expect: [],
      },
      { list_integrations: true, expect: [] },
      { set_env: { TAVILY_API_KEY: 'super-secret-value' }, expect: [] },
      { blank_env: ['TAVILY_API_KEY'], expect: [] },
      { restore_env: true, expect: [] },
      { mutate_schema: { table: 'expenses', change: { column: 'total', type: 'string' } }, expect: [] },
      { cancel_ask: true, in_app_chat: 'hi', expect: [] },
    ];
    const text = planLines({ scenario, steps, fixturesDir: '/nonexistent' }).join('\n');

    expect(text).toContain('space_session: stock/advisor');
    expect(text).toContain('call_app_api: POST costs');
    expect(text).toContain('run_emitter: household:weekly_plan');
    expect(text).toContain('run_emitter: weekly-reconcile');
    expect(text).toContain('inbound: 2 deliveries → demo, demo');
    expect(text).toContain('list_integrations: true');
    expect(text).toContain('set_env: TAVILY_API_KEY');
    expect(text).toContain('blank_env: TAVILY_API_KEY');
    expect(text).toContain('restore_env: true');
    expect(text).toContain('mutate_schema: expenses');
    expect(text).toContain('cancel_ask: true');
    expect(text).not.toContain('super-secret-value'); // a value must never reach --plan output either
  });
});
