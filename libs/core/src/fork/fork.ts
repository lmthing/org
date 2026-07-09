import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { Message } from '../context/history.js';
import type { VM } from '../sandbox/quickjs.js';
import { MessageHistory } from '../context/history.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import { rolePreamble, modelForRole, type RoleModelConfig } from './roles.js';
import { buildOverlay, extractFunctionSignature } from '../typecheck/overlay.js';
import { validateOutput } from '../tasklist/schema.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { Budget, BudgetExceededError, type BudgetLimits } from '../eval/budget.js';
import { forkCapabilities } from '../exec/capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';
import { createChildVM, buildAmbientDts } from '../exec/bootstrap.js';
import type { AppGlobalImpls } from '../exec/app-globals.js';
import type { DocumentResolver } from '../globals/read-document.js';
import { resolveTaskDelegate, evaluateDelegatePolicy, isDelegateAllowed, formatDelegateDenial } from '../exec/target-match.js';
import { STATEMENT_PROTOCOL } from '../exec/preamble.js';
import { salvageData, type DegradeReason } from '../exec/envelope.js';
import { runPrelude } from '../exec/prelude.js';

// Re-exported for compatibility: the allowlist matcher moved to exec/target-match.ts
// (Phase 2 exec unification) but was historically imported from fork.ts.
export { resolveTaskDelegate };

/** Per-fork degradation metadata surfaced by `forkWithMeta` (Phase 3 envelopes). */
export interface ForkResultMeta<T = unknown> {
  value: T;
  /** true when the value was salvaged (the model never produced a schema-valid resolve). */
  degraded: boolean;
  reason?: DegradeReason;
}

export interface ForkTask {
  instruction: string;
  output: Record<string, string>;
  seed?: Record<string, unknown>;
  timeout?: number;
  taskId?: string;
  upstreamOutputs?: Record<string, unknown>;
  /** Subagent role controlling capability profile + system-prompt preamble. */
  role?: 'explore' | 'plan' | 'general';
  /** Allowlist of space-function names to inject + advertise (least privilege). When set,
   *  only these of the engine's agentFunctions are injected and listed; omit for all. */
  functions?: string[];
  /** Overall tasklist goal (tasklists/<name>/index.md body), injected as standing context
   *  so an isolated task knows the pipeline it serves. */
  tasklistDescription?: string;
  /** Per-task delegation policy (unified canDelegateTo semantics — see
   *  exec/target-match.ts `evaluateDelegatePolicy`). Entries `"space/agent"`
   *  (any action) or `"space/agent#action"`; `["*"]` = unrestricted;
   *  `"registered:*"` = any runtime-registered space. When the policy is not
   *  'none' AND the engine has a `delegateRunner`, `delegate()` is injected
   *  into the fork and gated at yield time. Empty/omitted → no delegation
   *  (the task-level default). */
  canDelegateTo?: string[];
  /** Host-executed TS statements (task frontmatter `prelude:`) run in the fork VM BEFORE the
   *  model's first turn, through the same statement pipeline as the turn loop (yields allowed).
   *  Bound values are surfaced as the fork's first VARIABLES block; per-statement failures bind
   *  the names `undefined` and are noted there (they never kill the fork). See exec/prelude.ts. */
  prelude?: string;
  /** Parent execution scope for hierarchical observability. Set by the yield router
   *  before each fork() call so each invocation carries the right parentId. */
  parentScope?: TraceScope;
}

export interface ForkEngineOpts {
  maxConcurrentForks: number;
  parentHistory: Message[];
  parentSpaceDir: string;
  parentAgentSlug: string;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  clock?: Clock;
  tracer?: Tracer;
  /** Agent functions (TS source) available in the parent session — injected into fork VMs */
  agentFunctions?: Record<string, string>;
  /** Bundled JS versions of agent functions (when space has node_modules) */
  agentFunctionsBundled?: Record<string, string>;
  /** Host budget caps applied to each fork's own turn loop (fresh Budget per fork). */
  budgetLimits?: BudgetLimits;
  /** Nesting depth of forks spawned by this engine. A session's top-level forks are depth 1. */
  forkDepth?: number;
  /** Optional per-role model assignment (e.g. explore/plan → cheap model). */
  roleModels?: RoleModelConfig;
  /** Default model alias used for any fork role that has no explicit roleModels entry.
   *  Propagated from the parent session so llm_request events carry a model field. */
  defaultModel?: string;
  /** Body of the parent agent's charter.md — short, fork-safe identity/guardrails injected
   *  into every fork's system prompt. Unlike instruct.md it carries no ask/delegate/UI prose. */
  parentAgentCharter?: string;
  /** Runs a delegate on behalf of a task that declares `canDelegateTo`. Provided by the
   *  Session / delegate runtime (which own the registry + recursion-depth bound). When absent,
   *  a task's delegate() yield fails with a clear "delegation not available" error. */
  delegateRunner?: (
    packageName: string,
    agentName: string,
    action: string | undefined,
    delegateOpts: unknown,
    allowedActions: string[] | undefined,
  ) => Promise<unknown>;
  /** Spaces registered at runtime via registerSpace(). Shared (same Map reference) with
   *  the parent Session so a fork's registerSpace() is visible to later parent delegate()
   *  calls — the documented dynamicSpaces invariant. */
  dynamicSpaces?: Map<string, import('../spaces/load.js').Space>;
  /** Absolute path to the project's spaces/ dir. Propagated into each fork VM as
   *  LMTHING_PROJECT_SPACES_DIR so the architect can target it when scaffolding. */
  projectSpacesDir?: string;
  /** Absolute project root — propagated into each fork VM as LMTHING_PROJECT_DIR and
   *  gating app-global injection (a fork inside a project reads/writes that project's app). */
  projectRoot?: string;
  /** Project id — propagated as LMTHING_PROJECT_ID. */
  projectId?: string;
  /** The parent agent's app-capability grants. A fork task receives the
   *  `allowWrite`-intersected subset (read-only roles keep only db:read/api:call). */
  parentAppCapabilities?: AppCapabilities;
  /** Host-provided app-global engine impls (libs/cli, P2+), passed through to the fork VM. */
  appGlobals?: AppGlobalImpls;
  /** Host resolver for the universal `readDocument` global — threaded from the parent
   *  session/delegate so a fork leaf can read an attached upload's text by id. */
  documentResolver?: DocumentResolver;
}

export class ForkEngine {
  private activeForks = 0;
  private queue: Array<() => void> = [];

  constructor(private opts: ForkEngineOpts) {}

  /** Model-facing shape (the bare `fork()` global): resolves to just the value. */
  async fork<T>(task: ForkTask): Promise<T> {
    return (await this.forkWithMeta<T>(task)).value;
  }

  /**
   * Internal variant that also reports whether the value was SALVAGED (and why),
   * so the tasklist orchestrator can aggregate degradation into a TaskEnvelope
   * instead of the old prose-placeholder signal. Same execution path as fork().
   */
  async forkWithMeta<T>(task: ForkTask): Promise<ForkResultMeta<T>> {
    const tracer = this.opts.tracer ?? NULL_TRACER;
    const label = `fork:${task.taskId ?? task.role ?? 'general'}`;
    // Mint scope as 'queued' before acquiring the slot so wait time is visible
    const forkScope = tracer.child(task.parentScope, 'fork', label, {
      role: task.role,
      taskId: task.taskId,
      instruction: task.instruction.slice(0, 120),
      timeout: task.timeout,
    }, 'queued');

    // Wait for concurrency slot, then activate
    await this.acquireSlot();
    tracer.activate(forkScope);

    try {
      return await this.runFork<T>(task, forkScope);
    } finally {
      this.releaseSlot();
    }
  }



  private acquireSlot(): Promise<void> {
    const tracer = this.opts.tracer ?? NULL_TRACER;
    if (this.activeForks < this.opts.maxConcurrentForks) {
      this.activeForks++;
      tracer.write({ ts: Date.now(), type: 'fork_queue', active: this.activeForks, queued: this.queue.length, max: this.opts.maxConcurrentForks });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeForks++;
        tracer.write({ ts: Date.now(), type: 'fork_queue', active: this.activeForks, queued: this.queue.length, max: this.opts.maxConcurrentForks });
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    const tracer = this.opts.tracer ?? NULL_TRACER;
    this.activeForks--;
    const next = this.queue.shift();
    if (next) next();
    else tracer.write({ ts: Date.now(), type: 'fork_queue', active: this.activeForks, queued: this.queue.length, max: this.opts.maxConcurrentForks });
  }

  private async runFork<T>(task: ForkTask, forkScope: TraceScope): Promise<ForkResultMeta<T>> {
    const tracer = this.opts.tracer ?? NULL_TRACER;

    return new Promise<ForkResultMeta<T>>(async (resolve, reject) => {
      let settled = false;
      let didResolve = false;
      let resolvedValue: unknown;
      let resolvedError: Error | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      // Degradation tracking (Phase 3): set when the value is salvaged rather than
      // genuinely resolved, so forkWithMeta callers can branch on typed metadata.
      let salvaged = false;
      let salvageReason: DegradeReason | undefined;

      const settle = (fn: () => void, endStatus: 'done' | 'error' = 'done', errMsg?: string): void => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        tracer.end(forkScope, endStatus, errMsg ? { error: errMsg } : undefined);
        fn();
      };

      // Set up timeout
      if (task.timeout && task.timeout > 0) {
        const clock = this.opts.clock;
        if (clock) {
          clock.setTimeout(() => {
            const msg = `Fork timed out after ${task.timeout}ms`;
            settle(() => reject(new Error(msg)), 'error', msg);
          }, task.timeout);
        } else {
          timeoutId = setTimeout(() => {
            const msg = `Fork timed out after ${task.timeout}ms`;
            settle(() => reject(new Error(msg)), 'error', msg);
          }, task.timeout);
        }
      }

      // Per-fork budget. Assert nesting depth before spending anything on a VM —
      // a depth-exceeded fork rejects cleanly with BudgetExceededError.
      const budget = new Budget(this.opts.budgetLimits ?? {});
      const depth = this.opts.forkDepth ?? 1;

      let vm: VM | undefined;
      try {
        budget.assertForkDepth(depth);

        // Delegation: a task may delegate ONLY per its `canDelegateTo` policy (unified
        // semantics: omitted/[] = none, ["*"] = unrestricted, list = allowlist with
        // optional "registered:*"), and ONLY when the engine was given a delegateRunner
        // (the Session / delegate runtime owns the registry + recursion bound).
        // Default: no delegate global — keeps forks isolated and headless as before.
        const delegatePolicy = evaluateDelegatePolicy(task.canDelegateTo, 'task');
        const canDelegate = delegatePolicy.mode !== 'none' && typeof this.opts.delegateRunner === 'function';
        const capabilities = forkCapabilities(task.role, canDelegate, this.opts.parentAppCapabilities ?? {});

        // Space functions from the parent agent. When the task declares a `functions`
        // allowlist, scope to exactly those (least privilege — fewer tools to misuse,
        // shorter prompt). An empty array means "no space functions".
        const allFns = this.opts.agentFunctions ?? {};
        const allFnsBundled = this.opts.agentFunctionsBundled ?? {};
        const fnAllow = task.functions;
        const pickAllowed = <T,>(rec: Record<string, T>): Record<string, T> => {
          if (!fnAllow) return rec;
          const out: Record<string, T> = {};
          for (const name of fnAllow) if (name in rec) out[name] = rec[name]!;
          return out;
        };
        const agentFunctions = pickAllowed(allFns);
        const agentFunctionsBundled = pickAllowed(allFnsBundled);

        // currentTask.resolve records the (schema-validated) result.
        // IMPORTANT: do NOT call vm.dispose() from inside this callback. We are
        // executing inside a QuickJS function call frame; disposing the runtime here
        // causes JS_FreeRuntime to abort because live GC handles are still on the
        // stack. Instead we record the result and dispose the VM after runTurnLoop exits.
        const outputSchema = task.output;
        const currentTaskResolve = (value: unknown): void => {
          if (didResolve) return;
          didResolve = true;
          if (!validateOutput(outputSchema, value)) {
            resolvedError = new Error(`Fork output does not match schema ${JSON.stringify(outputSchema)}`);
          } else {
            resolvedValue = value;
          }
        };

        const forkTracer = this.opts.tracer ?? NULL_TRACER;
        // Shared child-VM bootstrap: seed/upstream vars, currentTask, allowlisted
        // functions, host tools (role-gated write), yielding globals per the
        // capability profile (no ask/fork/tasklist; delegate/registerSpace gated),
        // and the JSX runtime (catalog stubs only — forks get no agent components).
        vm = await createChildVM({
          capabilities,
          renderHost: this.opts.renderHost,
          clock: this.opts.clock,
          spaceDir: this.opts.parentSpaceDir,
          projectSpacesDir: this.opts.projectSpacesDir,
          projectRoot: this.opts.projectRoot,
          projectId: this.opts.projectId,
          appGlobals: this.opts.appGlobals,
          progress: () => budget.snapshot(),
          functions: agentFunctions,
          functionsBundled: agentFunctionsBundled,
          componentNames: [],
          onDisplay: (value) => {
            forkTracer.write({ ts: Date.now(), type: 'display', context: forkScope.label, nodeId: forkScope.nodeId, descriptor: value });
          },
          currentTaskResolve,
          // Seed variables, then upstream outputs as named variables matching the task id.
          seedVars: { ...(task.seed ?? {}), ...(task.upstreamOutputs ?? {}) },
          onFunctionError: (name, error) => {
            this.opts.renderHost.log(`[warn] failed to inject function "${name}" into fork: ${error}`);
          },
        });

        // Build user message for the child
        const seedSummary = task.seed && Object.keys(task.seed).length > 0
          ? `\nContext variables (available in scope):\n${Object.entries(task.seed)
              .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
              .join('\n')}`
          : '';
        const inputSummary = task.upstreamOutputs
          ? `\nInputs from upstream tasks (available as variables):\n${Object.entries(task.upstreamOutputs)
              .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
              .join('\n')}`
          : '';

        const outputSchemaStr = JSON.stringify(task.output, null, 2);
        const userMessage = `${task.instruction}${seedSummary}${inputSummary}\n\nOutput schema:\n${outputSchemaStr}\n\nWhen done, call: currentTask.resolve({ ...output })`;

        const history = new MessageHistory();
        history.append({ role: 'user', content: userMessage, blockType: 'normal' });

        // Ambient DTS, assembled additively by the shared builder. Forks have NO
        // tasklist/fork/ask declared, so a stray call fails typecheck (a clean
        // retryable error) instead of passing typecheck then throwing at runtime
        // and salvaging. `delegate` is declared ONLY when the task may delegate.
        const functionsOverlay = Object.keys(agentFunctions).length > 0
          ? buildOverlay(agentFunctions, { view: {}, form: {} })
          : '';
        const upstreamDts = task.upstreamOutputs
          ? Object.keys(task.upstreamOutputs).map((id) => `declare const ${id}: any;`).join('\n')
          : '';
        const seedDts = task.seed
          ? Object.keys(task.seed).map((k) => `declare const ${k}: any;`).join('\n')
          : '';
        const ambientDts = buildAmbientDts({
          capabilities,
          overlay: functionsOverlay,
          currentTask: true,
          extraDecls: [upstreamDts, seedDts].filter(Boolean),
        });

        // Build system prompt: include FULL function signatures incl. return types
        // (AST-based, not a truncating regex) so the subagent destructures results
        // like readFile(...).content / glob(...).paths without a wasted retry.
        const functionList = Object.keys(agentFunctions).length > 0
          ? `\n# Available Space Functions (already in scope — call directly with correct args, do NOT redefine):\n${Object.entries(agentFunctions).map(([name, src]) => {
              const decl = extractFunctionSignature(name, src)
                .replace(/^declare\s+(async\s+)?function\s+/, '')
                .replace(/;$/, '');
              return `- ${decl}`;
            }).filter(Boolean).join('\n')}`
          : '';

        // Standing context: the parent agent's charter (fork-safe identity/guardrails) and the
        // overall tasklist goal, so an isolated task knows who it works for and what pipeline it
        // serves. Kept short and placed before the task instruction. (instruct.md is deliberately
        // NOT injected — it carries ask/delegate/UI prose a fork cannot honor.)
        const charterSection = this.opts.parentAgentCharter?.trim()
          ? `# Agent\n${this.opts.parentAgentCharter.trim()}\n`
          : '';
        const tasklistSection = task.tasklistDescription?.trim()
          ? `# Tasklist (overall goal — your task is one step in it)\n${task.tasklistDescription.trim()}\n`
          : '';

        // The capability profile gates which host primitives actually exist in this VM
        // (read-only roles have write withheld at injection). Advertise ONLY what is available,
        // so a read-only task is never told about writeFileRaw and then errors on it.
        const allowWrite = capabilities.allowWrite;
        const ioLine = allowWrite
          ? '- readFileRaw(path) → { ok, content } / writeFileRaw(path, content) → { ok } — binary-safe file I/O (relative paths resolve against the space dir)'
          : '- readFileRaw(path) → { ok, content } — binary-safe file read (relative paths resolve against the space dir). You are READ-ONLY: writeFileRaw and mutating shell commands are unavailable.';
        const shellLine = allowWrite
          ? '- execShell(cmd: string) → { ok, stdout, stderr } — run a shell command / subprocess. This is the ONLY way to run a program (e.g. tests): `const { ok, stdout } = execShell("npx tsx test.ts");`'
          : '- execShell(cmd: string) → { ok, stdout, stderr } — run a READ-ONLY shell command (ls, cat, grep…); mutating commands (rm/mv/git/npm…) are blocked.';
        const noRuntimeLine = allowWrite
          ? 'There is NO Node/Bun/Deno runtime: `require`, `import("child_process")`, `Bun`, `Deno`, `process.cwd()`, `TextDecoder`, and `Buffer` are NOT available. Use `execShell` to run anything and `fetch`/`readFileRaw`/`writeFileRaw` for I/O.'
          : 'There is NO Node/Bun/Deno runtime: `require`, `import("child_process")`, `Bun`, `Deno`, `process.cwd()`, `TextDecoder`, and `Buffer` are NOT available. Use `execShell` (read-only) / `fetch` / `readFileRaw` for I/O.';

        const systemBlock = [
          // Shared statement-emission rules (single source: exec/preamble.ts).
          STATEMENT_PROTOCOL,
          '',
          ...(charterSection ? [charterSection] : []),
          ...(tasklistSection ? [tasklistSection] : []),
          rolePreamble(task.role),
          '',
          '# Available Built-in Globals (already provided — do NOT redefine any of these):',
          '- sleep(duration: string) — pause for a duration, e.g. `await sleep("2s")`',
          '- display(content: string | JSXDescriptor) — render output',
          '- loadKnowledge(domain: string, field: string, option: string) → Promise<string> — load a knowledge file shipped with this space, e.g. `const k = await loadKnowledge("espresso", "fundamentals", "overview.md");`',
          '- inspect(...values) — inspect variables',
          shellLine,
          '- fetch(url, opts?) → Promise<{ ok, status, text(), json() }> — `await fetch(...)` (real, non-blocking HTTP)',
          ioLine,
          '',
          noRuntimeLine,
          '',
          ...(canDelegate
            ? [
                '',
                '# Delegation (allowed for this task)',
                ...(delegatePolicy.mode === 'unrestricted'
                  ? ['You MAY call `delegate(packageName, agentName, action?, { query, context })` (yields) — any target.']
                  : [
                      'You MAY call `delegate(packageName, agentName, action?, { query, context })` (yields) — but ONLY to:',
                      ...delegatePolicy.entries.map((t) => `  - ${t}`),
                      ...(delegatePolicy.allowRegistered
                        ? ['  - any space registered at runtime via registerSpace()']
                        : []),
                    ]),
                'It returns the delegate\'s result; cast it. Keep the call FLAT at top level (never inside if/try/loop).',
              ]
            : []),
          '',
          'When your task is complete, call `currentTask.resolve(value)` with an object matching the output schema.',
          'The request and every input you need are in the seed variables / Inputs above — work with what you have, assume sensible defaults where details are missing, and resolve. Do not wait for input.',
          functionList,
        ].join('\n');

        // Shared yield routing (eval/yield-router.ts). A fork leaf resolves its own
        // sleep/fetch/loadKnowledge/registerSpace, and gates delegate() on the task's
        // canDelegateTo allowlist + the engine's delegateRunner. fork/tasklist are
        // deliberately unhandled here (no getForkEngine): the globals are not
        // injected, so such a yield cannot occur — and if it somehow did, it binds
        // undefined exactly as before.
        const yieldCtx: YieldRouterContext = {
          clock: this.opts.clock,
          knowledgeSpaceDir: this.opts.parentSpaceDir,
          resolveRegisterSpace: true,
          dynamicSpaces: this.opts.dynamicSpaces,
          apiCallResolver: this.opts.appGlobals?.apiCall,
          connectionResolver: this.opts.appGlobals?.callConnection,
          toolResolver: this.opts.appGlobals?.tool,
          documentResolver: this.opts.documentResolver,
          // delegate: gated by the task's canDelegateTo policy via the unified
          // yield-time gate (exec/target-match.ts isDelegateAllowed — same gate the
          // session and delegate VMs use); routed to the engine's delegateRunner
          // (which owns the registry + recursion bound). A disallowed target throws
          // a clear error naming the allowed targets, surfaced to the model
          // (retryable) rather than silently binding undefined. `registered:*`
          // consults the session-shared dynamicSpaces map at call time.
          runDelegate: (packageName, agentName, action, delegateOpts) => {
            const allow = isDelegateAllowed(delegatePolicy, packageName, agentName, this.opts.dynamicSpaces);
            if (!allow.allowed) {
              throw new Error(formatDelegateDenial(delegatePolicy, packageName, agentName, 'task'));
            }
            if (!this.opts.delegateRunner) throw new Error('delegation is not available in this context');
            return this.opts.delegateRunner(packageName, agentName, action, delegateOpts, allow.allowedActions);
          },
        };

        // Single yield resolver shared by the prelude and the turn loop — the
        // prelude's webSearch/webFetch/fetch/sleep/loadKnowledge yields route
        // exactly like any fork statement's.
        const processYield = async (req: import('../eval/yield.js').YieldRequest): Promise<unknown> => {
          const routed = await routeCommonYield(req, yieldCtx);
          return routed.handled ? routed.value : undefined;
        };

        // Phase 4: host-executed prelude. Runs the task's deterministic setup
        // statements in THIS fork VM before the model's first turn (seed vars —
        // including forEach `item`/`index` — were already injected by
        // createChildVM above, so the prelude can read them). Its accumulated
        // context seeds the turn loop's initialContext so the model's later
        // statements typecheck against the prelude's bound names; failed
        // statements' names become ambient `any` declarations instead.
        let turnLoopAmbient = ambientDts;
        let preludeContext: string | undefined;
        if (task.prelude?.trim()) {
          // The prelude typechecks against an ambient WITHOUT `currentTask`:
          // resolving is the MODEL's job, so a prelude statement that calls
          // currentTask.resolve() fails typecheck — a per-statement prelude
          // error (noted in the VARIABLES block), never a silent pre-resolve.
          const preludeAmbient = buildAmbientDts({
            capabilities,
            overlay: functionsOverlay,
            currentTask: false,
            extraDecls: [upstreamDts, seedDts].filter(Boolean),
          });
          const prelude = await runPrelude({
            vm,
            source: task.prelude,
            ambientDts: preludeAmbient,
            processYield,
            renderHost: this.opts.renderHost,
            budget,
            tracer: forkTracer,
            scope: forkScope,
          });
          preludeContext = prelude.context || undefined;
          if (prelude.failedNames.length > 0) {
            turnLoopAmbient =
              ambientDts + '\n' + prelude.failedNames.map((n) => `declare const ${n}: any;`).join('\n');
          }
          // The model's first user message ends with the prelude's VARIABLES
          // block (same standing mechanism the turn loop uses after yields), so
          // it SEES the bound values — search results, not just names.
          if (prelude.variablesBlock) {
            history.append({ role: 'user', content: prelude.variablesBlock, blockType: 'variables' });
          }
        }

        const forkLoopOpts = {
          vm,
          history,
          systemBlock,
          ambientDts: turnLoopAmbient,
          initialContext: preludeContext,
          renderHost: this.opts.renderHost,
          streamFn: this.opts.streamFn,
          processYield,
          maxRetries: 3,
          tracer: this.opts.tracer ?? NULL_TRACER,
          traceContext: `fork:${task.taskId ?? task.role ?? 'general'}`,
          scope: forkScope,
          budget,
          model: modelForRole(task.role, this.opts.roleModels) ?? this.opts.defaultModel,
        };

        // A BudgetExceededError here propagates to the outer catch and rejects: the
        // budget is a HARD cost ceiling, so we honor it rather than spending more turns.
        await runTurnLoop(forkLoopOpts);

        // GUARANTEE: a fork that returned WITHOUT exceeding budget must still produce a
        // usable result. If the model finished (or exhausted its retries) without calling
        // resolve(), force resolve-only turns with a FRESH small budget (separate from the
        // session cap) and tools forbidden — hammered with an impossible-to-misread
        // single instruction. (Skip entirely once a timeout has already settled the fork.)
        let nudgeBudgetExceeded = false;
        for (let nudge = 0; nudge < 2 && !didResolve && !settled; nudge++) {
          this.opts.renderHost.log(`[fork] no resolve — forcing resolve (attempt ${nudge + 1})`);
          history.append({
            role: 'user',
            content: [
              'STOP. Do NOT search, fetch, read files, run shell, or call ANY tool now.',
              'You must return your result THIS TURN by calling currentTask.resolve().',
              'Emit EXACTLY ONE statement: a single currentTask.resolve({...}) call that',
              'synthesizes everything already gathered above. Do not gather more — use only',
              'what is already in context. Any other code (searches, fetches, prose) is rejected.',
              '',
              `Output schema — fill EVERY field with a real value:\n${outputSchemaStr}`,
              '',
              'If you genuinely found nothing usable, still resolve with your best summary of',
              'what was attempted. Returning a partial result is REQUIRED; returning nothing fails the task.',
            ].join('\n'),
            blockType: 'normal',
          });
          try {
            await runTurnLoop({
              ...forkLoopOpts,
              maxRetries: 3,
              budget: new Budget({ maxEpisodes: 4 }),
              traceContext: `fork:${task.taskId ?? task.role ?? 'general'}:resolve_nudge`,
            });
          } catch (err) {
            if (!(err instanceof BudgetExceededError)) throw err;
            nudgeBudgetExceeded = true;
          }
        }

        // Last resort: the model refused to resolve across every forced turn. Rather
        // than fail the parent (which would abort the whole tasklist/run), salvage a
        // schema-valid NEUTRAL placeholder so orchestration can proceed. Degradation is
        // signalled via forkWithMeta's typed metadata (→ TaskEnvelope), NEVER as prose
        // inside the data plane.
        //
        // EXCEPTION: a fork given an explicit `timeout` opted into a hard time bound —
        // the caller wants failure on non-completion, not a salvaged guess. So we skip
        // salvage there and let the no-resolve rejection (or the timeout) stand. Tasklist
        // tasks, delegates and role forks set no timeout, so they always salvage.
        if (!didResolve && !task.timeout && !settled) {
          this.opts.renderHost.log(`[fork] model never resolved — salvaging a neutral schema-valid placeholder`);
          resolvedValue = salvageData(task.output);
          resolvedError = undefined;
          didResolve = true;
          salvaged = true;
          // 'budget': the forced-resolve nudge turns themselves ran out of their fresh
          // budget. Otherwise the model simply finished without resolving: 'no_resolve'.
          // (A hard cap on the MAIN turn loop still PROPAGATES as BudgetExceededError
          // and an explicit timeout still rejects — neither reaches this salvage path.)
          salvageReason = nudgeBudgetExceeded ? 'budget' : 'no_resolve';
        }

        // All QuickJS call frames have exited — safe to dispose.
        vm.dispose();
        vm = undefined;

        settle(() => {
          if (didResolve && !resolvedError) {
            resolve({ value: resolvedValue as T, degraded: salvaged, ...(salvageReason ? { reason: salvageReason } : {}) });
          } else {
            reject(resolvedError ?? new Error('Fork completed without calling currentTask.resolve()'));
          }
        }, didResolve && !resolvedError ? 'done' : 'error',
          (!didResolve || resolvedError) ? (resolvedError?.message ?? 'no resolve called') : undefined);
      } catch (err) {
        if (vm) {
          try { vm.dispose(); } catch { /* ignore dispose errors in error path */ }
          vm = undefined;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        settle(() => reject(err), 'error', errMsg);
      }
    });
  }
}
