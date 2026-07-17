/**
 * @lmthing/scenario-harness — the public surface for driving lmthing scenarios programmatically.
 *
 * The harness drives a pod's HTTP/WS API directly (no browser), exactly as the /chat SPA does, and
 * the runner plays a declarative `scenario.yaml` and writes judge-sized evidence. This barrel is the
 * one import point:
 *
 *   import { runScenario, loadScenario, Pod, ThingSession } from '@lmthing/scenario-harness';
 *
 * The CLI (`run-scenario.mjs`) does NOT import this barrel — it imports `./lib/*` directly, to keep the
 * `SCENARIO_TARGET` import-timing and native MODULE_NOT_FOUND behaviour identical to the old script.
 */

// ── the pod HTTP surface ────────────────────────────────────────────────────────────────────────
export { Pod, fetchResilient } from './harness/lib/pod.mjs';

// ── an interactive THING chat session over WS + HTTP ────────────────────────────────────────────
export { ThingSession, approveAllConsent, denyAllConsent, textOf, lastTextOf, CANCEL_ASK } from './harness/lib/thing.mjs';

// ── inbound-webhook signing + pod-env merge (the `inbound`/`set_env`/`blank_env` step verbs) ────
export { signHmac } from './harness/lib/webhook-sign.mjs';
export { parseEnvContent, mergeEnvContent, applyEnv, readEnvVar } from './harness/lib/env.mjs';

// ── the PER-RUN local `lmthing serve` lifecycle (the default, local-only target) ────────────────
export {
  LOCAL,
  serverUp,
  allocatePort,
  runsDir,
  runDir,
  nextRunId,
  snapshotDir,
  readRunJson,
  bumpCompletedSteps,
  listRuns,
  snapshotProject,
  seedRun,
  latestSessionId,
  startRun,
  stopRun,
  restartRun,
  reapOrphanRuns,
  ensureAdhocServer,
  restartAdhocServer,
  mutateTableSchema,
} from './harness/lib/local.mjs';

// ── prod-cluster provisioning (register → pod → env → ready) ────────────────────────────────────
export {
  GATEWAY,
  readSdkEnv,
  agentEnvFromSdk,
  register,
  ensurePod,
  podStatus,
  wakePod,
  budget,
  mergePodEnv,
  waitPodSettled,
  waitPodReady,
  provisionUser,
  podBase,
} from './harness/lib/gateway.mjs';

export { mintSession } from './harness/lib/jwt.mjs';
export { Report } from './harness/lib/report.mjs';
export { getUser, loadUser } from './harness/provision.mjs';
export { HARNESS_DIR, SCENARIOS_DIR, SDK_ORG, REPO_ROOT, STATE_DIR } from './harness/lib/paths.mjs';

// ── the scenario library (load · plan · asks · evidence · engine) ───────────────────────────────
export { parseYaml } from './lib/yaml.mjs';
export { loadScenario, planLines } from './lib/scenario.mjs';
export { StepAsks } from './lib/asks.mjs';
export { compact, summarizeTurn, compactStep, traceLines, snapshot } from './lib/evidence.mjs';
export { ScenarioRunner, runScenario, runStep, FatalError } from './lib/runner.mjs';
