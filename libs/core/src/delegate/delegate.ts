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
import { systemFunctionSources, systemFunctionsBundled, filterUniversalFunctions } from '../spaces/system.js';
import type { Space } from '../spaces/load.js';
import type { BudgetLimits } from '../eval/budget.js';
import { Budget, BudgetExceededError } from '../eval/budget.js';
import type { RoleModelConfig } from '../fork/roles.js';
import { delegateCapabilities } from '../exec/capability.js';
import { createChildVM, buildAmbientDts } from '../exec/bootstrap.js';
import type { DbTableSchema } from '../typecheck/library-dts.js';
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
  /** The parent session's current DB schema (table + column names) — passed to the delegate's
   *  ambient DTS (and its nested forks) so a GATED delegated specialist (db:read/db:write, not
   *  a schema author) has its `db.*` table/column names constrained to the real project schema. */
  dbSchema?: DbTableSchema[];
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
  /** Host runner for `kind:'code'` tasklist nodes. A delegated agent runs its OWN action
   *  tasklists through the yield router below, so without this a code node in one of them
   *  fails with "no codeNodeCtxFactory was provided" — even though the delegating session
   *  has one. That is not a clean failure: the delegate's required task dies, and the model
   *  then abandons the tasklist and free-hands the work instead (observed live: the
   *  appbuilder's automator answered the error with "the tasklist code-node runner isn't
   *  available in this session — I'll build the app directly"). Threaded from the parent
   *  session so a delegated tasklist gates exactly like a top-level one. */
  codeNodeCtxFactory?: import('../tasklist/orchestrator.js').CodeNodeCtxFactory;
}

/** A plain object (not null, not an array) — the only shape carrying an `ok` worth reading. */
function plainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Truthy-`ok` object test, tolerant of the many shapes a resolve can take. */
function claimsOk(v: unknown): v is Record<string, unknown> {
  return plainObject(v) && v['ok'] === true;
}

/**
 * Did the tasklist say this run FAILED? Two independent `ok`s have to be read, and confusing them
 * is why the first cut of this check would not have caught the bug that motivated it:
 *
 *  - **`envelope.ok`** is ORCHESTRATION success — "the goal task resolved a schema-valid value
 *    (no salvage)" ({@link TaskEnvelope}). A pipeline that ran to completion and concluded the app
 *    is broken has `envelope.ok === true`.
 *  - **`envelope.data.ok`** is the pipeline's own DOMAIN verdict — `build_live_project`'s
 *    `18-finalize` computes it from the host-run gates (`verify.ok && built && viewsValidated &&
 *    renderSmoked && …`). This is the one that was `false` in the live run.
 *
 * Either being `false` means the run did not succeed.
 */
function tasklistSaysFailed(envelope: unknown): boolean {
  if (!plainObject(envelope)) return false;
  if (envelope['ok'] === false) return true;
  const data = envelope['data'];
  return plainObject(data) && data['ok'] === false;
}

/**
 * **A relay may not upgrade its own pipeline's verdict.**
 *
 * A delegated agent whose whole job is to run an action tasklist and hand back the envelope can
 * instead resolve a value of its own making — `currentTaskResolve` overwrites `capturedResult`, so
 * the claim wins and nothing compares it to what the pipeline actually computed. Measured live
 * (13-plant-care run 4): `build_live_project`'s own `finalize` resolved `ok: false`; the automator
 * relayed `{ok: true, degraded: true, summary: "…app built…"}` while listing two broken endpoints
 * in the same object. The caller was told the build succeeded. Prose in the agent's instruct had
 * already been patched TWICE for this exact failure, which is what makes it structural rather than
 * a prompting problem: `ok` has to come from the pipeline, not from the relay.
 *
 * So when the action tasklist reported `ok: false` and the agent's own resolve claims `ok: true`,
 * the `ok` is put back to `false` and the disagreement recorded in `okOverriddenBy`. Everything
 * else the agent said is KEPT — its summary and error list are usually the most readable account
 * of what went wrong, and discarding them would trade one dishonesty for a different one.
 *
 * Deliberately one-directional: an agent resolving `ok: false` over a passing tasklist stands
 * unchanged. It may have seen something the gates do not cover, and pessimism is not the failure
 * mode being defended against.
 */
function reconcileOk(resolved: unknown, envelope: unknown): unknown {
  if (!claimsOk(resolved)) return resolved;
  if (resolved === envelope) return resolved; // relayed verbatim; nothing to reconcile
  if (!tasklistSaysFailed(envelope)) return resolved;
  return {
    ...resolved,
    ok: false,
    okOverriddenBy: 'tasklist',
    okOverrideReason:
      'the action tasklist resolved ok:false; a delegated agent cannot report success over its ' +
      "own pipeline's verdict. The fields below are the agent's own account and are kept as-is.",
  };
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
  //
  // `systemFnSources` stays UNFILTERED — it becomes the fork-engine POOL source below (a task
  // node's `functions:` allow-list must be able to select a granted-only function like
  // webSearch/webFetch that THIS agent itself wasn't granted at top level). The INJECTED view
  // (system block + overlay + VM) narrows it via filterUniversalFunctions, withholding
  // granted-only universal functions unless this agent's own `functions:` frontmatter names
  // them. See `.issues/research-store-noop-diagnosis.md` (Slice B).
  const systemFnSources = systemFunctionSources(opts.systemSpaces ?? []);
  const injectedSystemFnSources = filterUniversalFunctions(systemFnSources, agent.config.functions);
  const knowledgePreloads = await resolvePreloadedKnowledge(space, agent);
  const systemBlock = buildSystemBlock({ space, agent, directDeps, systemFunctions: injectedSystemFnSources, knowledgePreloads, omitAsk: true, omitDelegate: delegatePolicy.mode === 'none' });

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
  /**
   * The LAST envelope a capturable tasklist produced, kept SEPARATELY from `capturedResult`
   * because an explicit `currentTask.resolve()` overwrites the latter — which is how a relay
   * agent's own claim silently replaced its pipeline's verdict. See {@link reconcileOk}.
   */
  let capturedEnvelope: unknown = undefined;
  const capturableTasklists = actionDef?.tasklist
    ? new Set<string>([actionDef.tasklist])
    : new Set<string>(agent.actions.map((a) => a.tasklist).filter(Boolean));
  // First resolution of a capturable tasklist is a FALLBACK only — it does not stop the
  // loop. This lets a "probe tasklist, escalate on a field in its result" pattern (e.g.
  // an `answer` tasklist that resolves `{covered:false}`, prompting the model to run
  // `research_and_store` next) complete naturally: the model gets to see the first
  // result and act on it before the delegate's turn loop is torn down. A tasklist with
  // the SAME name resolving a SECOND time (the model re-running it, or a stuck-loop
  // re-emission) IS treated as terminal — see onTasklistResult below.
  // See `.issues/research-store-noop-diagnosis.md` (auto-capture early-stop fix).
  const seenCapturableTasklists = new Set<string>();

  // Space functions injected into the VM (system functions + agent functions).
  const agentFunctions = getAgentFunctions(space, agent);
  const agentFunctionsBundled = getAgentFunctionsBundled(space, agent);
  const agentComponents = getAgentComponents(space, agent);
  const systemSpaces = opts.systemSpaces ?? [];
  const systemFnBundled = systemFunctionsBundled(systemSpaces);
  // The two-set split: `injectedFunctions`/`injectedFunctionsBundled` (filtered — the child
  // VM's actual functions/functionsBundled AND the typecheck overlay) vs `poolFunctions`/
  // `poolFunctionsBundled` (UNFILTERED superset — the ForkEngine's `agentFunctions`/
  // `agentFunctionsBundled`, which a task's `functions:` allow-list narrows FROM).
  const injectedFunctions = { ...injectedSystemFnSources, ...agentFunctions };
  const injectedFunctionsBundled = { ...filterUniversalFunctions(systemFnBundled, agent.config.functions), ...agentFunctionsBundled };
  const poolFunctions = { ...systemFnSources, ...agentFunctions };
  const poolFunctionsBundled = { ...systemFnBundled, ...agentFunctionsBundled };

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
    // Each merged system space's own knowledge dir — same reasoning as the
    // session/fork sites: an on-demand loadKnowledge() domain that lives only in
    // a space merged INTO `space` (not `space.dir` itself) would otherwise ENOENT.
    knowledgeFallbackDirs: systemSpaces.map((s) => s.dir + '/knowledge'),
    projectSpacesDir: opts.projectSpacesDir,
    projectRoot: opts.projectRoot,
    projectId: opts.projectId,
    appGlobals: opts.appGlobals,
    progress: undefined,
    functions: injectedFunctions,
    functionsBundled: injectedFunctionsBundled,
    componentNames: [...Object.keys(agentComponents.view), ...Object.keys(agentComponents.form)],
    onDisplay: (value) => {
      tracer.write({ ts: Date.now(), type: 'display', context: delegateScope.label, nodeId: delegateScope.nodeId, descriptor: value });
    },
    // A delegate's setActivity is a SUB-activity keyed by its node — the UI clears
    // it on this node's node_end (or on an explicit '' clear).
    onActivity: (text) => {
      tracer.write({ ts: Date.now(), type: 'activity', context: delegateScope.label, nodeId: delegateScope.nodeId, scope: 'delegate', text });
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
    const overlay = buildOverlay(injectedFunctions, agentComponents);
    const ambientDts = buildAmbientDts({
      capabilities,
      overlay,
      currentTask: true,
      projectRoot: !!opts.projectRoot,
      dbSchema: opts.dbSchema,
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
      // The UNFILTERED pool, not the (possibly narrower) injectedFunctions — a task's
      // `functions:` allow-list must be able to select a granted-only function (webSearch/
      // webFetch) this delegate itself wasn't granted at top level. See poolFunctions above.
      agentFunctions: poolFunctions,
      agentFunctionsBundled: poolFunctionsBundled,
      renderHost: opts.renderHost,
      streamFn: opts.streamFn,
      clock: opts.clock,
      tracer: opts.tracer,
      projectSpacesDir: opts.projectSpacesDir,
      projectRoot: opts.projectRoot,
      projectId: opts.projectId,
      // This delegate's forks inherit ITS app grants (role-intersected in forkCapabilities).
      parentAppCapabilities: capabilities.app,
      dbSchema: opts.dbSchema,
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
      // Same reasoning as the createChildVM call above — a task node's spaceDir is
      // this delegate's own space.dir, so its on-demand loadKnowledge() needs the
      // same per-merged-system-space fallback dirs.
      knowledgeFallbackDirs: systemSpaces.map((s) => s.dir + '/knowledge'),
    }));

    let delegateContext = '';
    try {
      await runTurnLoop({
        vm,
        history,
        systemBlock,
        ambientDts,
        onContextSnapshot: (c: string) => { delegateContext = c; },
        renderHost: opts.renderHost,
        streamFn: opts.streamFn,
        // Structural termination: once this delegate's action tasklist result is auto-captured
        // (onTasklistResult below) — or the model explicitly currentTask.resolve()s — the
        // deliverable is in hand, so end the loop instead of re-prompting. Without this a
        // weak/looping model that keeps re-emitting the same `tasklist(action, …)` call every
        // turn (never volunteering a no-statements turn) spins forever, since this loop carries
        // no Budget. `resultCaptured` is the delegate's TERMINAL signal — set only on the
        // action tasklist's envelope or an explicit resolve, never on an intermediate.
        shouldStop: () => resultCaptured,
        processYield: async (req) => {
          // sleep / fork / tasklist / delegate share the central router. The two
          // delegate-specific behaviours are passed as hooks: auto-capture of the
          // action's tasklist result, and depth-incremented recursion.
          const routed = await routeCommonYield(req, {
            space,
            clock: opts.clock,
            tracer: opts.tracer,
            scope: delegateScope,
            // Own space first, then each merged system space's own knowledge dir —
            // without this a direct loadKnowledge() from THIS delegate's own
            // statements fell through unhandled and bound `undefined` immediately
            // (routed.handled === false below), never even reaching the injected
            // global's own (losing) resolve race.
            knowledgeBaseDirs: [space.dir + '/knowledge', ...systemSpaces.map((s) => s.dir + '/knowledge')],
            apiCallResolver: opts.appGlobals?.apiCall,
            apiCallAllow: capabilities.app['api:call']?.allow,
            connectionResolver: opts.appGlobals?.callConnection,
            documentResolver: opts.documentResolver,
            // Store search/inspect + manual emits work in delegates (system-store
            // runs AS a delegate of THING); consent-marked kinds (installSpace)
            // still FAIL CLOSED here — no requestConsent is wired (delegates are
            // headless), so the router's consent gate refuses before install.
            storeResolver: opts.appGlobals?.store,
            hostFsResolver: opts.appGlobals?.hostFs,
            hostCdpResolver: opts.appGlobals?.hostCdp,
            emitEventResolver: opts.appGlobals?.emitEvent,
            // A delegate acts for the SAME caller in the SAME channel, so it gets
            // the parent's turn-bound team resolver unchanged — including its
            // viewer refusal. What a delegate may CALL is still its own grants'
            // business (a delegate without `team:post` has no writers injected).
            teamResolver: opts.appGlobals?.team,
            // installSpace live-registers into the session-shared map (visible to
            // the parent's later delegate()) — same reference forks receive.
            dynamicSpaces: opts.dynamicSpaces,
            getForkEngine: () => forkEngine,
            // Code nodes in THIS delegate's own action tasklists (see the opt's doc).
            codeNodeCtxFactory: opts.codeNodeCtxFactory,
            // `result` is the tasklist's TaskEnvelope ({ ok, degraded, data, … })
            // since Phase 3 — captured and returned UNTOUCHED, so the delegator
            // sees the same envelope contract as a direct tasklist() caller.
            onTasklistResult: (name, result) => {
              if (!capturableTasklists.has(name) || resultCaptured) return;
              if (seenCapturableTasklists.has(name)) {
                // RE-EMISSION: the same capturable tasklist resolved a second time —
                // either a stuck-loop re-run or the model deliberately re-invoking it.
                // This IS terminal: capture the LATEST result and stop.
                capturedResult = result;
                capturedEnvelope = result;
                resultCaptured = true;
                return;
              }
              seenCapturableTasklists.add(name);
              capturedEnvelope = result;
              // First resolution: stash as the fallback, but do NOT stop the loop —
              // give the model a chance to act on it (e.g. escalate to a second
              // tasklist) before an explicit currentTask.resolve() or a re-emission
              // makes the result terminal.
              capturedResult = result;
              capturedEnvelope = result;
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
            initialContext: delegateContext,
            onContextSnapshot: (c: string) => { delegateContext = c; },
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

    // `capturedResult` holds the best available result: an explicit `currentTask.resolve()`
    // value (authoritative, via currentTaskResolve above), or — if the model never resolved
    // explicitly — the terminal/fallback tasklist result captured by onTasklistResult. When
    // NOTHING was ever captured this is `undefined`, identical to the old `resultCaptured ?
    // capturedResult : undefined` ternary; the difference only matters when the model
    // exhausts the resolve-nudge retries above WITHOUT resolving but DID leave a first-pass
    // fallback in `capturedResult` — return that instead of discarding it.
    return reconcileOk(capturedResult, capturedEnvelope);
  } finally {
    vm.dispose();
  }
}
