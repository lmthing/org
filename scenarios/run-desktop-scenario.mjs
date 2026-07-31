#!/usr/bin/env node
/**
 * run-desktop-scenario.mjs — a scenario with a DESKTOP attached to the pod.
 *
 * The generic runner drives a pod exactly as the `/chat` SPA would. This one adds the beat that
 * makes the desktop's browser reachable at all: it attaches a desktop to `/api/host/ws` with a real
 * Chromium behind it, then talks to THING and records both sides — what the model said, and what
 * the browser was actually asked to do.
 *
 * Both halves are REAL. The pod is a provisioned production pod (`harness/provision.mjs`), the model
 * calls are real, and the desktop side is the app's own shipped code
 * (`apps/desktop/src/{cdp,browser-tools}.ts`) rather than a reimplementation — see
 * `harness/lib/desktop-bridge.mjs` for why that distinction is the whole point.
 *
 *   pnpm exec tsx scenarios/run-desktop-scenario.mjs 23-hackernews
 *   pnpm exec tsx scenarios/run-desktop-scenario.mjs 23-hackernews --verbose --through 1
 *
 * Run under `tsx`, not bare node: it imports the desktop's TypeScript directly, which is what keeps
 * the harness and the product from drifting apart.
 *
 * It writes evidence and does NOT judge. `assert.mjs`-style checks live in the scenario's `expect`
 * lines, for a judge to score; what this runner asserts itself is only the mechanical part a judge
 * cannot see — that the bridge carried the operations, and what the browser actually held when the
 * turn ended.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const id = argv.find((a) => !a.startsWith('--')) ?? '23-hackernews';
const verbose = argv.includes('--verbose');
const plan = argv.includes('--plan');
const through = Number(flag('--through', '0')) || 0;
const label = flag('--user', 'desktop-scn');

const { loadScenario, planLines } = await import('./lib/scenario.mjs');
const { scenario, steps, scenarioDir } = loadScenario(id, { here: HERE });

if (plan) {
  planLines({ scenario, steps, fixturesDir: join(scenarioDir, 'fixtures') }).forEach((l) => console.log(l));
  process.exit(0);
}

const { getUser } = await import('./harness/provision.mjs');
const { Pod } = await import('./harness/lib/pod.mjs');
const { ThingSession, lastTextOf } = await import('./harness/lib/thing.mjs');
const { attachDesktop } = await import('./harness/lib/desktop-bridge.mjs');

const runDir = join(scenarioDir, 'runs', String(Date.now()));
mkdirSync(runDir, { recursive: true });
const say = (...a) => console.log(...a);

say(`\n▶ ${scenario.id} — ${scenario.title}`);
say(`  evidence → ${runDir}\n`);

// ── a real pod ───────────────────────────────────────────────────────────────
say('· provisioning a production pod…');
const user = await getUser(label);
const pod = new Pod({ base: user.pod, token: user.token });
say(`  pod ${user.pod}  user ${user.userId}`);

// ── a real desktop, with a real browser ──────────────────────────────────────
say('· attaching a desktop (real Chromium behind the shipped bridge code)…');
const desktop = await attachDesktop({ base: user.pod, token: user.token, verbose });
say(`  attached — pod says protocol ${desktop.hello?.protocolVersion ?? '?'}\n`);

const results = [];
let failed = 0;

try {
  const session = new ThingSession(pod, {
    projectId: scenario.project ?? 'user',
    verbose,
    // A scenario must not sit forever on a consent card. The only consent-marked thing reachable
    // here is raw CDP, which THING should not be reaching for at all — so approving it keeps the
    // run moving while the evidence still records that it happened.
    onAsk: () => true,
  });
  await session.start();

  const conversational = steps.filter((s) => s.say || s.then_say);
  const limit = through > 0 ? Math.min(through, conversational.length) : conversational.length;

  for (let i = 0; i < limit; i++) {
    const step = conversational[i];
    const message = String(step.say ?? step.then_say).trim();
    say(`── step ${i + 1}: "${message.slice(0, 78)}${message.length > 78 ? '…' : ''}"`);

    const before = desktop.ops.length;
    const at = Date.now();
    await session.send(message);
    const reply = lastTextOf(session.events) ?? '';
    const ops = desktop.ops.slice(before);
    // Read the browser DIRECTLY rather than believing the reply. This is the only check that can
    // tell "the agent loaded the page and read it" apart from "the agent wrote a plausible
    // paragraph about a site it knows", and the two are indistinguishable from the transcript.
    const page = await desktop.currentPage().catch(() => ({}));

    const record = {
      step: i + 1,
      message,
      ms: Date.now() - at,
      reply,
      browserOps: ops.map((o) => ({ op: o.op, ok: o.ok, ms: o.ms, ...(o.error ? { error: o.error } : {}) })),
      browser: { url: page.url ?? null, title: page.title ?? null },
      stats: session.stats(),
    };
    results.push(record);
    writeFileSync(join(runDir, `step-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify(record, null, 2));
    writeFileSync(
      join(runDir, `step-${String(i + 1).padStart(2, '0')}.page.txt`),
      `${page.url ?? ''}\n${page.title ?? ''}\n\n${page.text ?? ''}`,
    );

    say(`   browser: ${ops.length} op(s) — ${ops.map((o) => o.op).join(', ') || 'NONE'}`);
    say(`   page:    ${page.url ?? '(none)'}`);
    say(`   reply:   ${reply.slice(0, 200).replace(/\n/g, ' ')}${reply.length > 200 ? '…' : ''}`);

    // The mechanical checks. Anything about the QUALITY of the answer is the judge's, and is left
    // in the scenario's `expect` lines.
    const problems = [];
    if (ops.length === 0 && i === 0) problems.push('no browser operation crossed the bridge');
    if (ops.some((o) => !o.ok)) problems.push(`browser op failed: ${ops.find((o) => !o.ok)?.error}`);
    if (problems.length) {
      failed++;
      record.problems = problems;
      say(`   ⚠️  ${problems.join(' · ')}`);
    }
    say('');
  }

  writeFileSync(
    join(runDir, 'summary.json'),
    JSON.stringify(
      { scenario: scenario.id, pod: user.pod, userId: user.userId, hello: desktop.hello, steps: results },
      null,
      2,
    ),
  );
} finally {
  await desktop.close();
}

say(failed ? `✗ ${failed} step(s) with problems — evidence in ${runDir}` : `✓ ran clean — evidence in ${runDir}`);
say('  The `expect` lines are for a judge to score; this runner only checks the mechanics.\n');
process.exit(failed ? 1 : 0);
