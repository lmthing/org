import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession, MediaPart } from '../eval/stream-types.js';
import type { DelegateOpts } from '../globals/delegate.js';
import type { DelegateRegistry } from './registry.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import { resolveDirectDeps, getAgentFunctions, getAgentFunctionsBundled } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import { MessageHistory } from '../context/history.js';
import { buildSystemBlock, resolvePreloadedKnowledge } from '../context/system-block.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { routeCommonYield } from '../eval/yield-router.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { systemFunctionSources, systemFunctionsBundled } from '../spaces/system.js';
import type { Space } from '../spaces/load.js';
import type { BudgetLimits } from '../eval/budget.js';
import { Budget, BudgetExceededError } from '../eval/budget.js';
import type { RoleModelConfig } from '../fork/roles.js';
import { delegateCapabilities } from '../exec/capability.js';
import { createChildVM, buildAmbientDts } from '../exec/bootstrap.js';
import type { AppGlobalImpls } from '../exec/app-globals.js';
import type { DocumentResolver } from '../globals/read-document.js';
import { forkEngineOptsFrom } from '../exec/fork-config.js';
import { evaluateDelegatePolicy, isDelegateAllowed, formatDelegateDenial } from '../exec/target-match.js';

export interface RunDelegateOpts {
  packageName: string;
  agentName: string;
  /** Optional: omit to run the agent model-driven (it sees its own actions/tasklists). */
  action?: string;
  /** Subset of action ids the calling agent's `canDelegateTo` permits on this target.
   *  `undefined` = unrestricted (all actions, including the no-action model-driven
   *  form, are allowed) — e.g. the session's top-level entry point, which has no
   *  delegator-side restriction to enforce. Populated by the yield-router/session
   *  layer from the delegator's resolved `ResolvedDep.allowedActions`. */
  allowedActions?: string[];
  delegateOpts?: DelegateOpts;
  registry: DelegateRegistry;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  depth: number;
  maxDepth: number;
  maxConcurrentForks: number;
  clock?: Clock;
  tracer?: Tracer;
  /** Parent execution scope for hierarchical observability. */
  scope?: TraceScope;
  systemSpaces?: Space[];
  /** Absolute path to the project's spaces/ dir. Propagated into the delegate VM as
   *  LMTHING_PROJECT_SPACES_DIR and forwarded to nested delegate/fork VMs. */
  projectSpacesDir?: string;
  /** Absolute project root — the delegated specialist operates on the PARENT's project
   *  (LMTHING_PROJECT_DIR), so app grants resolve against the current project, not the
   *  system space the specialist lives in. Forwarded to nested delegates/forks. */
  projectRoot?: string;
  /** Project id — forwarded as LMTHING_PROJECT_ID. */
  projectId?: string;
  /** Host-provided app-global engine impls (libs/cli, P2+), forwarded to the delegate
   *  VM and its nested forks so a delegated db-writer reaches the project's engine. */
  appGlobals?: AppGlobalImpls;
  /** Host resolver for the universal `readDocument` global — threaded from the session
   *  (project-independent, NOT an app-global) so a delegated files agent can read an
   *  attached upload's text. Forwarded verbatim to nested delegates + forks. */
  documentResolver?: DocumentResolver;
  /** Model spec/alias used by streamFn — forwarded to runTurnLoop so llm_request events
   *  carry a model field and cost tracking works across delegate chains. Overridden
   *  by the delegated agent's own `model:` frontmatter when set (e.g. a vision agent). */
  model?: string;
  /** Multimodal attachments (image/binary-file MediaParts) to attach to the
   *  delegated agent's initial user message — lets THING route an image to a
   *  vision agent. Resolved by the session's runDelegate from `attachmentIds`. */
  attachments?: MediaPart[];
  /** Id-anchored notes for file attachments, appended to the delegated agent's
   *  message telling it to fetch each file's content via `readDocument(id)`. */
  attachmentTexts?: string[];
  /** Host budget caps inherited from the parent context (session opts, or the outer
   *  delegate layer). Applied to each fork THIS delegate spawns (fresh Budget per
   *  fork) — not to the delegate's own turn loop. Before the A1 fix this was
   *  silently dropped at the delegate boundary, so leaf forks nested under a
   *  delegate ran uncapped and never received the near-limit "resolve NOW" nudge. */
  budgetLimits?: BudgetLimits;
  /** Per-role fork model assignment inherited from the parent session (A1 fix —
   *  previously dropped, so explore/plan forks under a delegate ran on the wrong model). */
  roleModels?: RoleModelConfig;
  /** Spaces registered at runtime via registerSpace() — the SAME Map reference the
   *  parent Session owns, so a registerSpace() inside a fork under this delegate is
   *  visible to later parent delegate() calls (A1 fix — previously a dead path). */
  dynamicSpaces?: Map<string, Space>;
}

export async function runDelegate(opts: RunDelegateOpts): Promise<unknown> {
  const target = `${opts.packageName}/${opts.agentName}`;

  if (opts.depth >= opts.maxDepth) {
    throw new Error(
      `Maximum delegation depth (${opts.maxDepth}) exceeded at target "${target}"`,
    );
  }

  const { space, agent } = await opts.registry.resolveLazy(target);

  // The delegated agent may declare its own model (frontmatter `model:`), e.g. a
  // vision agent needing a vision-capable model. Its own turns run on that model;
  // fall back to the caller's inherited model when unset.
  const turnModel = agent.model ?? opts.model;

  // Seed registry with this space's npm deps so nested delegates can resolve them
  for (const [pkgName, depSpace] of Object.entries(space.dependentSpaces)) {
    opts.registry.addSpace(pkgName, depSpace);
    opts.registry.addSpace(depSpace.dir, depSpace);
  }

  // Enforce the delegator's canDelegateTo action restriction, when known. The caller
  // (globals/delegate.ts's yield handler, via the yield-router) passes the resolved
  // dependency's `allowedActions` for the target agent; `undefined` means "not
  // restricted at the caller layer" (e.g. the top-level session entry point, or a
  // dependency-less call) and `[]`/populated arrays gate which actions may run.
  if (opts.action && opts.allowedActions && !opts.allowedActions.includes(opts.action)) {
    throw new Error(
      `Delegate target "${target}" does not allow action "${opts.action}" — allowed actions: ${opts.allowedActions.length ? opts.allowedActions.join(', ') : '(none)'}`,
    );
  }

  const tracer = opts.tracer ?? NULL_TRACER;
  const delegateLabel = `delegate:${opts.packageName}/${opts.agentName}/${opts.action ?? '(model-driven)'}`;
  // Mint a delegate scope for full observability; end() in finally below
  const queryPreview =
    typeof opts.delegateOpts?.query === 'string'
      ? opts.delegateOpts.query.slice(0, 500)
      : undefined;
  const delegateScope = tracer.child(opts.scope, 'delegate', delegateLabel, {
    pkg: opts.packageName,
    agent: opts.agentName,
    action: opts.action,
    depth: opts.depth,
    ...(queryPreview !== undefined ? { query: queryPreview } : {}),
  });

  // Unified canDelegateTo semantics: the DELEGATED agent's own policy decides
  // whether `delegate` exists in its VM/DTS/prompt, and (yield-time, below)
  // which targets its calls may hit. Omitted = unrestricted (back-compat);
  // [] = none; ["*"] = unrestricted; list = hard allowlist (+ "registered:*").
  const delegatePolicy = evaluateDelegatePolicy(agent.canDelegateTo, 'agent');
  const directDeps = resolveDirectDeps(space, agent.canDelegateTo);

  // The universal `global` toolkit (readFile, grep, remember, …) is injected into every
  // delegate VM below. Surface it in the system prompt AND the typecheck overlay too —
  // otherwise an agent that calls a bare global tool (e.g. the memory agent's remember())
  // fails typecheck with "Cannot find name", since it declares no functions of its own.
  const systemFnSources = systemFunctionSources(opts.systemSpaces ?? []);
  const knowledgePreloads = await resolvePreloadedKnowledge(space, agent);
  const systemBlock = buildSystemBlock({ space, agent, directDeps, systemFunctions: systemFnSources, knowledgePreloads, omitAsk: true, omitDelegate: delegatePolicy.mode === 'none' });

  // The delegated agent runs with ITS OWN declared app grants, but project-rooted at
  // the PARENT's projectRoot (forwarded below) — so a delegated specialist mutates the
  // current project's app, not the system space it lives in.
  const capabilities = delegateCapabilities(delegatePolicy.mode !== 'none', agent.capabilities ?? {});

  // action is optional. When provided it must exist; when omitted the agent runs
  // model-driven and may initiate one of its own actions' tasklists (its # Actions
  // section is rendered into the system prompt by buildSystemBlock).
  const actionDef = opts.action ? agent.actions.find((a) => a.id === opts.action) : undefined;
  if (opts.action && !actionDef) {
    throw new Error(`Action "${opts.action}" not found on agent "${agent.slug}"`);
  }

  const query = opts.delegateOpts?.query ?? '';
  const context = opts.delegateOpts?.context;

  // Result capture. Tasklists whose result should be auto-captured if the model
  // forgets to call currentTask.resolve(): the action's own tasklist when an action
  // was given, or ANY of the agent's action tasklists when delegated model-driven.
  let capturedResult: unknown = undefined;
  let resultCaptured = false;
  const capturableTasklists = actionDef?.tasklist
    ? new Set<string>([actionDef.tasklist])
    : new Set<string>(agent.actions.map((a) => a.tasklist).filter(Boolean));

  // Space functions injected into the VM (system functions + agent functions).
  const agentFunctions = getAgentFunctions(space, agent);
  const agentFunctionsBundled = getAgentFunctionsBundled(space, agent);
  const agentComponents = getAgentComponents(space, agent);
  const systemSpaces = opts.systemSpaces ?? [];
  const functions = { ...systemFnSources, ...agentFunctions };
  const functionsBundled = { ...systemFunctionsBundled(systemSpaces), ...agentFunctionsBundled };

  // Shared child-VM bootstrap: query/context seed vars, currentTask capture,
  // functions, host tools, yielding globals per the capability profile (no ask —
  // a delegated agent is a programmatic sub-agent that must run autonomously from
  // its query/context; no registerSpace) and the JSX runtime with this agent's
  // component stubs. NOTE: no `progress` — the delegate's own turn loop carries
  // no Budget today (only the forks it spawns do, via budgetLimits below).
  const vm = await createChildVM({
    capabilities,
    renderHost: opts.renderHost,
    clock: opts.clock,
    spaceDir: space.dir,
    projectSpacesDir: opts.projectSpacesDir,
    projectRoot: opts.projectRoot,
    projectId: opts.projectId,
    appGlobals: opts.appGlobals,
    progress: undefined,
    functions,
    functionsBundled,
    componentNames: [...Object.keys(agentComponents.view), ...Object.keys(agentComponents.form)],
    onDisplay: (value) => {
      tracer.write({ ts: Date.now(), type: 'display', context: delegateScope.label, nodeId: delegateScope.nodeId, descriptor: value });
    },
    currentTaskResolve: (value) => {
      capturedResult = value;
      resultCaptured = true;
    },
    // Expose the seed as real VM variables so the agent can pass structured data
    // straight into its tasklist (`tasklist(action, context)`) — see the seed
    // declarations in the ambient DTS below.
    seedVars: { query, context: context ?? {} },
    onFunctionError: (name, error) => {
      opts.renderHost.log(`[warn] failed to inject function "${name}": ${error}`);
    },
  });

  try {
    const history = new MessageHistory();

    const tasklistHint = actionDef?.tasklist
      ? `Implement this action by calling \`const result = await tasklist("${actionDef.tasklist}", { query, ...context })\` — \`query\` (string) and \`context\` (object) are in scope as real variables holding the seed data above; the tasklist's input schema needs \`query\` INSIDE the seed object, so spread both as shown. The tasklist handles the orchestration. After it resolves, call \`currentTask.resolve(result)\`.`
      : actionDef
        ? `When complete, call \`currentTask.resolve(result)\` with the final result value.`
        : `Handle this request directly. If one of your actions fits (see "# Actions"), run its tasklist with \`const result = await tasklist("<name>", { query, ...context })\`. When done, call \`currentTask.resolve(result)\` with the final result value.`;
    const userMessage = [
      opts.action ? `Run action: ${opts.action}` : `You have been delegated this request — handle it using your available actions/tasklists or directly.`,
      query ? `Query: ${query}` : '',
      context ? `Context: ${JSON.stringify(context)}` : '',
      // File attachments contribute an id-anchored note here telling this agent to
      // fetch their content via readDocument(id). Image attachments ride as a part.
      ...(opts.attachmentTexts ?? []),
      tasklistHint,
    ]
      .filter(Boolean)
      .join('\n');

    // Attachments (image/file MediaParts) ride on the delegate's user message so a
    // vision/file agent's model actually receives the image/document. The turn loop
    // + provider layer already forward `attachments` into the ModelMessage content.
    history.append({
      role: 'user',
      content: userMessage,
      ...(opts.attachments && opts.attachments.length ? { attachments: opts.attachments } : {}),
      blockType: 'normal',
    });

    // Ambient DTS via the shared additive builder: library minus `ask`, this
    // agent's function/component overlay, the currentTask capture global, and
    // the query/context seed variables (injected as real VM variables above so
    // an agent can seed its tasklist with structured data handed down by the
    // delegator instead of re-serializing it from prose).
    const overlay = buildOverlay({ ...systemFnSources, ...agentFunctions }, agentComponents);
    const ambientDts = buildAmbientDts({
      capabilities,
      overlay,
      currentTask: true,
      projectRoot: !!opts.projectRoot,
      extraDecls: [`declare const query: string;\ndeclare const context: Record<string, any>;`],
    });

    // Runs a child delegate — from this agent's top level OR from one of its tasks' forks —
    // one level deeper, with the recursion cap enforced by runDelegate's depth/maxDepth.
    // Spreading opts forwards the inherited parent context (budgetLimits/roleModels/
    // dynamicSpaces/projectSpacesDir/…) down arbitrary nesting.
    const runChildDelegate = (
      packageName: string,
      agentName: string,
      action: string | undefined,
      childOpts: DelegateOpts | undefined,
      allowedActions: string[] | undefined,
    ): Promise<unknown> =>
      runDelegate({
        ...opts,
        packageName,
        agentName,
        action,
        allowedActions,
        delegateOpts: childOpts,
        scope: delegateScope,
        depth: opts.depth + 1,
      });

    const { ForkEngine } = await import('../fork/fork.js');
    // THE A1 FIX: the delegate-side ForkEngine is built through the same
    // exhaustively-typed options builder as the session's, so it can no longer
    // silently drop fields — it now inherits budgetLimits (leaf forks get real
    // budgets + the near-limit nudge), roleModels (right per-role model),
    // forkDepth (meaningful nesting accounting) and dynamicSpaces (a fork's
    // registerSpace() propagates back to the session) from its parent context.
    const forkEngine = new ForkEngine(forkEngineOptsFrom({
      maxConcurrentForks: opts.maxConcurrentForks,
      parentHistory: history.messages,
      parentSpaceDir: space.dir,
      parentAgentSlug: agent.slug,
      parentAgentCharter: agent.charterBody,
      agentFunctions: functions,
      agentFunctionsBundled: functionsBundled,
      renderHost: opts.renderHost,
      streamFn: opts.streamFn,
      clock: opts.clock,
      tracer: opts.tracer,
      projectSpacesDir: opts.projectSpacesDir,
      projectRoot: opts.projectRoot,
      projectId: opts.projectId,
      // This delegate's forks inherit ITS app grants (role-intersected in forkCapabilities).
      parentAppCapabilities: capabilities.app,
      appGlobals: opts.appGlobals,
      defaultModel: opts.model,
      budgetLimits: opts.budgetLimits,
      roleModels: opts.roleModels,
      // Forks spawned by this delegate nest one level below its delegation depth:
      // a top-level delegate (depth 0) spawns depth-1 forks (same as session forks);
      // each nested delegate layer pushes its forks one level deeper.
      forkDepth: opts.depth + 1,
      dynamicSpaces: opts.dynamicSpaces,
      // A task in this agent's tasklist may delegate (gated by its own canDelegateTo); route it
      // through the same depth-incrementing runner this agent uses for its own delegate() calls.
      delegateRunner: (packageName, agentName2, action, childOpts, allowedActions) =>
        runChildDelegate(packageName, agentName2, action, childOpts as DelegateOpts | undefined, allowedActions),
      // Forks under this delegate may read attachments too — thread the resolver.
      documentResolver: opts.documentResolver,
    }));

    try {
      await runTurnLoop({
        vm,
        history,
        systemBlock,
        ambientDts,
        renderHost: opts.renderHost,
        streamFn: opts.streamFn,
        processYield: async (req) => {
          // sleep / fork / tasklist / delegate share the central router. The two
          // delegate-specific behaviours are passed as hooks: auto-capture of the
          // action's tasklist result, and depth-incremented recursion.
          const routed = await routeCommonYield(req, {
            space,
            clock: opts.clock,
            tracer: opts.tracer,
            scope: delegateScope,
            apiCallResolver: opts.appGlobals?.apiCall,
            apiCallAllow: capabilities.app['api:call']?.allow,
            connectionResolver: opts.appGlobals?.callConnection,
            documentResolver: opts.documentResolver,
            // Store search/inspect + manual emits work in delegates (system-store
            // runs AS a delegate of THING); consent-marked kinds (installSpace)
            // still FAIL CLOSED here — no requestConsent is wired (delegates are
            // headless), so the router's consent gate refuses before install.
            storeResolver: opts.appGlobals?.store,
            emitEventResolver: opts.appGlobals?.emitEvent,
            // installSpace live-registers into the session-shared map (visible to
            // the parent's later delegate()) — same reference forks receive.
            dynamicSpaces: opts.dynamicSpaces,
            getForkEngine: () => forkEngine,
            // `result` is the tasklist's TaskEnvelope ({ ok, degraded, data, … })
            // since Phase 3 — captured and returned UNTOUCHED, so the delegator
            // sees the same envelope contract as a direct tasklist() caller.
            onTasklistResult: (name, result) => {
              if (capturableTasklists.has(name) && !resultCaptured) {
                capturedResult = result;
                resultCaptured = true;
              }
            },
            runDelegate: (packageName, agentName, action, delegateOpts2) => {
              // Yield-time canDelegateTo gate (unified semantics): this agent's
              // policy decides whether the target is callable at all — an
              // out-of-list target throws an actionable, retryable error naming
              // the allowed targets. `registered:*` consults the session-shared
              // dynamicSpaces map at call time. On an allowlist match, the
              // entries' `#action` suffixes narrow the allowed actions (the same
              // enforcement the old directDeps lookup fed into runDelegate).
              const allow = isDelegateAllowed(delegatePolicy, packageName, agentName, opts.dynamicSpaces);
              if (!allow.allowed) {
                throw new Error(formatDelegateDenial(delegatePolicy, packageName, agentName, 'agent'));
              }
              return runChildDelegate(packageName, agentName, action, delegateOpts2, allow.allowedActions);
            },
          });
          return routed.handled ? routed.value : undefined;
        },
        maxRetries: 3,
        tracer: tracer,
        traceContext: delegateLabel,
        scope: delegateScope,
        model: turnModel,
      });
      // GUARANTEE (mirrors fork.ts): a delegate whose model finished without calling
      // currentTask.resolve() — and without running a capturable tasklist — must not
      // hand `undefined` back to the delegator. The live E4 failure: the engineer did
      // all the work (wrote files, ran tests) but never resolved, the delegator got
      // null twice, gave up on the specialist, and improvised the work inline. Force
      // resolve-only turns with a fresh small budget before returning.
      for (let nudge = 0; nudge < 2 && !resultCaptured; nudge++) {
        opts.renderHost.log(`[delegate] no resolve — forcing resolve (attempt ${nudge + 1})`);
        history.append({
          role: 'user',
          content: [
            'STOP. Do NOT run any more tools, searches, shell commands, or edits.',
            'You must return your result THIS TURN by calling currentTask.resolve().',
            'Emit EXACTLY ONE statement: a single currentTask.resolve({...}) call that',
            'packages the deliverable you already produced above (the code you wrote,',
            'the answer you found, the files you created — reference bound variables',
            'where possible). Returning a result is REQUIRED; any other code is rejected.',
          ].join('\n'),
          blockType: 'normal',
        });
        try {
          await runTurnLoop({
            vm,
            history,
            systemBlock,
            ambientDts,
            renderHost: opts.renderHost,
            streamFn: opts.streamFn,
            processYield: async () => undefined, // resolve-only turns: no yields serviced
            maxRetries: 3,
            budget: new Budget({ maxEpisodes: 4 }),
            tracer: tracer,
            traceContext: `${delegateLabel}:resolve_nudge`,
            scope: delegateScope,
            model: turnModel,
          });
        } catch (err) {
          if (!(err instanceof BudgetExceededError)) throw err;
        }
      }
      tracer.end(delegateScope, 'done', resultCaptured ? { result: capturedResult } : undefined);
    } catch (err) {
      tracer.end(delegateScope, 'error', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    return resultCaptured ? capturedResult : undefined;
  } finally {
    vm.dispose();
  }
}
