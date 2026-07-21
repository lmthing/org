import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { transpileStatement } from '../typecheck/transpile.js';

/**
 * The architect's CREATE path (`synthesize_and_run`) derives every new space's slug
 * purely from the topic, and the runtime keys a registration on its directory path —
 * so two differently-worded requests for the SAME entity mint TWO spaces (the run-26
 * duplicate defect: metlife-silver-advisor + pension-advisor-metlife; car-insurance +
 * vehicle-insurance). `matchExistingSpace` is the deterministic choke point that
 * `01-design.md` calls to REUSE an existing space instead of building a duplicate.
 *
 * This drives that helper directly (the full pipeline needs a model): the same topic
 * twice yields ONE space (the second call returns reused:true), while genuinely
 * distinct topics still each get their own space.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FN = join(
  __dirname,
  '..',
  '..',
  'system-spaces',
  'system-architect',
  'functions',
  'matchExistingSpace.ts',
);

function evalDump(vm: VM, code: string): any {
  const res = vm.ctx.evalCode(code);
  if (res.error) {
    const e = vm.ctx.dump(res.error);
    res.error.dispose();
    throw new Error(JSON.stringify(e));
  }
  const v = vm.ctx.dump(res.value);
  res.value.dispose();
  return v;
}

/** No scenario literals — synthetic providers/entities that mirror the real shapes. */
type Space = { name: string; dir: string };
const sp = (name: string): Space => ({ name, dir: `/spaces/${name}` });

describe('matchExistingSpace — deterministic dedup at the CREATE choke point', () => {
  let vm: VM;

  beforeEach(async () => {
    vm = await createVM();
    // Reading the function file (never TS-importing it) keeps this test RED when the
    // production file is stashed away — proving the guard is load-bearing.
    const src = readFileSync(FN, 'utf8');
    const js = transpileStatement(src).replace(/^export\s+/gm, '');
    const r = vm.evalScript(`${js}\nglobalThis['matchExistingSpace'] = matchExistingSpace;`);
    if (!r.ok) throw new Error(`inject failed: ${r.error}`);
  });
  afterEach(() => vm.dispose());

  const match = (topic: string, spaces: Space[]) =>
    evalDump(vm, `matchExistingSpace(${JSON.stringify(topic)}, ${JSON.stringify(spaces)})`);

  it('reuses an existing space when the SAME topic is requested again (idempotent)', () => {
    // Round 1: nothing scaffolded yet → no match, the pipeline would BUILD it.
    const first = match('Meridian Platinum pension', []);
    expect(first.reused).toBe(false);

    // The pipeline created "meridian-platinum-advisor"; a later, differently-worded
    // request for the same entity must REUSE it, not mint a second space.
    const built = [sp('meridian-platinum-advisor')];
    const second = match('Meridian Platinum pension', built);
    expect(second.reused).toBe(true);
    expect(second.slug).toBe('meridian-platinum-advisor');
    expect(second.dir).toBe('/spaces/meridian-platinum-advisor');

    // Reordered / re-punctuated phrasing still resolves to the one space.
    const reworded = match('Pension — Meridian Platinum plan', built);
    expect(reworded.reused).toBe(true);
    expect(reworded.slug).toBe('meridian-platinum-advisor');
  });

  it('merges everyday synonyms (car/vehicle) for the same domain', () => {
    const built = [sp('car-insurance-advisor')];
    const m = match('vehicle insurance', built);
    expect(m.reused).toBe(true);
    expect(m.slug).toBe('car-insurance-advisor');
  });

  it('does NOT over-merge distinct providers that share a domain word', () => {
    const built = [sp('aegis-car-insurance')];
    const m = match('Borealis car insurance', built);
    expect(m.reused).toBe(false);
  });

  it('does NOT over-merge a pension vs a health policy from the same provider', () => {
    const built = [sp('meridian-pension-advisor')];
    const m = match('Meridian health insurance', built);
    expect(m.reused).toBe(false);
  });

  it('never lets a generic single-token space absorb an unrelated topic', () => {
    const built = [sp('insurance-advisor')]; // one significant token after stopwords
    const m = match('Meridian Platinum pension', built);
    expect(m.reused).toBe(false);
  });

  it('two genuinely different topics each get their own space', () => {
    // Build the first, then request an unrelated second — it must NOT reuse.
    const built = [sp('meridian-platinum-advisor')];
    const other = match('Aegis home broadband contract', built);
    expect(other.reused).toBe(false);
  });
});
