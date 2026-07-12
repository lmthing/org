#!/usr/bin/env node
/**
 * Harness smoke test — proves the whole chain works before any scenario burns an hour on it:
 * register → pod → env → THING session → a real LLM turn → trace assertions.
 *
 *   node smoke.mjs [label]
 *
 * If this fails, no scenario can pass; fix the harness first.
 */
import { Pod } from './lib/pod.mjs';
import { ThingSession, approveAllConsent } from './lib/thing.mjs';
import { Report } from './lib/report.mjs';
import { getUser } from './provision.mjs';
import { budget } from './lib/gateway.mjs';

const label = process.argv[2] ?? 'smoke';
const r = new Report('smoke', 'Harness smoke test');

r.step('provision', 'a fresh prod user with a ready pod and Azure keys loaded');
const user = await getUser(label);
r.check('user registered', !!user.userId, user.userId);
r.check('pod reachable', !!user.pod, user.pod);

const pod = new Pod({ base: user.pod, token: user.token });

r.step('pod API', 'projects + store catalog answer over the Envoy-routed origin');
const projects = await pod.listProjects();
r.check('GET /api/projects', Array.isArray(projects.projects ?? projects), JSON.stringify(projects).slice(0, 200));
const store = await pod.storeSpaces();
const spaces = store.spaces ?? [];
r.check('store catalog non-empty', spaces.length > 0, `${spaces.length} spaces`);
r.note(`catalog: ${spaces.map((s) => s.id).join(', ')}`);

r.step('THING turn', 'a real LLM turn completes and the trace shows llm calls + a display');
const thing = new ThingSession(pod, { verbose: true, onAsk: approveAllConsent });
await thing.start();
const turn = await thing.send('In one sentence: what can you help me build?', { timeoutMs: 240_000 });
r.check('turn completed', true, `${(turn.durationMs / 1000).toFixed(1)}s`);
r.check('LLM was called', turn.llmCalls > 0, `${turn.llmCalls} calls`);
r.check('THING replied', turn.text.length > 0, turn.text.slice(0, 200));
r.check('no eval errors', turn.errors.length === 0, JSON.stringify(turn.errors).slice(0, 300));
r.metric('first turn', (turn.durationMs / 1000).toFixed(1), 's');
r.metric('tokens', `${turn.tokens.in} in / ${turn.tokens.out} out`);

const b = await budget(user.token).catch((e) => ({ error: String(e) }));
r.note(`budget: ${JSON.stringify(b)}`);

r.save(`${new URL('.', import.meta.url).pathname}.state/smoke-report.md`);
process.exit(r.passed ? 0 : 1);
