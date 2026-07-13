import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { SessionOpts, SessionDeps } from './types.js';
import type { YieldRequest } from '../eval/yield.js';
import type { VM } from '../sandbox/quickjs.js';
import { MessageHistory } from '../context/history.js';
import type { MediaPart } from '../eval/stream-types.js';
import { summarizeHistory } from '../context/summarize.js';
import { buildSystemBlock, resolvePreloadedKnowledge } from '../context/system-block.js';
import { loadSpace } from '../spaces/load.js';
import type { Space } from '../spaces/load.js';
import {
  loadSystemSpaces,
  mergeSystemInto,
  defaultSystemSpaceDirs,
  systemFunctionSources,
  systemFunctionsBundled,
} from '../spaces/system.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { Budget } from '../eval/budget.js';
import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { getAgentFunctions, getAgentFunctionsBundled, resolveDirectDeps } from '../spaces/agent.js';
import { scopeProjectFunctions } from '../spaces/project-functions-load.js';
import { getAgentComponents } from '../spaces/components.js';
import { loadSnapshot } from './snapshot.js';
import { Tracer } from '../sandbox/trace.js';
import type { TraceScope } from '../sandbox/trace.js';
import { sessionCapabilities } from '../exec/capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';
import { createChildVM, buildAmbientDts } from '../exec/bootstrap.js';
import { forkEngineOptsFrom } from '../exec/fork-config.js';
import {
  evaluateDelegatePolicy,
  isDelegateAllowed,
  formatDelegateDenial,
  type DelegatePolicy,
} from '../exec/target-match.js';

/** One image/file attachment on a user turn. Audio is transcribed to text
 *  upstream, so it never appears here. An IMAGE carries a model-facing `part`
 *  (sent to a vision model). A FILE carries neither `part` nor `text` — the
 *  delegated files agent fetches its content itself via `readDocument(id)`, so
 *  the session hands it only an id-anchored note (keyed by `id`). */
export interface UserAttachment {
  id: string;
  kind: 'image' | 'file';
  mediaType: string;
  filename?: string;
  /** Image part (sent to a vision model). Absent for files. */
  part?: MediaPart;
  /** Legacy: decoded text of a text file. No longer populated — files are read
   *  on demand via `readDocument(id)`. Retained for backward-compatible shape. */
  text?: string;
}

/** A user turn's input: plain text, or text plus image/file attachments. A text
 *  orchestrator (THING) can't read the parts directly — it delegates them to a
 *  vision/file agent by their id (see the attachment note added to its message). */
export type UserInput = string | { text: string; attachments?: UserAttachment[] };

/** Normalize a user turn to its text + attachments. */
function normalizeInput(message: UserInput): { text: string; attachments?: UserAttachment[] } {
  return typeof message === 'string' ? { text: message } : message;
}

/** A short text note listing the turn's image/file attachments (by id), appended
 *  to a text agent's message so it knows what's attached and can delegate each to
 *  the right specialist. The bytes are NOT in the text — only ids + metadata. */
function attachmentNote(attachments: UserAttachment[]): string {
  if (!attachments.length) return '';
  const lines = attachments
    .map((a) => `  - ${a.kind}: ${a.filename ?? a.mediaType} — attachmentId "${a.id}"`)
    .join('\n');
  return (
    `\n\n[The user attached the following. You cannot read them yourself — delegate each ` +
    `by its id: an image to \`system-vision/vision\`, a file to \`system-files/dispatch\`, ` +
    `passing \`{ query, attachmentIds: ["<id>"] }\`.\n${lines}]`
  );
}

/** Extract the plain-text portion of a user turn (drops framing/attachments) —
 *  used for the defaultAction fast-path `query`. */
function userInputText(message: UserInput): string {
  return normalizeInput(message).text;
}

export class Session {
  private opts: SessionOpts;
  private deps: SessionDeps;
  private vm: VM | null = null;
  private history: MessageHistory;
  private space: Space | null = null;
  private sessionId: string;
  private tracer: Tracer;
  /** Image/file attachments on the CURRENT user turn, keyed by upload id. A text
   *  agent (THING) can't read them, so it delegates by id — runDelegate resolves
   *  the id here to the MediaPart and hands it to the vision/file agent. Cleared
   *  and repopulated on each start/continue/resume (only the latest turn's
   *  attachments are addressable). */
  private pendingAttachments = new Map<string, UserAttachment>();
  private systemBlock: string | null = null;
  private ambientDts: string | null = null;
  private agentFunctions: Record<string, string> = {};
  private agentFunctionsBundled: Record<string, string> = {};
  private systemSpaces: Space[] = [];
  /**
   * Spaces loaded at runtime via registerSpace(). Shared mutable reference so
   * that a registerSpace() call (even inside a fork) is visible to subsequent
   * delegate() calls in the same session.
   */
  private dynamicSpaces: Map<string, Space> = new Map();
  /**
   * The session agent's evaluated `canDelegateTo` policy (unified semantics).
   * Drives BOTH the capability profile (whether `delegate` is injected + in the
   * ambient DTS) and the yield-time gate in buildYieldContext. Set by
   * start()/resume(); the default (unrestricted) matches the pre-start state.
   */
  private delegatePolicy: DelegatePolicy = { mode: 'unrestricted', entries: [], allowRegistered: false };
  /** The running agent's parsed app-capability grants (from `capabilities:` frontmatter).
   *  Set wherever the agent is resolved (start/continue/resume); consumed by the VM
   *  bootstrap + fork engine so the session, its forks, and its delegates all run with
   *  the agent's app grants (project-rooted). `{}` for an agent that declares none. */
  private appCapabilities: AppCapabilities = {};
  /** Root scope for the entire session (nodeId === sessionId). */
  private rootScope: TraceScope | null = null;
  /** Scope of the currently-running turn (run node). Reset per start/continue/resume. */
  private currentScope: TraceScope | null = null;
  /** Counter for run nodes (start/continue/resume calls). */
  private runCount = 0;
  /**
   * One ForkEngine per session, lazily built and reused across fork/tasklist
   * yields so the maxConcurrentForks semaphore is enforced across ALL top-level
   * fork() yields — not just within a single Promise.all batch. Reset on
   * start()/resume() when agent functions change.
   */
  private forkEngine: import('../fork/fork.js').ForkEngine | null = null;
  /**
   * Host-enforced budget for the current turn-loop run. Reset per
   * start()/continue() so each task gets a fresh ceiling. The `progress` global
   * reads this live (the closure dereferences the field, so resetting works).
   */
  private budget: Budget = new Budget();
  /**
   * Accumulated statement context (typecheck scope) carried ACROSS turns. The VM
   * keeps every variable a turn binds, but each runTurnLoop starts with an empty
   * typecheck scope — so without this, a continue()/resume() turn that references
   * a variable bound in an earlier turn fails tsc with "Cannot find name". Seeded
   * into runTurnLoop as initialContext and updated via onContextSnapshot. Reset to
   * '' by start() (a fresh program); preserved by continue()/resume().
   */
  private turnContext = '';

  constructor(opts: SessionOpts, deps: SessionDeps) {
    this.opts = opts;
    this.deps = deps;
    this.history = new MessageHistory();
    this.sessionId = randomUUID();
    this.tracer = new Tracer(opts.traceFile ?? null);
  }

  /** Expose the tracer so the CLI can subscribe the TraceHub to it. */
  getTracer(): Tracer { return this.tracer; }

  /** The root execution-node id for this session (the `session_start` nodeId).
   *  Used by hosts to attribute node-less events (e.g. an injected user_message)
   *  to the session root instead of falling back to a phantom node. */
  getRootNodeId(): string { return this.sessionId; }

  /** The full message history (for persisting a resumable session snapshot). */
  getHistory(): import('../context/history.js').Message[] { return this.history.messages; }

  /** Ingest a user turn: reset + record this turn's image/file attachments into
   *  `pendingAttachments` (for id-based delegation) and return the text to append
   *  to history — the user's text, optionally framed, plus a note listing the
   *  attachments by id. The raw bytes are NOT put on the text agent's message. */
  private ingestUserTurn(message: UserInput, opts?: { frame?: boolean }): string {
    const { text, attachments } = normalizeInput(message);
    this.pendingAttachments.clear();
    const atts = attachments ?? [];
    for (const a of atts) this.pendingAttachments.set(a.id, a);
    const framed = opts?.frame === false ? text : `User request:\n\n${text}`;
    return framed + attachmentNote(atts);
  }

  async continue(message: UserInput): Promise<void> {
    if (!this.vm || !this.systemBlock || !this.ambientDts) {
      throw new Error('Session not started — call start() first');
    }
    // Neutral framing: the TS-statement reply channel is fully specified by
    // STATEMENT_PROTOCOL in the system block. Framing the user's message itself as
    // "write TypeScript code" primed the triage toward the code path for EVERY
    // request (live E3 regression: a deep-research ask routed to the engineer).
    this.history.append({
      role: 'user',
      content: this.ingestUserTurn(message),
      blockType: 'normal',
    });
    // Context economy: collapse old turns into a summary once history grows large,
    // keeping the most recent messages (incl. this task) verbatim.
    await this.maybeSummarizeHistory();
    this.budget = new Budget(this.opts.budget ?? {});
    const runScope = this.mintRunScope();
    try {
      await runTurnLoop({
        vm: this.vm,
        history: this.history,
        systemBlock: this.systemBlock,
        ambientDts: this.ambientDts,
        renderHost: this.opts.renderHost,
        streamFn: this.deps.streamFn,
        processYield: (req) => this.handleYield(req),
        maxRetries: this.opts.maxRetries,
        tracer: this.tracer,
        traceContext: 'session',
        scope: runScope,
        budget: this.budget,
        initialContext: this.turnContext,
        onContextSnapshot: (c) => { this.turnContext = c; },
        model: this.opts.modelAlias,
        beforeTurn: () => this.readTodoReminder(),
        streamIdleMs: this.opts.streamIdleMs,
      });
      this.tracer.end(runScope, 'done');
    } catch (err) {
      this.tracer.end(runScope, 'error', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async start(initialMessage: UserInput): Promise<void> {
    // 1. Load space + merge always-on system spaces
    this.space = await this.loadMergedSpace(this.opts.spaceDir);

    // 1b. Preload any project spaces into dynamicSpaces so they are delegatable immediately.
    // Failures are isolated — one bad dir must not abort startup.
    for (const dir of this.opts.preloadSpaceDirs ?? []) {
      try {
        const preloadedSpace = await loadSpace(dir);
        this.dynamicSpaces.set(dir, preloadedSpace);
      } catch (err) {
        this.opts.renderHost.log(`[warn] preloadSpaceDirs: failed to load space at "${dir}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Get agent — fall back to first agent when slug is 'default'
    const agentKeys = Object.keys(this.space.agents);
    const resolvedSlug = this.opts.agentSlug === 'default' && !this.space.agents['default']
      ? agentKeys[0]
      : this.opts.agentSlug;
    if (!resolvedSlug) {
      throw new Error(`No agents found in space at "${this.opts.spaceDir}"`);
    }
    const agent = this.space.agents[resolvedSlug];
    if (!agent) {
      throw new Error(`Agent "${this.opts.agentSlug}" not found in space at "${this.opts.spaceDir}"`);
    }

    // 3. Resolve direct dependencies + the unified canDelegateTo policy (gates
    // whether `delegate` is injected/declared AND which targets a yield may hit).
    this.delegatePolicy = evaluateDelegatePolicy(agent.canDelegateTo, 'agent');
    const directDeps = resolveDirectDeps(this.space, agent.canDelegateTo);

    // 4. Build system block (system functions rendered as a concise Built-in Tools list)
    const systemFns = systemFunctionSources(this.systemSpaces);
    const knowledgePreloads = await resolvePreloadedKnowledge(this.space, agent);
    const systemBlock = buildSystemBlock({ space: this.space, agent, directDeps, systemFunctions: systemFns, knowledgePreloads, omitDelegate: this.delegatePolicy.mode === 'none' }) + this.projectAgentsBlock();

    // 4b. Build ambient DTS overlay — system functions are always in scope, then agent functions
    const { functions: agentFunctions, functionsBundled: agentFunctionsBundled } =
      this.buildInjectedFunctions(this.space, agent);
    const agentComponents = getAgentComponents(this.space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents, (name, message) => {
      this.opts.renderHost.log(`[warn] ${name}: ${message}`);
    });
    this.appCapabilities = agent.capabilities ?? {};
    const ambientDts = buildAmbientDts({ capabilities: sessionCapabilities(this.delegatePolicy.mode !== 'none', this.appCapabilities), overlay, appDts: this.opts.appDts, projectRoot: !!this.opts.projectRoot });
    this.systemBlock = systemBlock;
    this.ambientDts = ambientDts;
    this.agentFunctions = agentFunctions;
    this.agentFunctionsBundled = agentFunctionsBundled;
    this.forkEngine = null; // agent functions changed — rebuild on next fork yield

    // 5. Create the VM via the shared bootstrap (functions, host tools, all
    // yielding globals incl. ask, JSX runtime with this agent's components).
    this.vm = await this.createSessionVM(agentFunctions, agentFunctionsBundled, [
      ...Object.keys(agentComponents.view),
      ...Object.keys(agentComponents.form),
    ]);

    // 6. Append initial user message to history (neutral framing — see continue()'s
    // comment: the TS reply channel belongs to STATEMENT_PROTOCOL, not the request).
    this.history.append({
      role: 'user',
      content: this.ingestUserTurn(initialMessage),
      blockType: 'normal',
    });

    this.rootScope = this.tracer.root(this.sessionId);
    this.tracer.write({ ts: Date.now(), type: 'session_start', sessionId: this.sessionId, spaceDir: this.opts.spaceDir, agentSlug: resolvedSlug!, nodeId: this.sessionId });

    // 7. Run turn loop until done or error
    this.budget = new Budget(this.opts.budget ?? {});
    this.turnContext = ''; // fresh program — start() resets cross-turn typecheck scope
    const runScope = this.mintRunScope();

    // Structural routing for less-capable models: if the agent declares a
    // `defaultAction` with a tasklist, run it via the reliable delegate path
    // (which auto-captures the tasklist result) instead of the model-driven turn
    // loop. The weak model only handles small, salvage-backed sub-tasks inside the
    // tasklist DAG; the multi-step orchestration is deterministic and can't be
    // truncated. If the action builds a NEW space (returns {spaceKey,agentSlug,…}),
    // chain a second delegate to it so the final answer — not just coordinates — shows.
    const defAction = (!this.opts.noDefaultAction && agent.defaultAction)
      ? agent.actions.find((a) => a.id === agent.defaultAction && a.tasklist)
      : undefined;
    if (defAction) {
      this.currentScope = runScope;
      // HOST-DRIVEN fast path — exempt from the model-facing canDelegateTo gate
      // (enforceDelegatePolicy defaults to false): both delegates below are host
      // policy, not model output. That includes the CHAINED delegate to the
      // {spaceKey, agentSlug} coordinates a build returns (effectively a
      // `registered:*` grant), so THING/architect flows keep working even when
      // the agent's own allowlist wouldn't name the freshly built space.
      const ctx = this.buildYieldContext(this.space);
      const initialQuery = userInputText(initialMessage);
      try {
        const built = await ctx.runDelegate(this.opts.spaceDir, resolvedSlug!, defAction.id, { query: initialQuery, context: {} });
        let finalResult: unknown = built;
        // A tasklist-backed delegate result is a TaskEnvelope ({ ok, degraded, data, … })
        // since Phase 3 — the execution coordinates live in `envelope.data`. Unwrap it
        // before the structural check (a raw shape from an explicit currentTask.resolve
        // still works via the fallback).
        const env = built as { ok?: unknown; degraded?: unknown; data?: unknown } | null;
        const payload = env && typeof env === 'object' && typeof env.ok === 'boolean' && typeof env.degraded === 'boolean' && 'data' in env
          ? env.data
          : built;
        const b = payload as { spaceKey?: unknown; agentSlug?: unknown; actionId?: unknown; query?: unknown } | null;
        if (b && typeof b === 'object' && typeof b.spaceKey === 'string' && typeof b.agentSlug === 'string') {
          finalResult = await ctx.runDelegate(b.spaceKey, b.agentSlug, typeof b.actionId === 'string' ? b.actionId : 'run', { query: typeof b.query === 'string' ? b.query : initialQuery, context: {} });
        }
        this.opts.renderHost.display(typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult, null, 2));
        this.tracer.end(runScope, 'done');
      } catch (err) {
        this.tracer.end(runScope, 'error', { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      return;
    }

    try {
      await runTurnLoop({
        vm: this.vm,
        history: this.history,
        systemBlock,
        ambientDts,
        renderHost: this.opts.renderHost,
        streamFn: this.deps.streamFn,
        processYield: (req) => this.handleYield(req),
        maxRetries: this.opts.maxRetries,
        tracer: this.tracer,
        traceContext: 'session',
        scope: runScope,
        budget: this.budget,
        initialContext: this.turnContext,
        onContextSnapshot: (c) => { this.turnContext = c; },
        model: this.opts.modelAlias,
        beforeTurn: () => this.readTodoReminder(),
        streamIdleMs: this.opts.streamIdleMs,
      });
      this.tracer.end(runScope, 'done');
    } catch (err) {
      this.tracer.end(runScope, 'error', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /**
   * Build the system prompt (the exact `system` message sent to the model) for
   * the resolved agent WITHOUT creating a VM, hitting the model, or running the
   * turn loop — so it works keyless. Mirrors the system-block construction in
   * start(): merges system spaces, resolves the agent, and renders the block.
   * Also returns the ambient DTS overlay (the typecheck context the model's code
   * is validated against). Used by the CLI's --dump-system-prompt flag.
   */
  async buildSystemPrompt(): Promise<{ agentSlug: string; systemBlock: string; ambientDts: string }> {
    const space = await this.loadMergedSpace(this.opts.spaceDir);
    const agentKeys = Object.keys(space.agents);
    const resolvedSlug = this.opts.agentSlug === 'default' && !space.agents['default']
      ? agentKeys[0]
      : this.opts.agentSlug;
    if (!resolvedSlug) {
      throw new Error(`No agents found in space at "${this.opts.spaceDir}"`);
    }
    const agent = space.agents[resolvedSlug];
    if (!agent) {
      throw new Error(`Agent "${this.opts.agentSlug}" not found in space at "${this.opts.spaceDir}"`);
    }
    const delegatePolicy = evaluateDelegatePolicy(agent.canDelegateTo, 'agent');
    const directDeps = resolveDirectDeps(space, agent.canDelegateTo);
    const systemFns = systemFunctionSources(this.systemSpaces);
    const knowledgePreloads = await resolvePreloadedKnowledge(space, agent);
    const systemBlock = buildSystemBlock({ space, agent, directDeps, systemFunctions: systemFns, knowledgePreloads, omitDelegate: delegatePolicy.mode === 'none' });
    const { functions: agentFunctions } = this.buildInjectedFunctions(space, agent);
    const agentComponents = getAgentComponents(space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents, (name, message) => {
      this.opts.renderHost.log(`[warn] ${name}: ${message}`);
    });
    this.appCapabilities = agent.capabilities ?? {};
    const ambientDts = buildAmbientDts({ capabilities: sessionCapabilities(delegatePolicy.mode !== 'none', this.appCapabilities), overlay, appDts: this.opts.appDts, projectRoot: !!this.opts.projectRoot });
    return { agentSlug: resolvedSlug, systemBlock, ambientDts };
  }

  async resume(snapshotDir: string, message: UserInput): Promise<void> {
    const snapshot = await loadSnapshot(snapshotDir);
    if (!snapshot) {
      throw new Error(`No snapshot found in "${snapshotDir}"`);
    }

    // Load space + merge always-on system spaces
    this.space = await this.loadMergedSpace(snapshot.spaceDir);
    this.sessionId = snapshot.sessionId;

    // Preload project spaces (mirrors start()'s step 1b) so agents built in
    // earlier sessions stay delegatable and advertised after a resume.
    for (const dir of this.opts.preloadSpaceDirs ?? []) {
      try {
        const preloadedSpace = await loadSpace(dir);
        this.dynamicSpaces.set(dir, preloadedSpace);
      } catch (err) {
        this.opts.renderHost.log(`[warn] preloadSpaceDirs: failed to load space at "${dir}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Get agent
    const agent = this.space.agents[snapshot.agentSlug];
    if (!agent) {
      throw new Error(`Agent "${snapshot.agentSlug}" not found`);
    }

    // Restore history
    this.history = new MessageHistory();
    for (const msg of snapshot.history) {
      this.history.append(msg);
    }

    // Append new user message. resume() historically appends the raw message
    // (no "User request:" framing, unlike start()/continue()); preserve that,
    // while recording this turn's attachments for id-based delegation.
    {
      this.history.append({
        role: 'user',
        content: this.ingestUserTurn(message, { frame: false }),
        blockType: 'normal',
      });
    }

    // Resolve direct deps + canDelegateTo policy and build system block
    this.delegatePolicy = evaluateDelegatePolicy(agent.canDelegateTo, 'agent');
    const directDeps = resolveDirectDeps(this.space, agent.canDelegateTo);
    const systemFns = systemFunctionSources(this.systemSpaces);
    const knowledgePreloads = await resolvePreloadedKnowledge(this.space, agent);
    const systemBlock = buildSystemBlock({ space: this.space, agent, directDeps, systemFunctions: systemFns, knowledgePreloads, omitDelegate: this.delegatePolicy.mode === 'none' }) + this.projectAgentsBlock();
    const { functions: agentFunctions, functionsBundled: agentFunctionsBundled } =
      this.buildInjectedFunctions(this.space, agent);
    const agentComponents = getAgentComponents(this.space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents, (name, message2) => {
      this.opts.renderHost.log(`[warn] ${name}: ${message2}`);
    });
    this.appCapabilities = agent.capabilities ?? {};
    const ambientDts = buildAmbientDts({ capabilities: sessionCapabilities(this.delegatePolicy.mode !== 'none', this.appCapabilities), overlay, appDts: this.opts.appDts, projectRoot: !!this.opts.projectRoot });
    this.agentFunctions = agentFunctions;
    this.agentFunctionsBundled = agentFunctionsBundled;
    this.forkEngine = null; // agent functions changed — rebuild on next fork yield

    // Create the VM via the shared bootstrap, restoring the persisted scope as
    // seed variables (bound before functions/globals, as before).
    this.vm = await this.createSessionVM(
      agentFunctions,
      agentFunctionsBundled,
      [...Object.keys(agentComponents.view), ...Object.keys(agentComponents.form)],
      snapshot.scope,
    );

    this.rootScope = this.tracer.root(this.sessionId);
    this.budget = new Budget(this.opts.budget ?? {});
    const runScope = this.mintRunScope();
    try {
      await runTurnLoop({
        vm: this.vm,
        history: this.history,
        systemBlock,
        ambientDts,
        renderHost: this.opts.renderHost,
        streamFn: this.deps.streamFn,
        processYield: (req) => this.handleYield(req),
        maxRetries: this.opts.maxRetries,
        tracer: this.tracer,
        traceContext: 'session',
        scope: runScope,
        budget: this.budget,
        initialContext: this.turnContext,
        onContextSnapshot: (c) => { this.turnContext = c; },
        model: this.opts.modelAlias,
        beforeTurn: () => this.readTodoReminder(),
        streamIdleMs: this.opts.streamIdleMs,
      });
      this.tracer.end(runScope, 'done');
    } catch (err) {
      this.tracer.end(runScope, 'error', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  dispose(): void {
    if (this.vm) {
      this.vm.dispose();
      this.vm = null;
    }
  }

  /**
   * Collapse old history into a summary when it exceeds maxHistoryTurns*2 messages,
   * keeping the last 6 verbatim. Deterministic digest (no extra LLM call) — preserves
   * the original task plus resolved variables and errors.
   */
  private async maybeSummarizeHistory(): Promise<void> {
    const maxTurns = this.opts.maxHistoryTurns;
    if (!maxTurns || this.history.messages.length <= maxTurns * 2) return;
    const summary = await summarizeHistory({ messages: this.history.messages, keepLast: 6 });
    if (summary) {
      this.history.summarize(summary, 6);
      this.opts.renderHost.log(`[context] history summarized → ${this.history.messages.length} messages`);
    }
  }

  /**
   * Render the preloaded/runtime-registered project agents as a system-block
   * section so the model KNOWS they exist. Without this, an agent built in an
   * earlier session was invisible to the next one (live E7 failure: THING
   * grepped the project for its own reading-list agent and gave up) — the
   * spaces were delegatable via `registered:*`, but nothing advertised them.
   */
  private projectAgentsBlock(): string {
    if (this.dynamicSpaces.size === 0) return '';
    const lines: string[] = [];
    for (const [dir, space] of this.dynamicSpaces) {
      for (const [slug, agent] of Object.entries(space.agents)) {
        const actions = (agent.actions ?? []).map((a) => a.id);
        const actionArg = actions.length > 0 ? `, ${JSON.stringify(actions[0])}` : '';
        lines.push(
          `- **${agent.title || slug}** — \`await delegate(${JSON.stringify(dir)}, ${JSON.stringify(slug)}${actionArg}, { query: '<request>' })\`` +
          (actions.length > 0 ? ` (actions: ${actions.join(', ')})` : ''),
        );
      }
    }
    if (lines.length === 0) return '';
    return [
      '',
      '',
      '# Project agents (already built & registered)',
      '',
      'These specialist agents ALREADY EXIST in this project. When a request matches one,',
      'delegate to it directly — do NOT rebuild it and do NOT search the filesystem for it:',
      ...lines,
    ].join('\n');
  }

  /**
   * Load the user space and merge the always-on system spaces (fs, web, memory,
   * todo, agents) into it. The user space wins on name collisions. Stores the
   * loaded system spaces on the instance for function/overlay derivation.
   */
  private async loadMergedSpace(spaceDir: string): Promise<Space> {
    // requireAgents: false — a project dir has no agents/ of its own; the `thing`
    // agent is supplied by the merged system spaces (mergeSystemInto below).
    const userSpace = await loadSpace(spaceDir, { requireAgents: false });
    const dirs = this.opts.systemSpaceDirs ?? defaultSystemSpaceDirs();
    this.systemSpaces = await loadSystemSpaces(dirs);
    return mergeSystemInto(userSpace, this.systemSpaces);
  }

  /**
   * Build the function maps injected into the VM (and, via the same map, the DTS
   * overlay + forks): system functions are always present (universal capability),
   * PROJECT functions overlay them, then agent-declared SPACE functions overlay
   * both. Because a SPACE function of the same name WINS over a project function
   * (see scopeProjectFunctions — colliding project fns are dropped + warned), the
   * merged set stays name-disjoint, so the overlay never double-declares.
   * Project functions are present only for project-rooted sessions (the caller
   * populates `projectFunctions` from `<projectRoot>/functions/`); a legacy
   * session's map is byte-identical to before.
   */
  private buildInjectedFunctions(space: Space, agent: import('../spaces/load.js').AgentDef): {
    functions: Record<string, string>;
    functionsBundled: Record<string, string>;
  } {
    const systemFns = systemFunctionSources(this.systemSpaces);
    const systemBundled = systemFunctionsBundled(this.systemSpaces);
    const spaceFns = getAgentFunctions(space, agent);
    const spaceBundled = getAgentFunctionsBundled(space, agent);

    // Third scope: project functions, minus any name already taken by the system
    // toolkit or the agent's selected space functions (space/system wins).
    const scoped = this.opts.projectFunctions
      ? scopeProjectFunctions(
          {
            functions: this.opts.projectFunctions,
            functionsBundled: this.opts.projectFunctionsBundled ?? {},
          },
          new Set([...Object.keys(systemFns), ...Object.keys(spaceFns)]),
          (name) =>
            this.opts.renderHost.log(
              `[warn] project function "${name}" is shadowed by a space/system function of the same name — the project version is ignored`,
            ),
        )
      : { functions: {}, functionsBundled: {} };

    return {
      functions: { ...systemFns, ...scoped.functions, ...spaceFns },
      functionsBundled: { ...systemBundled, ...scoped.functionsBundled, ...spaceBundled },
    };
  }

  /**
   * Create the top-level session VM via the shared exec bootstrap: full
   * capability profile (interactive ask, fork/tasklist/delegate/registerSpace),
   * host tools with a live budget-backed progress(), the merged function set,
   * and the JSX runtime with the agent's component stubs.
   */
  private async createSessionVM(
    functions: Record<string, string>,
    functionsBundled: Record<string, string>,
    componentNames: string[],
    seedVars?: Record<string, unknown>,
  ): Promise<VM> {
    return createChildVM({
      // `delegate` follows the agent's canDelegateTo policy (mode 'none' ⇒ the
      // global is withheld here AND absent from the ambient DTS built above).
      capabilities: sessionCapabilities(this.delegatePolicy.mode !== 'none', this.appCapabilities),
      renderHost: this.opts.renderHost,
      clock: this.opts.clock,
      spaceDir: this.opts.spaceDir,
      projectSpacesDir: this.opts.projectSpacesDir,
      projectRoot: this.opts.projectRoot,
      projectId: this.opts.projectId,
      appGlobals: this.opts.appGlobals,
      // `progress` reads the live per-run budget (the closure dereferences the
      // field, so resetting this.budget per task is reflected).
      progress: () => this.budget.snapshot(),
      functions,
      functionsBundled,
      componentNames,
      onDisplay: (value) => {
        const scope = this.currentScope;
        this.tracer.write({ ts: Date.now(), type: 'display', context: scope?.label ?? 'session', ...(scope ? { nodeId: scope.nodeId } : {}), descriptor: value });
      },
      seedVars,
      onFunctionError: (name, error) => {
        this.opts.renderHost.log(`[warn] failed to inject function "${name}": ${error}`);
      },
    });
  }

  /**
   * Run a delegate requested by a TASK FORK (gated by that task's `canDelegateTo`). Mirrors the
   * runtime-context `runDelegate` but sources the space from `this.space` and forwards the task's
   * `allowedActions`, one recursion level deep (bounded by runDelegate's maxDepth).
   */
  private async runDelegateForFork(
    packageName: string,
    agentName: string,
    action: string | undefined,
    delegateOpts: unknown,
    allowedActions: string[] | undefined,
  ): Promise<unknown> {
    const space = this.space;
    if (!space) throw new Error('delegate from a task requires a loaded space');
    const { runDelegate } = await import('../delegate/delegate.js');
    const { DelegateRegistry } = await import('../delegate/registry.js');
    const spaceMap = new Map<string, Space>([[this.opts.spaceDir, space]]);
    for (const [pkgName, depSpace] of Object.entries(space.dependentSpaces)) {
      spaceMap.set(pkgName, depSpace);
      spaceMap.set(depSpace.dir, depSpace);
    }
    for (const sysSpace of this.systemSpaces) {
      spaceMap.set(sysSpace.dir, sysSpace);
      if (sysSpace.packageName) spaceMap.set(sysSpace.packageName, sysSpace);
    }
    for (const [key, dynSpace] of this.dynamicSpaces) spaceMap.set(key, dynSpace);
    return runDelegate({
      packageName,
      agentName,
      action,
      allowedActions,
      delegateOpts: delegateOpts as import('../globals/delegate.js').DelegateOpts | undefined,
      registry: new DelegateRegistry(spaceMap),
      renderHost: this.opts.renderHost,
      streamFn: this.deps.streamFn,
      depth: 1,
      maxDepth: 5,
      maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
      clock: this.opts.clock,
      tracer: this.tracer,
      scope: this.currentScope ?? undefined,
      systemSpaces: this.systemSpaces,
      projectSpacesDir: this.opts.projectSpacesDir,
      projectRoot: this.opts.projectRoot,
      projectId: this.opts.projectId,
      appGlobals: this.opts.appGlobals,
      model: this.opts.modelAlias,
      // Inherit the session's fork wiring down the delegation chain (A1 fix):
      // budget caps + role models for the delegate's leaf forks, and the SHARED
      // dynamicSpaces map so registerSpace() under the delegate propagates back.
      budgetLimits: this.opts.budget,
      roleModels: this.opts.roleModels,
      dynamicSpaces: this.dynamicSpaces,
    });
  }

  /**
   * Lazily construct and cache the session's ForkEngine. Shared across fork and
   * tasklist yields so concurrency is bounded globally rather than per-yield.
   * Built via forkEngineOptsFrom — the exhaustively-typed options builder shared
   * with the delegate wiring site — so the two option lists cannot drift (A1).
   */
  private async getForkEngine(): Promise<import('../fork/fork.js').ForkEngine> {
    if (this.forkEngine) return this.forkEngine;
    const { ForkEngine } = await import('../fork/fork.js');
    // Resolve the running agent's charter (fork-safe identity) to inject into every fork.
    const agents = this.space?.agents ?? {};
    const fkSlug = this.opts.agentSlug === 'default' && !agents['default']
      ? (Object.keys(agents)[0] ?? this.opts.agentSlug)
      : this.opts.agentSlug;
    this.forkEngine = new ForkEngine(forkEngineOptsFrom({
      maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
      parentHistory: this.history.messages,
      parentSpaceDir: this.opts.spaceDir,
      parentAgentSlug: this.opts.agentSlug,
      parentAgentCharter: agents[fkSlug]?.charterBody,
      renderHost: this.opts.renderHost,
      streamFn: this.deps.streamFn,
      clock: this.opts.clock,
      tracer: this.tracer,
      agentFunctions: this.agentFunctions,
      agentFunctionsBundled: this.agentFunctionsBundled,
      budgetLimits: this.opts.budget,
      // Session forks are top-level: ForkEngine defaults their depth to 1.
      forkDepth: undefined,
      roleModels: this.opts.roleModels,
      defaultModel: this.opts.modelAlias,
      // Same Map reference the delegate path reads — a fork's registerSpace() lands here.
      dynamicSpaces: this.dynamicSpaces,
      projectSpacesDir: this.opts.projectSpacesDir,
      projectRoot: this.opts.projectRoot,
      projectId: this.opts.projectId,
      // The session agent's app grants flow to its forks (role-intersected in forkCapabilities).
      parentAppCapabilities: this.appCapabilities,
      appGlobals: this.opts.appGlobals,
      // A task in a tasklist may delegate (gated by its own canDelegateTo) — route through the
      // session's registry with the recursion bound enforced by runDelegate.
      delegateRunner: (p, a, act, o, allowed) => this.runDelegateForFork(p, a, act, o, allowed),
      // Forks may read attachments too — thread the same host resolver.
      documentResolver: this.opts.documentResolver,
    }));
    return this.forkEngine;
  }

  /**
   * Soft per-turn reminder of OPEN todos (status pending/in_progress) from the
   * model-maintained `.lmthing/todos.json` (written by the todoWrite system function).
   * Re-surfaced every turn so the agent never loses track — but never blocks termination
   * (soft). Top-level session only; forks/delegates do not get this. Returns undefined
   * when there is no list or nothing open.
   */
  private readTodoReminder(): string | undefined {
    try {
      const raw = readFileSync(this.opts.spaceDir + '/.lmthing/todos.json', 'utf8');
      const items = JSON.parse(raw) as Array<{ content?: unknown; status?: unknown }>;
      const open = (Array.isArray(items) ? items : []).filter(
        (i) => i && typeof i.content === 'string' && i.status !== 'completed',
      );
      if (open.length === 0) return undefined;
      const lines = open.map((i) => `- [${i.status === 'in_progress' ? '~' : ' '}] ${String(i.content)}`);
      return [
        '## Open todos (you added these — keep working through them; mark each done with todoWrite when complete)',
        ...lines,
      ].join('\n');
    } catch {
      return undefined; // no file / unreadable / bad JSON → nothing to remind
    }
  }

  private async handleYield(req: YieldRequest): Promise<unknown> {
    switch (req.kind) {
      case 'ask': {
        // args: [id, descriptor] — call renderHost.ask and await user input
        const [askId, descriptor] = req.args;
        return this.opts.renderHost.ask(askId as string, descriptor);
      }
      case 'inspect': {
        // inspect args already processed in globals/inspect.ts; value is in args[0]
        return req.args[0];
      }
      case 'loadKnowledge': {
        // args[0] is the normalized relative path; load and return the parsed file
        // CONTENT here so it is the value bound into scope. (Returning args[0] would
        // bind the path string — the fork path correctly loads content the same way.)
        const { loadKnowledgeFile } = await import('../globals/load-knowledge.js');
        const { join } = await import('node:path');
        const rel = req.args[0] as string;
        const filePath = join(this.opts.spaceDir, 'knowledge', ...rel.split('/'));
        return loadKnowledgeFile(filePath);
      }
      case 'registerSpace': {
        const dir = req.args[0] as string;
        try {
          const space = await loadSpace(dir);
          this.dynamicSpaces.set(dir, space);
          const firstAgentSlug = Object.keys(space.agents)[0] ?? '';
          return { ok: true, spaceKey: dir, agentSlug: firstAgentSlug };
        } catch (err: any) {
          return { ok: false, spaceKey: '', agentSlug: '', error: String(err?.message ?? err) };
        }
      }
      case 'setSessionMeta': {
        // The agent names the session. Core stays persistence-free: we just emit a
        // session_meta trace event that the server's wireTracer ingests to update +
        // persist the SessionEntry (mirrors how totalCostUsd rides llm_response events).
        const meta = (req.args[0] ?? {}) as { title?: unknown; slug?: unknown };
        const title = typeof meta.title === 'string' ? meta.title.trim().slice(0, 120) : undefined;
        // slugify: lowercase, non-alphanumerics → '-', collapse/trim dashes, cap length.
        const rawSlug = typeof meta.slug === 'string'
          ? meta.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
          : undefined;
        const slug = rawSlug || undefined;
        if (title || slug) {
          this.tracer.write({ ts: Date.now(), type: 'session_meta', nodeId: this.sessionId, title, slug });
        }
        return { ok: Boolean(title || slug) };
      }
      default: {
        // sleep / fork / tasklist / delegate are resolved by the shared router.
        // Model-initiated yields ARE subject to the agent's canDelegateTo gate.
        if (!this.space) throw new Error('Space not loaded');
        const routed = await routeCommonYield(req, this.buildYieldContext(this.space, { enforceDelegatePolicy: true }));
        return routed.handled ? routed.value : undefined;
      }
    }
  }

  /**
   * Build the shared-yield-router context for the session VM. The session has no
   * tasklist auto-capture (that's delegate-only), and resolves delegate() by
   * constructing a fresh registry from its own + dependent + dynamic spaces.
   */
  private mintRunScope(): TraceScope {
    this.runCount++;
    // Label stays 'session' so the `context` field on all turn-loop trace events
    // remains backward-compatible (existing jq recipes + tests filter by it). The
    // unique nodeId distinguishes runs in the execution tree.
    const scope = this.tracer.child(this.rootScope ?? undefined, 'run', 'session');
    this.currentScope = scope;
    return scope;
  }

  private buildYieldContext(
    space: Space,
    { enforceDelegatePolicy = false }: { enforceDelegatePolicy?: boolean } = {},
  ): YieldRouterContext {
    return {
      space,
      clock: this.opts.clock,
      tracer: this.tracer,
      scope: this.currentScope ?? undefined,
      apiCallResolver: this.opts.appGlobals?.apiCall,
      connectionResolver: this.opts.appGlobals?.callConnection,
      documentResolver: this.opts.documentResolver,
      integrationStatusResolver: this.opts.integrationStatusResolver,
      // Store + manual-emit resolvers (plan S10) ride appGlobals like callConnection.
      storeResolver: this.opts.appGlobals?.store,
      emitEventResolver: this.opts.appGlobals?.emitEvent,
      // Consent gate (plan S10): set ONLY for interactive sessions (cli wires it
      // from renderHost.ask); absent ⇒ consent-marked yields fail closed.
      requestConsent: this.opts.consentPrompter,
      // installSpace live-registers the installed space here — the SAME shared
      // map registerSpace writes, so delegate() reaches it immediately. (The
      // router's registerSpace case stays fork-only: it is gated on
      // resolveRegisterSpace, which the session never sets.)
      dynamicSpaces: this.dynamicSpaces,
      // Code-node runner for `tasklist()` yields whose SPACE tasklist has code
      // nodes (plan S9). Host-built (libs/cli) — core never executes node modules.
      codeNodeCtxFactory: this.opts.codeNodeCtxFactory,
      getForkEngine: () => this.getForkEngine(),
      // Runs host-side with the space dir as cwd, so a checker (tests / tsc) sees
      // files written by attempt forks.
      execCommand: (cmd: string) => {
        try {
          const out = execSync(cmd, { cwd: this.opts.spaceDir, maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
          return { ok: true, output: out.toString() };
        } catch (e: unknown) {
          const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
          const output = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') || (err.message ?? String(e));
          return { ok: false, output };
        }
      },
      runDelegate: async (packageName, agentName, action, delegateOpts) => {
        // Yield-time canDelegateTo gate (unified semantics). Applied only to
        // MODEL-initiated delegate yields (enforceDelegatePolicy) — the
        // defaultAction fast path is host policy and stays exempt. The gate
        // decides WHETHER the target is callable; `allowedActions` (from
        // `#action` suffixes) then narrows WHICH actions inside runDelegate.
        let allowedActions: string[] | undefined;
        if (enforceDelegatePolicy) {
          const allow = isDelegateAllowed(this.delegatePolicy, packageName, agentName, this.dynamicSpaces);
          if (!allow.allowed) {
            throw new Error(formatDelegateDenial(this.delegatePolicy, packageName, agentName, 'agent'));
          }
          allowedActions = allow.allowedActions;
        }
        const { runDelegate } = await import('../delegate/delegate.js');
        const { DelegateRegistry } = await import('../delegate/registry.js');
        const spaceMap = new Map<string, Space>([[this.opts.spaceDir, space]]);
        for (const [pkgName, depSpace] of Object.entries(space.dependentSpaces)) {
          spaceMap.set(pkgName, depSpace);
          spaceMap.set(depSpace.dir, depSpace);
        }
        // System spaces are always delegatable (e.g. system-research/researcher)
        for (const sysSpace of this.systemSpaces) {
          spaceMap.set(sysSpace.dir, sysSpace);
          if (sysSpace.packageName) spaceMap.set(sysSpace.packageName, sysSpace);
        }
        // Merge spaces registered at runtime via registerSpace()
        for (const [key, dynSpace] of this.dynamicSpaces) {
          spaceMap.set(key, dynSpace);
        }
        const registry = new DelegateRegistry(spaceMap);
        // Resolve any attachment ids the delegating agent passed (e.g. THING
        // handing an image to system-vision, or a file to system-files) to the
        // parts/notes held for this turn. Images ride as a MediaPart; files carry
        // NO bytes/text — the specialist fetches their content itself via
        // readDocument(id), so we hand it an id-anchored note instead.
        const reqIds = (delegateOpts as import('../globals/delegate.js').DelegateOpts | undefined)?.attachmentIds;
        const resolved = (reqIds ?? [])
          .map((aid) => this.pendingAttachments.get(aid))
          .filter((a): a is UserAttachment => a !== undefined);
        const attachments = resolved.map((a) => a.part).filter((p): p is MediaPart => p !== undefined);
        // File attachments (no image part): tell the specialist to read them with
        // readDocument(id) rather than inlining server-extracted text.
        const attachmentTexts = resolved
          .filter((a) => !a.part)
          .map(
            (a) =>
              `[Attached file id="${a.id}" type="${a.mediaType}"${a.filename ? ` name="${a.filename}"` : ''} — call \`await readDocument("${a.id}")\` to read it.]`,
          );
        return runDelegate({
          packageName,
          agentName,
          action,
          allowedActions,
          delegateOpts,
          ...(attachments.length ? { attachments } : {}),
          ...(attachmentTexts.length ? { attachmentTexts } : {}),
          registry,
          renderHost: this.opts.renderHost,
          streamFn: this.deps.streamFn,
          depth: 0,
          maxDepth: 5,
          maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
          clock: this.opts.clock,
          tracer: this.tracer,
          scope: this.currentScope ?? undefined,
          systemSpaces: this.systemSpaces,
          projectSpacesDir: this.opts.projectSpacesDir,
          projectRoot: this.opts.projectRoot,
          projectId: this.opts.projectId,
          appGlobals: this.opts.appGlobals,
          model: this.opts.modelAlias,
          // Inherit the session's fork wiring down the delegation chain (A1 fix).
          budgetLimits: this.opts.budget,
          roleModels: this.opts.roleModels,
          dynamicSpaces: this.dynamicSpaces,
          documentResolver: this.opts.documentResolver,
        });
      },
    };
  }
}
