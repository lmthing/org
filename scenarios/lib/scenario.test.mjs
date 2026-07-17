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
