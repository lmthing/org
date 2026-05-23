/**
 * Space-driving session loop — fully data-driven.
 *
 * The space owns the agent (`agents/<slug>/instruct.md`), the procedure
 * (`flows/<slug>/index.md + N.Step.md`), the knowledge tree, the functions
 * (`functions/*.ts` → auto-discovered DTS + host bridge), and the components.
 * The CLI only:
 *
 *   1. Loads the disk space via `loadSpaceFromDisk`.
 *   2. Resolves the agent + flow (defaults from flow frontmatter).
 *   3. For each cycle, calls `buildAgentPrompt({ space, agent, flow, cycle })`
 *      which composes preamble + agent instruct + flow step body + DTS overlay.
 *   4. Streams the LLM, type-checks + transpiles with the disk-supplied
 *      ambient DTS, evals in QuickJS, drains microtasks, awaits resolvePromise.
 *   5. Loops on inspect; terminates on the flow's declared sink.
 *
 * Nothing about any particular domain (research, code-review, …) lives in
 * this file. Function names, sink globals, cycle hints — all read from disk.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { ModelPricing } from "@lmthing/llm-repl/lib/inspect/budget";

import { streamText, type LanguageModel } from "ai";

import {
  createSandboxSession,
  TraceWriter,
  ModuleRegistry,
  injectGlobal,
  marshalToQuickJS,
} from "@lmthing/llm-repl/lib/sandbox/index";
import { SessionAssembly } from "@lmthing/llm-repl/session/assembly";
import { BudgetTracker } from "@lmthing/llm-repl/lib/inspect/budget";
import { CheckpointEngine } from "@lmthing/llm-repl/lib/checkpoint/checkpoint";
import { RenderEngine } from "@lmthing/llm-repl/lib/render/render";
import { MemoryEngine } from "@lmthing/llm-repl/lib/memory/memory";
import { TasklistEngine } from "@lmthing/llm-repl/lib/tasklist/tasklist";
import { IoEngine } from "@lmthing/llm-repl/lib/io/io";
import {
  registerInspectGlobals,
  evalFilter,
  extractInspectArgNames,
  type InspectCall,
} from "@lmthing/llm-repl/lib/inspect/index";
import { buildReconstruction } from "@lmthing/llm-repl/context/reconstruction";
import {
  loadSpaceFromDisk,
  loadAgent,
  loadFlow,
  listAgents,
  listFlows,
  buildAgentPrompt,
  buildUserPrompt,
} from "@lmthing/llm-repl/lib/spaces/index";
import { runTsc, type TscDiagnostic } from "@lmthing/llm-repl/lib/typecheck/index";

import { resolveLLM, type ModelAlias } from "./model.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface RunSpaceSessionOptions {
  spaceDir: string;
  task: string;
  /** Agent slug under `agents/`. Defaults to the flow's `defaultAgent` then the first agent. */
  agent?: string;
  /** Flow slug under `flows/`. Defaults to the first flow. */
  flow?: string;
  modelAlias?: ModelAlias;
  /** Optional override of the flow's default cycle budget (= step count). */
  maxCycles?: number;
  /** Optional knowledge selectors to splice into the system prompt. */
  knowledge?: Array<{ domain: string; field: string; option?: string }>;
  /** Free-form extra context lines (e.g. user-provided constraints). */
  extraContext?: string[];
  baseDir?: string;
  verbose?: boolean;
}

export interface ExecutedStatement {
  ts: string;
  js: string;
  diagnostics: TscDiagnostic[];
  error?: { name: string; message: string };
  promiseError?: { name?: string; message: string };
}

export interface CycleRecord {
  cycle: number;
  stepName: string;
  systemPrompt: string;
  userPrompt: string;
  assistantText: string;
  statements: ExecutedStatement[];
  inspectFired: boolean;
  sinkFired: boolean;
  inspectArgs?: Array<{ name: string; value: unknown }>;
}

export interface SessionManifest {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  options: {
    spaceDir: string;
    task: string;
    agent: string;
    flow: string;
    modelAlias: ModelAlias;
    maxCycles: number;
  };
  modelResolved: string;
  sinkName: string;
  sessionDir: string;
  cycles: CycleRecord[];
  finalOutput: string | null;
  finalStatus: "sink_fired" | "max_cycles_reached" | "empty_response" | "error";
  errorMessage?: string;
}

export interface RunSpaceSessionResult {
  manifest: SessionManifest;
  sessionDir: string;
  output: string | null;
}

interface SpaceModule {
  hostFunctions: Record<string, (...args: unknown[]) => unknown>;
}

async function importSpaceModule(spaceDir: string): Promise<SpaceModule> {
  const indexPath = join(spaceDir, "index.ts");
  const mod = (await import(pathToFileURL(indexPath).href)) as Partial<SpaceModule>;
  if (!mod.hostFunctions) {
    throw new Error(`Space at ${spaceDir} does not export hostFunctions from index.ts`);
  }
  return mod as SpaceModule;
}

// ── Pricing loader ──────────────────────────────────────────────────────────

function loadModelPricing(modelId: string): ModelPricing | null {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "../../prices.json"),
    join(dirname(fileURLToPath(import.meta.url)), "../prices.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, ModelPricing>;
      return raw[modelId] ?? null;
    } catch { /* try next */ }
  }
  return null;
}

const FENCE_RE = /^\s*```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)\n\s*```\s*$/m;
function stripFences(text: string): string {
  const m = FENCE_RE.exec(text);
  if (m) return m[1]!;
  const start = text.indexOf("```");
  if (start >= 0) {
    const after = text.indexOf("\n", start);
    if (after > 0) {
      const end = text.lastIndexOf("```");
      if (end > after) return text.slice(after + 1, end).trim();
    }
  }
  return text;
}

/**
 * QuickJS evaluates the wrapped IIFE as a SCRIPT (not a module), so any
 * module-level `export` statement the LLM emits becomes a SyntaxError that
 * kills the entire cycle silently. Strip them.
 */
function stripModuleArtifacts(text: string): string {
  return text
    // bare `export {};` or `export { x, y };` lines
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    // `export default ...` → just leave the value as a statement
    .replace(/^(\s*)export\s+default\s+/gm, "$1")
    // `export function/const/let/var/class/interface/type/enum X` → drop the `export`
    .replace(/^(\s*)export\s+(function|const|let|var|class|interface|type|enum|async)\b/gm, "$1$2")
    .trim();
}

// ── Main driver ─────────────────────────────────────────────────────────────

export async function runSpaceSession(opts: RunSpaceSessionOptions): Promise<RunSpaceSessionResult> {
  const startedAt = new Date().toISOString();
  const modelAlias: ModelAlias = opts.modelAlias ?? "L";
  const baseDir = opts.baseDir ?? join(tmpdir(), "llm-repl-sessions");

  // ── Resolve flow + agent from disk ────────────────────────────────────────
  const flowSlug =
    opts.flow ?? (await listFlows(opts.spaceDir))[0];
  if (!flowSlug) throw new Error(`Space at ${opts.spaceDir} has no flows/`);
  const flow = await loadFlow(opts.spaceDir, flowSlug);

  const agentSlug =
    opts.agent ?? flow.defaultAgent ?? (await listAgents(opts.spaceDir))[0];
  if (!agentSlug) throw new Error(`Space at ${opts.spaceDir} has no agents/`);
  const agent = await loadAgent(opts.spaceDir, agentSlug);

  const maxCycles = opts.maxCycles ?? flow.defaultMaxCycles;

  // ── Load the host-function bridge ─────────────────────────────────────────
  const spaceModule = await importSpaceModule(opts.spaceDir);
  const { hostFunctions } = spaceModule;

  // ── Session boot ──────────────────────────────────────────────────────────
  const sessionId = randomUUID();
  const sessionDir = join(baseDir, `session-${sessionId}`);
  await mkdir(sessionDir, { recursive: true });

  const trace = new TraceWriter(join(sessionDir, "trace.jsonl"));
  const assembly = new SessionAssembly(baseDir, sessionId);
  await assembly.init();

  const modelId = (process.env[`LM_MODEL_${modelAlias}`] ?? "").replace(/^[^:]+:/, "");
  const pricing = loadModelPricing(modelId);
  const budgetTracker = new BudgetTracker({ contextWindowTokens: 64000, budgetRatio: 0.85, pricing: pricing ?? undefined });
  budgetTracker.setHeap(0, 128);

  const sandbox = await createSandboxSession({
    maxHeapMB: 128,
    maxStackSizeMb: 4,
    maxStatementMs: 120000,
  });
  const { ctx } = sandbox;

  new CheckpointEngine({
    assembly, trace,
    onSettle: async () => ({ pendingCount: 0, elapsedMs: 0, timeouts: [] }),
  }).registerGlobals(ctx);
  new RenderEngine({ trace, config: { maxEntries: 100, maxTokens: 4000 } }).registerGlobals(ctx);
  new MemoryEngine({ trace, budgetTracker }).registerGlobals(ctx);
  const tasklistEngine = new TasklistEngine({
    trace,
    evalFilter: (_filter: string, el: unknown) => evalFilter({ type: "literal", value: true }, el),
  });
  tasklistEngine.registerGlobals(ctx);
  const moduleRegistry = new ModuleRegistry(ctx);
  new IoEngine({
    trace,
    fetch: { allowedDomains: ["*"], maxResponseBytes: 5 * 1024 * 1024, defaultTimeoutMs: 30000 },
    fs: { sandboxRoot: sessionDir, maxFileSizeBytes: 10 * 1024 * 1024 },
    moduleRegistry,
  }).registerGlobals(ctx);

  let inspectCall: InspectCall | null = null;
  registerInspectGlobals(ctx, {
    budget: budgetTracker,
    trace,
    onInspect: (call) => { inspectCall = call; },
  });

  const loadedSpace = await loadSpaceFromDisk({ sourceDir: opts.spaceDir, sessionDir, trace });
  trace.write({
    type: "space_loaded",
    agents: loadedSpace.agents.map((a) => a.slug),
    functions: loadedSpace.functions.map((f) => f.name),
    knowledgeDomains: loadedSpace.knowledge.map((k) => k.domain),
    flow: flow.slug,
    activeAgent: agent.slug,
    sink: flow.sink.name,
  });

  // Inject the space's host functions
  for (const [name, fn] of Object.entries(hostFunctions)) {
    injectGlobal(ctx, name, fn);
  }

  // Register the flow's sink global; calling it terminates the session.
  let finalOutput: string | null = null;
  injectGlobal(ctx, flow.sink.name, (...a: unknown[]) => {
    finalOutput = String(a[0] ?? "");
    trace.write({ type: "sink_fired", sink: flow.sink.name, bytes: finalOutput.length });
    return undefined;
  });

  // ── delegate() — run another agent (same or different space) as a sub-session ──
  injectGlobal(ctx, "delegate", async (...a: unknown[]) => {
    const spec = (a[0] ?? {}) as {
      space?: string;
      agent?: string;
      flow?: string;
      task?: string;
      modelAlias?: ModelAlias;
      maxCycles?: number;
    };
    if (!spec.task || typeof spec.task !== "string") {
      throw new Error("delegate({...}): `task` (string) is required");
    }
    const subSpace = spec.space ?? opts.spaceDir;
    const subSessionId = randomUUID();
    trace.write({
      type: "delegate_start",
      parentSessionId: sessionId, childSessionId: subSessionId,
      space: subSpace,
      ...(spec.agent ? { agent: spec.agent } : {}),
      ...(spec.flow ? { flow: spec.flow } : {}),
    });
    const sub = await runSpaceSession({
      spaceDir: subSpace,
      task: spec.task,
      ...(spec.agent ? { agent: spec.agent } : {}),
      ...(spec.flow ? { flow: spec.flow } : {}),
      modelAlias: spec.modelAlias ?? modelAlias,
      ...(spec.maxCycles !== undefined ? { maxCycles: spec.maxCycles } : {}),
      baseDir,
      verbose: false,
    });
    trace.write({
      type: "delegate_end",
      childSessionId: subSessionId,
      childSessionDir: sub.sessionDir,
      status: sub.manifest.finalStatus,
      outputBytes: sub.output?.length ?? 0,
    });
    return {
      output: sub.output,
      sessionDir: sub.sessionDir,
      status: sub.manifest.finalStatus,
    };
  });

  const modelResolved = process.env[`LM_MODEL_${modelAlias}`] ?? "";
  const model: LanguageModel = await resolveLLM(modelAlias);

  const cycles: CycleRecord[] = [];
  let reconstruction: string | undefined;
  // Values from the previous cycle's inspect() call, injected as QuickJS globals before each cycle.
  let pendingInjectArgs: Array<{ name: string; value: unknown }> = [];
  let finalStatus: SessionManifest["finalStatus"] = "max_cycles_reached";
  let errorMessage: string | undefined;
  const manifestPath = join(sessionDir, "session.json");

  const writeManifest = async (status: SessionManifest["finalStatus"], extra?: string): Promise<void> => {
    const partial: SessionManifest = {
      sessionId, startedAt, endedAt: new Date().toISOString(),
      options: {
        spaceDir: opts.spaceDir, task: opts.task,
        agent: agent.slug, flow: flow.slug,
        modelAlias, maxCycles,
      },
      modelResolved, sinkName: flow.sink.name, sessionDir, cycles, finalOutput,
      finalStatus: status,
      ...(extra ? { errorMessage: extra } : {}),
    };
    await writeFile(manifestPath, JSON.stringify(partial, null, 2), "utf-8");
  };

  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (opts.verbose) console.error(`── cycle ${cycle} ──`);
      inspectCall = null;
      let assistantText = "";

      // Per-step agent override: a flow step may set `agent: <slug>` in
      // its frontmatter to switch the role for that cycle.
      const stepData = flow.steps[Math.min(cycle - 1, flow.steps.length - 1)]?.data;
      const stepAgentSlug = stepData && typeof stepData.agent === "string" ? stepData.agent : undefined;
      const cycleAgent = stepAgentSlug && stepAgentSlug !== agent.slug
        ? await loadAgent(opts.spaceDir, stepAgentSlug)
        : agent;

      const built = await buildAgentPrompt({
        spaceDir: opts.spaceDir,
        agent: cycleAgent,
        flow,
        cycle,
        ...(opts.knowledge ? { knowledge: opts.knowledge } : {}),
        ...(opts.extraContext ? { extraContext: opts.extraContext } : {}),
      });
      const userPrompt = buildUserPrompt({
        cycle,
        task: opts.task,
        ...(reconstruction ? { reconstruction } : {}),
      });

      // Show the system + user prompts for full transparency.
      process.stderr.write(`╭─ system · cycle ${cycle} (${built.activeStepName}) ──\n`);
      process.stderr.write(built.systemPrompt);
      if (!built.systemPrompt.endsWith("\n")) process.stderr.write("\n");
      process.stderr.write(`╰─ ${built.systemPrompt.length} chars ─\n`);

      process.stderr.write(`╭─ user · cycle ${cycle} (${built.activeStepName}) ──\n`);
      process.stderr.write(userPrompt);
      if (!userPrompt.endsWith("\n")) process.stderr.write("\n");
      process.stderr.write(`╰─ ${userPrompt.length} chars ─\n`);

      const stream = streamText({ model, system: built.systemPrompt, prompt: userPrompt });
      // Stream the LLM's output to stderr live so the operator sees every
      // token the model produces. stdout stays reserved for the final sink
      // output so `> brief.md` works.
      process.stderr.write(`╭─ assistant · cycle ${cycle} (${built.activeStepName}) ──\n`);
      for await (const chunk of stream.textStream) {
        assistantText += chunk;
        process.stderr.write(chunk);
      }
      if (!assistantText.endsWith("\n")) process.stderr.write("\n");
      process.stderr.write(`╰─ ${assistantText.length} chars ─\n`);
      const costBefore = budgetTracker.costUsd;
      try {
        const usage = await stream.usage;
        budgetTracker.recordApiUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      } catch { /* usage unavailable for this provider */ }
      const cycleCost = budgetTracker.costUsd - costBefore;
      process.stderr.write(
        `  cost: $${cycleCost.toFixed(6)} cycle · $${budgetTracker.costUsd.toFixed(6)} total\n`,
      );

      const cycleRecord: CycleRecord = {
        cycle, stepName: built.activeStepName,
        systemPrompt: built.systemPrompt, userPrompt, assistantText,
        statements: [], inspectFired: false, sinkFired: false,
      };

      const cleaned = stripModuleArtifacts(stripFences(assistantText.trim()));
      await writeFile(join(sessionDir, `cycle-${cycle}.ts`), cleaned, "utf-8");
      if (cleaned.length === 0) {
        cycles.push(cycleRecord);
        finalStatus = "empty_response";
        break;
      }

      // Inject inspect args from previous cycle as QuickJS globals (__name = value).
      // The reconstruction already shows them to the LLM as `const __name = ...` constants;
      // we also need them live in the sandbox so the LLM's code can reference them directly.
      for (const { name, value } of pendingInjectArgs) {
        try {
          const handle = marshalToQuickJS(ctx, value);
          ctx.setProp(ctx.global, name, handle);
          handle.dispose();
        } catch { /* ignore unmarshalable values */ }
      }
      pendingInjectArgs = [];

      const tsc = runTsc(cleaned, { sessionContext: built.ambientDts });
      const stmt: ExecutedStatement = { ts: cleaned, js: tsc.js, diagnostics: tsc.diagnostics };

      if (opts.verbose && tsc.diagnostics.length > 0) {
        for (const d of tsc.diagnostics.slice(0, 5)) {
          console.error(`  ⚠ TS${d.code} L${d.line}:${d.column} ${d.message.slice(0, 200)}`);
        }
      }

      const wrapped = `(async () => {\n${tsc.js}\n})();`;

      try {
        if (opts.verbose) console.error(`  ↳ eval ${wrapped.length} chars`);
        const result = await ctx.evalCodeAsync(wrapped);
        if (opts.verbose) console.error(`  ↳ eval returned (error=${!!result.error})`);
        ctx.runtime.executePendingJobs();
        if (result.error) {
          const errVal = ctx.dump(result.error) as { name?: string; message?: string };
          result.error.dispose();
          stmt.error = { name: errVal.name ?? "Error", message: errVal.message ?? String(errVal) };
          if (opts.verbose) console.error(`  ✗ ${stmt.error.name}: ${stmt.error.message.slice(0, 240)}`);
        } else {
          const valTypeof = ctx.typeof(result.value);
          if (valTypeof === "object") {
            const thenHandle = ctx.getProp(result.value, "then");
            const thenTypeof = ctx.typeof(thenHandle);
            thenHandle.dispose();
            if (thenTypeof === "function") {
              if (opts.verbose) console.error(`  ↳ resolving IIFE promise`);
              const pump = setInterval(() => ctx.runtime.executePendingJobs(), 100);
              const resolvedPromise = ctx.resolvePromise(result.value);
              const timeoutMs = 120000;
              const winner = await Promise.race([
                resolvedPromise.then((v) => ({ kind: "ok" as const, v })),
                new Promise<{ kind: "timeout" }>((r) => setTimeout(() => r({ kind: "timeout" }), timeoutMs)),
              ]);
              clearInterval(pump);
              if (winner.kind === "timeout") {
                stmt.error = { name: "Timeout", message: `IIFE resolvePromise timed out after ${timeoutMs}ms` };
                if (opts.verbose) console.error(`  ↳ IIFE timed out`);
                break;
              }
              const resolved = winner.v;
              if (opts.verbose) console.error(`  ↳ resolved (error=${!!resolved.error})`);
              if (resolved.error) {
                const errVal = ctx.dump(resolved.error) as { name?: string; message?: string } | string;
                resolved.error.dispose();
                const name = typeof errVal === "object" && errVal && "name" in errVal ? (errVal as { name?: string }).name : undefined;
                const message = typeof errVal === "string" ? errVal : (errVal && (errVal as { message?: string }).message) ?? JSON.stringify(errVal);
                stmt.promiseError = { ...(name ? { name } : {}), message };
                if (opts.verbose && name !== "InspectSignal") console.error(`  ✗ promise rejected: ${name ?? "Error"}: ${message.slice(0, 240)}`);
              } else {
                resolved.value.dispose();
              }
            }
          }
          result.value.dispose();
          ctx.runtime.executePendingJobs();
        }
      } catch (e) {
        stmt.error = { name: "HostError", message: e instanceof Error ? e.message : String(e) };
        if (opts.verbose) console.error(`  ✗ HostError: ${stmt.error.message}`);
      }

      cycleRecord.statements.push(stmt);
      cycleRecord.inspectFired = !!inspectCall;
      cycleRecord.sinkFired = finalOutput !== null;

      // Recover argument names from the source AST (the runtime engine sees only
      // marshaled values; identifiers live in the emitted TS, not in QuickJS).
      let recoveredNames: string[] = [];
      if (cycleRecord.inspectFired) {
        const extracted = extractInspectArgNames(cleaned);
        if (extracted) recoveredNames = extracted.names;
      }
      const nameFor = (idx: number, runtimeName: string): string => {
        if (recoveredNames[idx] && recoveredNames[idx].length > 0) return recoveredNames[idx]!;
        if (runtimeName && runtimeName.length > 0) return runtimeName;
        return `arg${idx}`;
      };

      if (cycleRecord.inspectFired && inspectCall) {
        cycleRecord.inspectArgs = (inspectCall as InspectCall).args.map((a, i) => ({
          name: nameFor(i, a.name),
          value: a.value,
        }));
        // Queue for injection into QuickJS before the next cycle.
        pendingInjectArgs = cycleRecord.inspectArgs.map(({ name, value }) => ({
          name: `__${name}`,
          value,
        }));
      }
      cycles.push(cycleRecord);
      if (opts.verbose) console.error(`  ↳ cycle ${cycle} pushed (inspect=${cycleRecord.inspectFired} sink=${cycleRecord.sinkFired})`);
      await writeManifest("max_cycles_reached");

      if (cycleRecord.sinkFired) { finalStatus = "sink_fired"; break; }

      if (!cycleRecord.inspectFired) {
        // No yield. Build a minimal recovery message describing what went
        // wrong so the next cycle can correct course instead of starting
        // from scratch with no signal.
        const errBits: string[] = [];
        if (stmt.error) errBits.push(`runtime ${stmt.error.name}: ${stmt.error.message}`);
        if (stmt.promiseError && stmt.promiseError.name !== "InspectSignal") {
          errBits.push(`promise rejection ${stmt.promiseError.name ?? "Error"}: ${stmt.promiseError.message}`);
        }
        for (const d of stmt.diagnostics.slice(0, 5)) {
          errBits.push(`TS${d.code} L${d.line}:${d.column} ${d.message}`);
        }
        const errSummary = errBits.length > 0 ? errBits.join("\n  • ") : "(no error captured — your code did not call inspect() nor the sink)";
        reconstruction = `// ═══ cycle ${cycle} did not yield ═══
//
// Your previous emission ran but never called \`await inspect(...)\` or the
// flow's sink. The following diagnostics were captured:
//
//   • ${errSummary}
//
// Re-emit just this cycle's work, ending with the required yield call.`;
        continue;
      }

      const budget = budgetTracker.snapshot();
      const taskNudge = tasklistEngine.getAllNudges() ?? undefined;
      reconstruction = buildReconstruction({
        inspectNumber: cycle,
        sessionTs: opts.task,
        scope: {},
        meta: {
          budgetTokensUsed: budget.tokensUsed,
          budgetTokensRemaining: budget.tokensRemaining,
          inspectCount: cycle,
          annotationGraceUsed: false,
          pins: {}, compactions: {}, errors: [], tasks: [],
        },
        pins: new Set(), compactions: new Map(),
        promiseStates: new Map(), lastAccessedCycle: new Map(),
        errors: collectErrorsForRecon([stmt], cycle),
        expandedArgs: (inspectCall as unknown as InspectCall).args.map((a, i) => ({
          name: nameFor(i, a.name),
          value: a.value,
          ...(a.query ? { query: a.query } : {}),
        })),
        git: { head: "HEAD", checkpoints: [], branch: "main" },
        tasklistNudge: taskNudge,
        budgetTokensRemaining: budget.tokensRemaining,
        budgetTokensUsed: budget.tokensUsed,
        budgetInputTokensUsed: budget.inputTokensUsed,
        budgetOutputTokensUsed: budget.outputTokensUsed,
        budgetCostUsd: budget.costUsd,
        budgetContext: budget.context,
        budgetExecution: budget.execution,
        forksActive: budget.forksActive,
        forksCompleted: budget.forksCompleted,
        nearingLimit: budget.nearingLimit,
        tokenBudget: 64000,
        routerFlags: {},
      });
    }
  } catch (e) {
    finalStatus = "error";
    errorMessage = e instanceof Error ? e.message : String(e);
  } finally {
    sandbox.dispose();
    trace.write({ type: "session_end", sessionId, finalStatus });
  }

  await writeManifest(finalStatus, errorMessage);
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as SessionManifest;

  process.stderr.write(
    `── session complete · ${cycles.length} cycles · $${budgetTracker.costUsd.toFixed(6)} total cost ──\n`,
  );

  return { manifest, sessionDir, output: finalOutput };
}

function collectErrorsForRecon(
  statements: ExecutedStatement[],
  cycle: number,
): Array<{ kind: "runtime"; message: string; statement?: string; cycle: number }> {
  const out: Array<{ kind: "runtime"; message: string; statement?: string; cycle: number }> = [];
  for (const s of statements) {
    if (s.error) {
      out.push({ kind: "runtime", message: `${s.error.name}: ${s.error.message}`, statement: s.ts.slice(0, 200), cycle });
    }
    if (s.promiseError && s.promiseError.name !== "InspectSignal") {
      out.push({ kind: "runtime", message: `Promise rejection: ${s.promiseError.name ?? ""}${s.promiseError.message}`, statement: s.ts.slice(0, 200), cycle });
    }
  }
  return out.slice(-5);
}
