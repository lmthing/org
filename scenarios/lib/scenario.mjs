/**
 * scenario.mjs — load a declarative `scenario.yaml` and render the `--plan` dry output.
 *
 * Path resolution is deliberately tied to the CALLER's location, not this module's: `loadScenario`
 * takes `here` (the CLI shim passes its own `dirname(fileURLToPath(import.meta.url))`) so a bare
 * scenario id resolves relative to `scenarios/`, keeping "runnable from any cwd" intact. A path
 * ending in `.yaml` is resolved against `process.cwd()` exactly as before.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseYaml } from './yaml.mjs';
import { FatalError } from './errors.mjs';

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Resolve a scenario id (or a path to a `.yaml`) into its parsed spec + on-disk anchors.
 * @param {string} idOrPath  e.g. '06-tanzania' or '/abs/path/scenario.yaml'
 * @param {{ here: string }} opts  `here` = the directory a bare id resolves against (scenarios/)
 * @returns {{ scenario, steps, scenarioDir, yamlPath, fixturesDir }}
 */
export function loadScenario(idOrPath, { here }) {
  const scenarioDir = idOrPath.endsWith('.yaml') ? dirname(resolve(idOrPath)) : resolve(here, idOrPath);
  const yamlPath = idOrPath.endsWith('.yaml') ? resolve(idOrPath) : join(scenarioDir, 'scenario.yaml');
  if (!existsSync(yamlPath)) throw new FatalError(`no scenario.yaml at ${yamlPath}`);
  const fixturesDir = join(scenarioDir, 'fixtures');
  const scenario = parseYaml(readFileSync(yamlPath, 'utf8'));
  const steps = scenario.steps ?? [];
  return { scenario, steps, scenarioDir, yamlPath, fixturesDir };
}

/**
 * The exact lines `--plan` prints, in order: the header, one line per step (verbs + truncated
 * message + attach/expect/if_asked), then the fixture-coverage audit (attached-but-missing,
 * on-disk-but-never-attached, or the ✅). The caller does `planLines(...).forEach(l => console.log(l))`
 * — embedded `\n`s produce the same blank lines the original inline `console.log`s did.
 */
export function planLines({ scenario, steps, fixturesDir }) {
  const out = [];
  out.push(`scenario ${scenario.id} — "${scenario.title}"  (project ${scenario.project})`);
  out.push(`persona: ${String(scenario.persona).slice(0, 90)}…`);
  out.push(`invariants: ${scenario.invariants?.length}  ·  knows: ${scenario.knows?.length}  ·  steps: ${steps.length}\n`);
  const allFixtures = new Set();
  steps.forEach((s, i) => {
    const verbs = Object.keys(s).filter((k) => k !== 'expect');
    (s.attach ?? []).forEach((f) => allFixtures.add(f));
    const msg = (s.say ?? s.then_say ?? s.in_app_chat ?? '').toString().replace(/\n/g, ' ').slice(0, 64);
    out.push(`  ${String(i + 1).padStart(2)}. [${verbs.join(', ')}]  ${msg}${msg.length >= 64 ? '…' : ''}`);
    if (s.attach) out.push(`       attach: ${s.attach.join(', ')}`);
    out.push(`       expect: ${s.expect?.length ?? 0}${s.if_asked ? '  if_asked: ' + Object.keys(s.if_asked).length : ''}`);
  });
  // Fixture coverage: does every file in fixtures/ get used, and does every attach exist?
  const used = [...allFixtures];
  out.push(`\nfixtures attached across the scenario (${used.length}): ${used.join(', ')}`);
  const missing = used.filter((f) => !existsSync(join(fixturesDir, f)));
  if (missing.length) out.push(`⚠️  attached but NOT on disk: ${missing.join(', ')}`);
  const onDisk = readdirSyncSafe(fixturesDir).filter((f) => !/^(links\.md|.*\.txt)$/.test(f));
  const unused = onDisk.filter((f) => !allFixtures.has(f));
  if (unused.length) out.push(`⚠️  on disk but NEVER attached: ${unused.join(', ')}`);
  else out.push(`✅ every uploadable fixture on disk is attached by some step`);
  return out;
}
