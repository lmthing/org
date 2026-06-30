import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { Message } from '../context/history.js';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { injectHostTools } from '../globals/host-tools.js';
import { rolePreamble, roleProfile, modelForRole, type RoleModelConfig } from './roles.js';
import { LIBRARY_DTS_NO_ASK } from '../typecheck/library-dts.js';
import { buildOverlay, extractFunctionSignature } from '../typecheck/overlay.js';
import { injectSpaceFunctions } from '../sandbox/inject-functions.js';
import { validateOutput } from '../tasklist/schema.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { Budget, BudgetExceededError, type BudgetLimits } from '../eval/budget.js';
import { CATALOG_NAMES } from '../ui/catalog.js';

/**
 * Build a schema-valid placeholder object for a fork that never resolved. Each field
 * is filled with a type-appropriate empty/marker value so downstream consumers and the
 * orchestrator can proceed instead of hard-failing. Strings carry an honest note.
 */
export function salvageOutput(schema: Record<string, string>): Record<string, unknown> {
  const note = '(unavailable — the subagent could not produce a synthesis before exhausting its budget)';
  const out: Record<string, unknown> = {};
  for (const [key, rawType] of Object.entries(schema ?? {})) {
    const t = String(rawType).toLowerCase();
    if (t.includes('[]') || t.includes('array')) out[key] = [];
    else if (t.includes('number') || t.includes('int') || t.includes('float')) out[key] = 0;
    else if (t.includes('bool')) out[key] = false;
    else if (t.includes('object') || t.includes('record') || t.startsWith('{')) out[key] = {};
    else out[key] = note;
  }
  return out;
}

/**
 * Decide whether a `delegate(packageName, agentName, action)` call is permitted by a task's
 * `canDelegateTo` allowlist. Entries are `"space/agent"` (any action) or `"space/agent#action"`.
 * Returns the allowed actions for the matched target (`undefined` = any action), or `null` when the
 * target is not in the allowlist at all.
 */
export function resolveTaskDelegate(
  canDelegateTo: string[],
  packageName: string,
  agentName: string,
): { allowedActions: string[] | undefined } | null {
  const matches = canDelegateTo
    .map((e) => {
      const [target, action] = e.split('#');
      const slash = (target ?? '').lastIndexOf('/');
      const pkg = slash >= 0 ? target!.slice(0, slash) : (target ?? '');
      const agent = slash >= 0 ? target!.slice(slash + 1) : (target ?? '');
      return { pkg, agent, action: action || undefined };
    })
    .filter((m) => m.agent === agentName && (m.pkg === packageName || packageName.endsWith('/' + m.pkg) || m.pkg.endsWith('/' + packageName)));
  if (matches.length === 0) return null;
  // A match with no `#action` allows every action; otherwise only the listed actions.
  if (matches.some((m) => !m.action)) return { allowedActions: undefined };
  return { allowedActions: matches.map((m) => m.action!).filter(Boolean) };
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
  /** Per-task delegation allowlist: entries `"space/agent"` (any action) or `"space/agent#action"`.
   *  When non-empty AND the engine has a `delegateRunner`, `delegate()` is injected into the fork
   *  and restricted to these targets. Empty/omitted → no delegation (the default). */
  canDelegateTo?: string[];
  /** Parent execution scope for hierarchical observability. Set by the yield router
   *  before each fork() call so each invocation carries the right parentId. */
  parentScope?: TraceScope;
}

interface ForkEngineOpts {
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
}

export class ForkEngine {
  private activeForks = 0;
  private queue: Array<() => void> = [];

  constructor(private opts: ForkEngineOpts) {}

  async fork<T>(task: ForkTask): Promise<T> {
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

  private async runFork<T>(task: ForkTask, forkScope: TraceScope): Promise<T> {
    const tracer = this.opts.tracer ?? NULL_TRACER;

    return new Promise<T>(async (resolve, reject) => {
      let settled = false;
      let didResolve = false;
      let resolvedValue: unknown;
      let resolvedError: Error | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

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
        vm = await createVM();

        // Inject seed variables
        if (task.seed) {
          for (const [name, value] of Object.entries(task.seed)) {
            vm.setVar(name, value);
          }
        }

        // Inject upstream outputs as named variables matching the task id
        if (task.upstreamOutputs) {
          for (const [id, output] of Object.entries(task.upstreamOutputs)) {
            vm.setVar(id, output);
          }
        }

        // Inject currentTask.resolve global.
        // IMPORTANT: do NOT call vm.dispose() from inside this callback. We are
        // executing inside a QuickJS function call frame; disposing the runtime here
        // causes JS_FreeRuntime to abort because live GC handles are still on the
        // stack. Instead we record the result and dispose the VM after runTurnLoop exits.
        const outputSchema = task.output;
        const resolveGlobal = {
          resolve: (value: unknown) => {
            if (didResolve) return;
            didResolve = true;
            if (!validateOutput(outputSchema, value)) {
              resolvedError = new Error(`Fork output does not match schema ${JSON.stringify(outputSchema)}`);
            } else {
              resolvedValue = value;
            }
          },
        };

        const currentTaskHandle = marshalToQuickJS(vm.ctx, resolveGlobal);
        vm.ctx.setProp(vm.ctx.global, 'currentTask', currentTaskHandle);
        currentTaskHandle.dispose();

        // Inject space functions from parent agent into the child VM. When the task declares
        // a `functions` allowlist, scope to exactly those (least privilege — fewer tools to
        // misuse, shorter prompt). An empty array means "no space functions".
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
        injectSpaceFunctions(vm, agentFunctions, agentFunctionsBundled, (name, error) => {
          this.opts.renderHost.log(`[warn] failed to inject function "${name}" into fork: ${error}`);
        });

        // Shared synchronous host substrate: console, execShell, process.env,
        // readFileRaw, writeFileRaw. The role's capability profile gates write access
        // (explore/plan are read-only — write is withheld here, not just discouraged).
        injectHostTools(vm, {
          renderHost: this.opts.renderHost,
          spaceDir: this.opts.parentSpaceDir,
          profile: roleProfile(task.role),
          progress: () => budget.snapshot(),
          projectSpacesDir: this.opts.projectSpacesDir,
        });

        // Inject standard globals (no fork/delegate/tasklist in child to avoid recursion issues).
        // NOTE: `ask` is deliberately NOT injected — a fork runs headless/autonomous with no
        // interactive user, so prompting is impossible (it would bind undefined or block on stdin).
        const { createDisplayGlobal } = await import('../globals/display.js');
        const { createInspectGlobal } = await import('../globals/inspect.js');
        const { createSleepGlobal } = await import('../globals/sleep.js');
        const { createLoadKnowledgeGlobal } = await import('../globals/load-knowledge.js');
        const { createFetchGlobal } = await import('../globals/fetch.js');

        const capturedVm = vm;
        const pushYield = (req: import('../eval/yield.js').YieldRequest) => {
          capturedVm.pendingYields.push(req);
        };

        type AnyFn = (...args: unknown[]) => unknown;
        const forkTracer = this.opts.tracer ?? NULL_TRACER;
        injectGlobal(vm.ctx, 'display', createDisplayGlobal(this.opts.renderHost, (value) => {
          forkTracer.write({ ts: Date.now(), type: 'display', context: forkScope.label, nodeId: forkScope.nodeId, descriptor: value });
        }) as AnyFn);
        injectGlobal(vm.ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
        injectGlobal(vm.ctx, 'sleep', createSleepGlobal(pushYield, this.opts.clock) as AnyFn);
        injectGlobal(vm.ctx, 'fetch', createFetchGlobal(pushYield) as AnyFn);
        injectGlobal(
          vm.ctx,
          'loadKnowledge',
          createLoadKnowledgeGlobal(pushYield, this.opts.parentSpaceDir + '/knowledge') as AnyFn,
        );
        // registerSpace mutates the parent's shared dynamicSpaces map, so it's a
        // session-state mutation — withhold it from read-only roles (explore/plan),
        // matching how writeFileRaw/execShell are gated. A registered space becomes
        // visible to subsequent parent delegate() calls.
        if (task.role !== 'explore' && task.role !== 'plan') {
          const { createRegisterSpaceGlobal } = await import('../globals/register-space.js');
          injectGlobal(vm.ctx, 'registerSpace', createRegisterSpaceGlobal(pushYield) as AnyFn);
        }

        // Delegation: a task may delegate ONLY to the targets it declares in `canDelegateTo`,
        // and ONLY when the engine was given a delegateRunner (the Session / delegate runtime
        // owns the registry + recursion bound). Default: no delegate global — keeps forks
        // isolated and headless as before.
        const canDelegate = (task.canDelegateTo?.length ?? 0) > 0 && typeof this.opts.delegateRunner === 'function';
        if (canDelegate) {
          const { createDelegateGlobal } = await import('../globals/delegate.js');
          injectGlobal(vm.ctx, 'delegate', createDelegateGlobal(pushYield) as AnyFn);
        }

        // Inject the JSX runtime (React shim + design-system catalog stubs) so a fork
        // task can `display(<Stack>…</Stack>)` exactly like the session — transpileStatement
        // turns JSX into React.createElement, which would otherwise throw "React is not
        // defined" inside the fork VM (the bug that made research forks fail ×3).
        const reactShim = {
          createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
            const typeName = typeof type === 'string'
              ? type
              : (type && typeof type === 'object' && 'displayName' in type)
                ? (type as { displayName: string }).displayName
                : String(type);
            return { type: typeName, props: (props as Record<string, unknown>) ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined) };
          },
          Fragment: 'fragment',
        };
        const reactHandle = marshalToQuickJS(vm.ctx, reactShim);
        vm.ctx.setProp(vm.ctx.global, 'React', reactHandle);
        reactHandle.dispose();
        for (const name of CATALOG_NAMES) {
          const stub = marshalToQuickJS(vm.ctx, { displayName: name });
          vm.ctx.setProp(vm.ctx.global, name, stub);
          stub.dispose();
        }

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

        // Build ambient DTS: library + function overlay + currentTask + upstream + seed variables
        const functionsOverlay = Object.keys(agentFunctions).length > 0
          ? buildOverlay(agentFunctions, { view: {}, form: {} })
          : '';
        const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
        const upstreamDts = task.upstreamOutputs
          ? Object.keys(task.upstreamOutputs).map((id) => `declare const ${id}: any;`).join('\n')
          : '';
        const seedDts = task.seed
          ? Object.keys(task.seed).map((k) => `declare const ${k}: any;`).join('\n')
          : '';
        // Forks have NO tasklist/fork/ask — strip their declarations so a stray call fails
        // typecheck (a clean retryable error) instead of passing typecheck then throwing at
        // runtime and salvaging. `delegate` is added back ONLY when the task may delegate.
        const forkBaseDts = LIBRARY_DTS_NO_ASK.replace(/^declare function (tasklist|fork|delegate)\b.*\r?\n/gm, '');
        const delegateDts = canDelegate
          ? 'declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<any>;\n'
            + 'declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<any>;'
          : '';
        const ambientDts = [forkBaseDts, delegateDts, functionsOverlay, currentTaskDts, upstreamDts, seedDts]
          .filter(Boolean)
          .join('\n');

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
        const allowWrite = roleProfile(task.role).allowWrite !== false;
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
          'CRITICAL INSTRUCTION: You are a TypeScript code execution agent. You MUST respond with TypeScript code ONLY. Do NOT write any prose, explanations, JSON, markdown, or natural language. Your entire response will be fed directly into a TypeScript evaluator.',
          '',
          ...(charterSection ? [charterSection] : []),
          ...(tasklistSection ? [tasklistSection] : []),
          rolePreamble(task.role),
          '',
          'Respond with valid TypeScript statements only. Use top-level `await` for async operations. Do not wrap code in functions or markdown code blocks.',
          'If you want to explain your reasoning or narrate a plan, write it as a `// comment` — NEVER as bare prose. Any non-comment text that is not valid TypeScript is a typecheck error and wastes a turn.',
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
          'FORBIDDEN: setTimeout, setInterval, queueMicrotask (not available)',
          'FORBIDDEN: markdown code fences (```typescript, ```ts, or ``` of any kind)',
          'FORBIDDEN: async IIFEs like `await (async () => { ... })()` — use sequential top-level await statements instead',
          '',
          ...(canDelegate
            ? [
                '',
                '# Delegation (allowed for this task)',
                'You MAY call `delegate(packageName, agentName, action?, { query, context })` (yields) — but ONLY to:',
                ...(task.canDelegateTo ?? []).map((t) => `  - ${t}`),
                'It returns the delegate\'s result; cast it. Keep the call FLAT at top level (never inside if/try/loop).',
              ]
            : []),
          '',
          'When your task is complete, call `currentTask.resolve(value)` with an object matching the output schema.',
          'The request and every input you need are in the seed variables / Inputs above — work with what you have, assume sensible defaults where details are missing, and resolve. Do not wait for input.',
          functionList,
        ].join('\n');

        const forkProcessYield = async (req: import('../eval/yield.js').YieldRequest): Promise<unknown> => {
            // Handle sleep in child
            if (req.kind === 'sleep') {
              const ms = req.args[1] as number;
              return new Promise<void>((res) => {
                if (this.opts.clock) {
                  this.opts.clock.setTimeout(res, ms);
                } else {
                  setTimeout(res, ms);
                }
              });
            }
            // loadKnowledge: the global also fires loadKnowledgeFile().then(resolve)
            // concurrently, but processYield must return the content here to win the
            // race — otherwise undefined is bound to the variable before the file
            // read completes.
            if (req.kind === 'loadKnowledge') {
              const { loadKnowledgeFile } = await import('../globals/load-knowledge.js');
              const { join } = await import('node:path');
              const filePath = join(this.opts.parentSpaceDir, 'knowledge', ...(req.args[0] as string).split('/'));
              return loadKnowledgeFile(filePath);
            }
            // registerSpace: load the space and insert it into the SHARED dynamicSpaces
            // map (same reference the parent Session hands to delegate()), so a space
            // registered inside a fork is reachable by the parent's later delegate().
            if (req.kind === 'registerSpace') {
              const { loadSpace } = await import('../spaces/load.js');
              const dir = req.args[0] as string;
              try {
                const space = await loadSpace(dir);
                this.opts.dynamicSpaces?.set(dir, space);
                return { ok: true, spaceKey: dir, agentSlug: Object.keys(space.agents)[0] ?? '' };
              } catch (err) {
                return { ok: false, spaceKey: '', agentSlug: '', error: String((err as Error)?.message ?? err) };
              }
            }
            // delegate: gated by the task's canDelegateTo allowlist; routed to the engine's
            // delegateRunner (which owns the registry + recursion bound). A disallowed target
            // throws a clear error that surfaces to the model (retryable) rather than silently
            // binding undefined.
            if (req.kind === 'delegate') {
              const [packageName, agentName, action, delegateOpts] = req.args as [string, string, string | undefined, unknown];
              const allow = resolveTaskDelegate(task.canDelegateTo ?? [], packageName, agentName);
              if (!allow) {
                throw new Error(
                  `delegate("${packageName}", "${agentName}") is not permitted from this task — allowed: ${(task.canDelegateTo ?? []).join(', ') || '(none)'}`,
                );
              }
              if (!this.opts.delegateRunner) throw new Error('delegation is not available in this context');
              return this.opts.delegateRunner(packageName, agentName, action, delegateOpts, allow.allowedActions);
            }
            // fetch: a leaf VM has no parent yield-router to fall back to, so it resolves
            // its own real, non-blocking HTTP call (same helper the session/delegate path uses).
            if (req.kind === 'fetch') {
              const [url, fetchOpts] = req.args as [string, import('../globals/fetch.js').FetchOpts | undefined];
              const { resolveFetchYield } = await import('../eval/fetch-yield.js');
              return resolveFetchYield(url, fetchOpts);
            }
            return undefined;
          };

        const forkLoopOpts = {
          vm,
          history,
          systemBlock,
          ambientDts,
          renderHost: this.opts.renderHost,
          streamFn: this.opts.streamFn,
          processYield: forkProcessYield,
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
          }
        }

        // Last resort: the model refused to resolve across every forced turn. Rather
        // than fail the parent (which would abort the whole tasklist/run), salvage a
        // schema-valid placeholder so orchestration can proceed. The content is honest
        // about being incomplete so downstream consumers can react.
        //
        // EXCEPTION: a fork given an explicit `timeout` opted into a hard time bound —
        // the caller wants failure on non-completion, not a salvaged guess. So we skip
        // salvage there and let the no-resolve rejection (or the timeout) stand. Tasklist
        // tasks, delegates and role forks set no timeout, so they always salvage.
        if (!didResolve && !task.timeout && !settled) {
          this.opts.renderHost.log(`[fork] model never resolved — salvaging a schema-valid placeholder`);
          resolvedValue = salvageOutput(task.output);
          resolvedError = undefined;
          didResolve = true;
        }

        // All QuickJS call frames have exited — safe to dispose.
        vm.dispose();
        vm = undefined;

        settle(() => {
          if (didResolve && !resolvedError) {
            resolve(resolvedValue as T);
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
