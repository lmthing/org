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
 * message + attach/expect/if_asked, plus a one-line detail for every direct-pod-probe verb), then
 * the fixture-coverage audit (attached-but-missing, on-disk-but-never-attached, or the ✅). The
 * caller does `planLines(...).forEach(l => console.log(l))` — embedded `\n`s produce the same blank
 * lines the original inline `console.log`s did.
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
    if (s.space_session) out.push(`       space_session: ${s.space_session}`);
    if (s.call_app_api) out.push(`       call_app_api: ${s.call_app_api.method ?? 'POST'} ${s.call_app_api.path}`);
    if (s.run_emitter) out.push(`       run_emitter: ${runEmitterLabel(s.run_emitter)}`);
    if (s.inbound) {
      const list = Array.isArray(s.inbound) ? s.inbound : [s.inbound];
      out.push(`       inbound: ${list.length} deliverie${list.length === 1 ? '' : 's'} → ${list.map((d) => d.path).join(', ')}`);
    }
    if (s.list_integrations) out.push('       list_integrations: true');
    // Never a value, even in --plan: only the touched KEY NAMES are shown (see env.mjs#applyEnv).
    if (s.set_env) out.push(`       set_env: ${Object.keys(s.set_env).join(', ')}`);
    if (s.blank_env) out.push(`       blank_env: ${s.blank_env.join(', ')}`);
    if (s.restore_env) out.push('       restore_env: true');
    if (s.mutate_schema) out.push(`       mutate_schema: ${s.mutate_schema.table} → ${JSON.stringify(s.mutate_schema.change)}`);
    if (s.cancel_ask) out.push('       cancel_ask: true');
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

/** `run_emitter`'s plan-line label: a bare string / `{slug}` is a plain hook slug; `{scope,name}` is
 *  the `@emitter:scope:name` cron-emitter-def pseudo-slug (see `runner.mjs#runStep`). */
function runEmitterLabel(spec) {
  if (typeof spec === 'string') return spec;
  if (spec.slug) return spec.slug;
  return `${spec.scope}:${spec.name}`;
}
