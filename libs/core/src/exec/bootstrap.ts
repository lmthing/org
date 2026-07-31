import { basename } from 'node:path';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { injectSpaceFunctions } from '../sandbox/inject-functions.js';
import { injectHostTools } from '../globals/host-tools.js';
import { createScratchTools } from '../globals/scratch.js';
import { createAskGlobal } from '../globals/ask.js';
import { createDisplayGlobal } from '../globals/display.js';
import { createInspectGlobal } from '../globals/inspect.js';
import { createSleepGlobal } from '../globals/sleep.js';
import { createFetchGlobal } from '../globals/fetch.js';
import { createLoadKnowledgeGlobal } from '../globals/load-knowledge.js';
import { createWriteKnowledgeGlobal } from '../globals/write-knowledge.js';
import { createForkGlobal } from '../globals/fork.js';
import { createDelegateGlobal } from '../globals/delegate.js';
import { createTasklistGlobal } from '../globals/tasklist.js';
import { createApiCallGlobal } from '../globals/api-call.js';
import { createBuildAppGlobal } from '../globals/build-app.js';
import { createCallConnectionGlobal } from '../globals/call-connection.js';
import { createReadDocumentGlobal } from '../globals/read-document.js';
import { createIntegrationStatusGlobal } from '../globals/integration-status.js';
import { createRegisterSpaceGlobal } from '../globals/register-space.js';
import { createSetSessionMetaGlobal } from '../globals/set-session-meta.js';
import { createSetActivityGlobal } from '../globals/set-activity.js';
import { createStoreSearchGlobal, createStoreInspectGlobal, createInstallSpaceGlobal } from '../globals/store.js';
import { createEmitEventGlobal, deriveEventScope } from '../globals/emit-event.js';
import { createConsentRequestGlobal } from '../globals/consent.js';
import { CATALOG_NAMES } from '../ui/catalog.js';
import {
  ASK_DTS, TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS, SET_SESSION_META_DTS,
  EXEC_SHELL_DTS, SCRATCH_DTS, REGISTER_SPACE_DTS, composeDbDts, CAPABILITY_DTS_FRAGMENTS,
  PROJECT_TABLE_DTS, PROJECT_READ_DTS, composeConnectionsDts, type DbTableSchema,
  PROCESS_EXIT_DTS,
} from '../typecheck/library-dts.js';
import { injectAppGlobals, type AppGlobalImpls } from './app-globals.js';
import type { RenderHost, Clock } from '../session/types.js';
import type { YieldRequest } from '../eval/yield.js';
import type { BudgetSnapshot } from '../eval/budget.js';
import type { CapabilityProfile } from './capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * VM bootstrap — the single implementation of the child-VM wiring that used to
 * be copy-pasted (and drifting) across three sites: `session/session.ts`
 * (injectGlobals + injectJSXRuntime + injectSpaceFunctions), `fork/fork.ts`
 * (the bootstrap block in runFork) and `delegate/delegate.ts` (runDelegate).
 * The genuine per-context differences are all carried by an explicit options
 * object; everything else is identical by construction.
 *
 * CRITICAL invariants deliberately NOT owned here:
 *   - VM teardown ordering: callers own `vm.dispose()` — a fork must dispose
 *     only after runTurnLoop exits (never inside a QuickJS call frame).
 *   - The swallowed `gc_obj_list` assertion handling lives in sandbox/quickjs.ts.
 *   - The host-bridge deferred lifecycle lives in sandbox/host-bridge.ts.
 */
export interface ChildVMOpts {
  /** Drives which yielding globals exist and the host-tools write gate. */
  capabilities: CapabilityProfile;
  renderHost: RenderHost;
  /** Clock for sleep() (test-injectable). */
  clock?: Clock;
  /** Working root: host tools resolve relative paths here; loadKnowledge reads
   *  from `<spaceDir>/knowledge`. (For forks this is the PARENT's space dir.) */
  spaceDir: string;
  /** Additional knowledge base directories `loadKnowledge()` falls back to, in
   *  order, after `<spaceDir>/knowledge` — typically each merged-in system
   *  space's own `knowledge/` dir. Needed because the running agent's
   *  DEFINITION can be MERGED IN from a system space (e.g. THING, from
   *  `user-thing`) while `spaceDir` stays the project's own directory: an
   *  on-demand domain that only physically exists under the system space (not
   *  the project) would otherwise ENOENT on every call. See
   *  `loadKnowledgeFileFromDirs` in `globals/load-knowledge.ts`. */
  knowledgeFallbackDirs?: string[];
  /** Exposed as LMTHING_PROJECT_SPACES_DIR (architect scaffolding target). */
  projectSpacesDir?: string;
  /** Absolute project root `<root>/<projectId>` — the app layer (db/pages/api/hooks)
   *  resolves against THIS, never LMTHING_SPACE_DIR. Exposed as LMTHING_PROJECT_DIR and
   *  gates app-global injection (no projectRoot ⇒ no app globals). */
  projectRoot?: string;
  /** The project id (basename of projectRoot). Exposed as LMTHING_PROJECT_ID. */
  projectId?: string;
  /** Host-provided app-global engine impls (libs/cli, P2+). Core wraps them in the
   *  capability-scope check before injecting. Absent ⇒ no app globals injected. */
  appGlobals?: AppGlobalImpls;
  /** Live budget snapshot for the `progress()` global. Session + fork VMs pass
   *  their Budget; the delegate's own turn loop has no Budget (only its forks
   *  do), so the delegate site passes undefined — no progress() global there. */
  progress?: () => BudgetSnapshot;
  /** Space functions to inject (TS source, and bundled JS where available). */
  functions: Record<string, string>;
  functionsBundled: Record<string, string>;
  /** Extra JSX component stubs beyond the universal design-system catalog
   *  (session/delegate agent components). Forks pass [] — catalog only. */
  componentNames: string[];
  /** Trace hook fired on every display() (context-labelled tracer write). */
  onDisplay?: (descriptor: unknown) => void;
  /** Trace hook fired on every setActivity() (fire-and-forget "currently doing"
   *  status; context-labelled tracer write). Absent ⇒ the global is a no-op. */
  onActivity?: (text: string) => void;
  /** Hook fired on every setSessionMeta() (fire-and-forget conversation naming).
   *  The host slugifies + records the title/slug and emits the session_meta trace
   *  event; returns whether anything was set (the global's `{ ok }`). Session-only
   *  (wired only in createSessionVM); absent ⇒ the global reports `{ ok: false }`. */
  onSessionMeta?: (meta: { title?: string; slug?: string }) => boolean;
  /** When set, a `currentTask` global with this resolve implementation is
   *  injected (fork: schema-validating recorder; delegate: result capture). */
  currentTaskResolve?: (value: unknown) => void;
  /** Variables pre-bound into the VM before anything else: fork seed +
   *  upstream outputs, delegate query/context, session resume snapshot scope. */
  seedVars?: Record<string, unknown>;
  /** Warn hook for space-function injection failures (message differs per site). */
  onFunctionError?: (name: string, error: string) => void;
}

/**
 * createVM + the full per-context injection sequence: seed variables,
 * currentTask, space functions, host tools, yielding globals (gated by the
 * capability profile) and the JSX runtime (React shim + component stubs).
 */
export async function createChildVM(opts: ChildVMOpts): Promise<VM> {
  const caps = opts.capabilities;
  const vm = await createVM();
  const ctx = vm.ctx;

  // 1. Seed variables (fork seed/upstream outputs, delegate query/context,
  //    session resume snapshot scope) — bound before anything can shadow them.
  for (const [name, value] of Object.entries(opts.seedVars ?? {})) {
    vm.setVar(name, value);
  }

  // 2. currentTask.resolve — result-capture channel for child contexts.
  // IMPORTANT: implementations must NOT dispose the VM from inside the resolve
  // callback (we would be inside a QuickJS call frame); they record the value
  // and the caller disposes after the turn loop exits.
  if (opts.currentTaskResolve) {
    const resolve = opts.currentTaskResolve;
    const handle = marshalToQuickJS(ctx, { resolve: (value: unknown) => resolve(value) });
    ctx.setProp(ctx.global, 'currentTask', handle);
    handle.dispose();
  }

  // 3. Space functions (system + agent, already scoped/allowlisted by the caller).
  injectSpaceFunctions(vm, opts.functions, opts.functionsBundled, (name, error) => {
    opts.onFunctionError?.(name, error);
  });

  // 4. Shared synchronous host substrate: console, execShell, process.env,
  //    readFileRaw, writeFileRaw (+ progress when a live budget exists). The
  //    capability profile gates write access — read-only roles have write
  //    WITHHELD at injection, not just discouraged in the prompt.
  injectHostTools(vm, {
    renderHost: opts.renderHost,
    spaceDir: opts.spaceDir,
    profile: { allowWrite: caps.allowWrite },
    progress: opts.progress,
    projectSpacesDir: opts.projectSpacesDir,
    projectRoot: opts.projectRoot,
    projectId: opts.projectId,
  });

  // 4b. Project-app globals (db/…), gated by the capability grants AND projectRoot.
  //     Scope-checked host-side (see injectAppGlobals). A session outside a project
  //     (no projectRoot) receives none — the backward-compat invariant.
  injectAppGlobals(vm, { app: caps.app, projectRoot: opts.projectRoot, appGlobals: opts.appGlobals });

  // 4c. Engineer scratch sandbox (`fs:scratch` grant only). Injects `createScratch`
  //     (model-facing) + the internal scratchReadRaw/scratchWriteRaw/scratchExec the
  //     engineer's six wrapper functions call, and OVERRIDES `execShell` with the
  //     scratch-rooted one so the model's "run tests/typecheck" line is jailed to
  //     scratch. Every path is safeResolve'd against the throwaway scratch dir — the
  //     ONLY generic fs in the runtime. Non-scratch agents never reach this block, so
  //     their generic-fs calls fail typecheck (absent from the DTS) — persistence goes
  //     through the typed writeProject*/architect builder functions instead.
  if (caps.scratchFs) {
    const scratch = createScratchTools({
      projectRoot: opts.projectRoot,
      spaceDir: opts.spaceDir,
      renderHost: opts.renderHost,
    });
    injectGlobal(ctx, 'createScratch', scratch.createScratch as (...a: unknown[]) => unknown);
    injectGlobal(ctx, 'scratchReadRaw', scratch.scratchReadRaw as (...a: unknown[]) => unknown);
    injectGlobal(ctx, 'scratchWriteRaw', scratch.scratchWriteRaw as (...a: unknown[]) => unknown);
    injectGlobal(ctx, 'scratchExec', scratch.scratchExec as (...a: unknown[]) => unknown);
    // Override the space-rooted execShell injected by injectHostTools with the
    // scratch-rooted one — for the engineer, `execShell` IS scratchExec.
    injectGlobal(ctx, 'execShell', scratch.scratchExec as (...a: unknown[]) => unknown);
  }

  // 5. Yielding globals, gated by the capability profile.
  //    - ask: top-level session only (headless contexts must not prompt).
  //    - fork/tasklist: orchestrating contexts only (never fork leaves).
  //    - delegate: session/delegate always; fork leaves only via canDelegateTo.
  //    - registerSpace: mutates shared session state → withheld from read-only
  //      roles and from delegates (see CapabilityProfile).
  const pushYield = (req: YieldRequest) => {
    vm.pendingYields.push(req);
  };
  type AnyFn = (...args: unknown[]) => unknown;
  if (caps.ask) injectGlobal(ctx, 'ask', createAskGlobal(pushYield, opts.renderHost) as AnyFn);
  injectGlobal(ctx, 'display', createDisplayGlobal(opts.renderHost, opts.onDisplay) as AnyFn);
  // setActivity: fire-and-forget "currently doing" status — injected UNCONDITIONALLY
  // like display (no capability gate). The host wires `onActivity` per scope so the
  // emitting VM decides main (session) vs sub (fork/delegate) — see set-activity.ts.
  injectGlobal(ctx, 'setActivity', createSetActivityGlobal(opts.onActivity ?? (() => {})) as AnyFn);
  injectGlobal(ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
  injectGlobal(ctx, 'sleep', createSleepGlobal(pushYield, opts.clock) as AnyFn);
  injectGlobal(ctx, 'fetch', createFetchGlobal(pushYield) as AnyFn);
  // readDocument: universal (like fetch), NOT capability-gated — any agent/fork/
  // delegate can read an attached upload's text by id. The host resolver is threaded
  // via the yield router (documentResolver); absent ⇒ a clear retryable error.
  injectGlobal(ctx, 'readDocument', createReadDocumentGlobal(pushYield) as AnyFn);
  injectGlobal(
    ctx,
    'loadKnowledge',
    createLoadKnowledgeGlobal(pushYield, [opts.spaceDir + '/knowledge', ...(opts.knowledgeFallbackDirs ?? [])]) as AnyFn,
  );
  // writeKnowledge: SYNCHRONOUS (no yield) knowledge author, gated on `knowledge:write`.
  // The write root is closure-bound to THIS agent's own knowledge dir (own-space only,
  // unspoofable — there is no `space` parameter); a write cap is dropped from read-only
  // fork roles by intersectAppCaps, so a writing node must be `role: general`.
  if (caps.app['knowledge:write']) {
    injectGlobal(ctx, 'writeKnowledge', createWriteKnowledgeGlobal(opts.spaceDir + '/knowledge') as AnyFn);
  }
  if (caps.orchestrate) {
    injectGlobal(ctx, 'fork', createForkGlobal(pushYield) as AnyFn);
    injectGlobal(ctx, 'tasklist', createTasklistGlobal(pushYield) as AnyFn);
  }
  if (caps.delegate) injectGlobal(ctx, 'delegate', createDelegateGlobal(pushYield) as AnyFn);
  // apiCall: value-yielding entry to the project's own api endpoints, gated on the
  // `api:call` grant. The host resolver is threaded through the yield router
  // (apiCallResolver); the DTS is declared by buildAppCapabilityDts on the same grant.
  if (caps.app['api:call']) injectGlobal(ctx, 'apiCall', createApiCallGlobal(pushYield) as AnyFn);
  // buildApp: value-yielding build+programmatic-check of the project's live app, gated on
  // the `pages:write` grant (the same grant as the page/component writers it verifies).
  // Resolver threaded via the yield router (buildAppResolver); the DTS is declared by
  // buildAppCapabilityDts on the same grant.
  if (caps.app['pages:write']) injectGlobal(ctx, 'buildApp', createBuildAppGlobal(pushYield) as AnyFn);
  // callConnection: value-yielding entry to a user-connected external service, gated on the
  // `connections:use` grant. Resolver threaded via the yield router (connectionResolver); the
  // per-grant typed DTS (buildAppCapabilityDts) restricts `provider` to the granted providers.
  if (caps.app['connections:use']) injectGlobal(ctx, 'callConnection', createCallConnectionGlobal(pushYield) as AnyFn);
  // integrationStatus: presence-only config check for an installed integration space,
  // injected for any project-rooted session (THING) — it carries no secrets (only the
  // names of missing required env vars), so there is no clean capability seam yet; S10
  // may re-gate it. The host resolver is threaded via the yield router
  // (integrationStatusResolver); absent ⇒ a clear "no project scope" error.
  if (opts.projectRoot) injectGlobal(ctx, 'integrationStatus', createIntegrationStatusGlobal(pushYield) as AnyFn);
  // storeSearch/storeInspect: catalog discovery, gated on the `store:read` grant.
  // Resolver threaded via the yield router (storeResolver, from AppGlobalImpls.store).
  if (caps.app['store:read']) {
    injectGlobal(ctx, 'storeSearch', createStoreSearchGlobal(pushYield) as AnyFn);
    injectGlobal(ctx, 'storeInspect', createStoreInspectGlobal(pushYield) as AnyFn);
  }
  // installSpace: CONSENT-MARKED store install, gated on the `store:install` grant.
  // The consent gate runs host-side in the yield router before the resolver — the
  // sandbox can never skip it (see globals/consent.ts).
  if (caps.app['store:install']) injectGlobal(ctx, 'installSpace', createInstallSpaceGlobal(pushYield) as AnyFn);
  // emitEvent: manual event publication, gated on the `events:emit` grant. The
  // emitting scope is derived HOST-side at injection (spaceDir vs projectRoot) and
  // baked into the closure, so sandbox code cannot spoof another scope's events.
  if (caps.app['events:emit']) {
    injectGlobal(ctx, 'emitEvent', createEmitEventGlobal(pushYield, deriveEventScope(opts.spaceDir, opts.projectRoot)) as AnyFn);
  }
  // __requestConsent: the internal seam consent-wrapped SPACE FUNCTIONS yield
  // through (sandbox/inject-functions.ts wrapWithConsentGate). Injected into EVERY
  // context — the yield router's consent gate decides (fail-closed without a
  // prompter) — and deliberately absent from the ambient DTS.
  injectGlobal(ctx, '__requestConsent', createConsentRequestGlobal(pushYield, basename(opts.spaceDir)) as AnyFn);
  if (caps.registerSpace) injectGlobal(ctx, 'registerSpace', createRegisterSpaceGlobal(pushYield) as AnyFn);
  // setSessionMeta: fire-and-forget conversation naming (session-only) — like
  // setActivity/display, NOT a yield, so naming never ends the turn. The host hook
  // slugifies + emits session_meta; absent ⇒ reports { ok: false }.
  if (caps.setSessionMeta) injectGlobal(ctx, 'setSessionMeta', createSetSessionMetaGlobal(opts.onSessionMeta ?? (() => false)) as AnyFn);

  // 6. JSX runtime: React shim (classic transform → JSXDescriptor) + component
  //    stubs, so model-emitted `display(<Stack>…)` works in EVERY context (the
  //    bug that made research forks fail ×3). Catalog components are universal;
  //    caller-supplied space components override on collision (injected after).
  const reactShim = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
      const typeName =
        typeof type === 'string'
          ? type
          : type && typeof type === 'object' && 'displayName' in type
            ? (type as { displayName: string }).displayName
            : String(type);
      return {
        type: typeName,
        props: (props as Record<string, unknown>) ?? {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined),
      };
    },
    Fragment: 'fragment',
  };
  const reactHandle = marshalToQuickJS(ctx, reactShim);
  ctx.setProp(ctx.global, 'React', reactHandle);
  reactHandle.dispose();
  for (const name of [...CATALOG_NAMES, ...opts.componentNames]) {
    const stub = marshalToQuickJS(ctx, { displayName: name });
    ctx.setProp(ctx.global, name, stub);
    stub.dispose();
  }

  return vm;
}

/** Ambient declaration for the `currentTask` result-capture global. */
export const CURRENT_TASK_DTS = `declare const currentTask: { resolve: (value: unknown) => void };`;

/**
 * One DTS assembler for all three contexts, replacing the three string-surgery
 * sites (session `LIBRARY_DTS + overlay`, delegate `LIBRARY_DTS_NO_ASK + …`,
 * fork's regex-strip of tasklist/fork/delegate from LIBRARY_DTS_NO_ASK). Built
 * ADDITIVELY from the per-global fragments in typecheck/library-dts.ts; the
 * declaration set for each context is identical to the pre-unification output
 * (whitespace aside) — pinned by exec/bootstrap.test.ts.
 */
export interface AmbientDtsOpts {
  /** Which orchestration + write + app-capability globals are declared. Only what
   *  `injectHostTools` injects unconditionally (COMMON_DTS + `process.exit`) is declared
   *  unconditionally; everything whose injection is gated is declared through the matching
   *  gate — `registerSpace` on `registerSpace`, `execShell` + `createScratch` on `scratchFs`
   *  (the engineer's sandbox), the project-app globals on the `app` grants.
   *  `readFileRaw`/`writeFileRaw` are internal-only and have no fragment at all. Pass the
   *  full CapabilityProfile (it satisfies this Pick). */
  capabilities: Pick<CapabilityProfile, 'ask' | 'orchestrate' | 'delegate' | 'setSessionMeta' | 'registerSpace' | 'allowWrite' | 'scratchFs' | 'app'>;
  /** Function/component overlay (buildOverlay output). Empty/omitted → none. */
  overlay?: string;
  /** Declare the `currentTask` capture global (fork + delegate contexts). */
  currentTask?: boolean;
  /** Extra ambient declarations (fork seed/upstream vars, delegate query/context). */
  extraDecls?: string[];
  /** Project-generated typed `apiCall` overloads (Phase 4). When present AND the agent
   *  holds `api:call`, these REPLACE the generic apiCall fragment so calls are strictly typed. */
  appDts?: string;
  /** Whether this VM is project-rooted (has a projectRoot). Gates the project-read DTS
   *  (`listProjectDir`/`readProjectFile`) so it is declared exactly where the impls are
   *  injected (injectAppGlobals gates the same globals on projectRoot alone). */
  projectRoot?: boolean;
  /** The real per-run DB schema (table names + column names, derived cheaply from
   *  `database/*.json` by the host). When present AND the agent is not a schema author,
   *  `composeDbDts` gates `db.*` table/column names to it so a hallucinated table or a
   *  typo'd column fails typecheck. Absent ⇒ the loose `string`-typed db members. */
  dbSchema?: DbTableSchema[];
}

/**
 * The DTS side of the capability→{inject, dts} registry: emit exactly the app-global
 * declarations the agent's `capabilities:` grants earned — the `db` object with only
 * the granted verbs (`composeDbDts`), plus each standalone authoring/outbound global
 * (`apiCall`/`writeProjectPage`/`writeProjectApi`/`writeProjectHook`). A grant that is absent is absent from
 * the DTS, so a stray call fails typecheck — the same "not listed ⇒ not injected AND
 * absent from the DTS" invariant the boolean flags enforce for ask/fork/delegate.
 */
function buildAppCapabilityDts(app: AppCapabilities, appDts?: string, projectRoot?: boolean, dbSchema?: DbTableSchema[]): string {
  const parts: string[] = [
    composeDbDts({ read: !!app['db:read'], write: !!app['db:write'], schema: !!app['db:schema'] }, dbSchema),
  ];
  // db:schema earns the standalone LIVE-project writer `writeProjectTable` (writes
  // `database/<name>.json` into the running project and re-derives its db) in ADDITION
  // to the `db.createTable`/`addColumn` members composeDbDts put on the `db` object.
  if (app['db:schema']) parts.push(PROJECT_TABLE_DTS);
  // The project-rooted introspection reads (listProjectDir/readProjectFile) are emitted for ANY
  // project-rooted session (projectRoot) — no db grant required. They are the only way to read
  // project files now that the space-rooted readFile/listDir wrappers are gone (THING reads its
  // instructions.md/documents/ through them), and they root at projectRoot, never the space dir.
  if (projectRoot) parts.push(PROJECT_READ_DTS);
  // api:call — when the caller supplies project-generated typed overloads (Phase 4:
  // `apiCall('markRead', { id: string }): { ok: boolean }` + a generic fallback), use
  // those so a malformed call fails the agent's typecheck; otherwise the generic fragment.
  if (app['api:call']) parts.push(appDts && appDts.trim() ? appDts : CAPABILITY_DTS_FRAGMENTS['api:call']);
  // connections:use — emit the typed `callConnection` with `provider` narrowed to the
  // granted providers (union), so a stray provider fails the agent's typecheck.
  if (app['connections:use']) parts.push(composeConnectionsDts(app['connections:use'].providers));
  // Standalone authoring/management/store/event globals: the live writeProject* writers
  // (pages:write/api:write/hooks:write) + createProject/selectProject (project:manage),
  // storeSearch/storeInspect + installSpace + emitEvent (plan S10). Each emitted only
  // when its grant is present.
  // `views:write` sits beside `pages:write` here, never inside it: the two authoring media are
  // separated BY CAPABILITY, which is what makes `system-viewbuilder`'s zero-WebView guarantee a
  // typecheck error rather than an instruction (see the fragment's own doc in library-dts.ts).
  for (const id of ['pages:write', 'views:write', 'api:write', 'hooks:write', 'knowledge:write', 'project:manage', 'store:read', 'store:install', 'events:emit'] as const) {
    if (app[id]) parts.push(CAPABILITY_DTS_FRAGMENTS[id]);
  }
  return parts.filter(Boolean).join('\n');
}

export function buildAmbientDts(opts: AmbientDtsOpts): string {
  const caps = opts.capabilities;
  return [
    caps.ask ? ASK_DTS : '',
    caps.setSessionMeta ? SET_SESSION_META_DTS : '',
    caps.orchestrate ? TASKLIST_DTS : '',
    caps.orchestrate ? FORK_DTS : '',
    caps.delegate ? DELEGATE_DTS : '',
    // registerSpace() mutates shared session state, so its injection is gated
    // (`injectGlobal` on `caps.registerSpace`, step 4b) — the declaration is gated with it.
    // Withheld from sessions and delegates entirely; only a write-capable fork role has it,
    // which is exactly where the architect's register/reregister nodes run.
    caps.registerSpace ? REGISTER_SPACE_DTS : '',
    COMMON_DTS,
    // process.exit is declared UNCONDITIONALLY, same tier as COMMON_DTS — the runtime already
    // injects a real `process.exit` in every VM regardless of role/capabilities
    // (globals/host-tools.ts's injectHostTools runs before any capability gating), so every
    // context's ambient DTS must match ("not granted ⇒ not injected AND absent from the DTS"
    // runs both directions: injected-everywhere ⇒ declared-everywhere). Deliberately NOT
    // PROCESS_ENV_DTS — `process.env` stays off every model surface (secrets hygiene); only the
    // env-free PROCESS_EXIT_DTS fragment is emitted here.
    PROCESS_EXIT_DTS,
    // Generic fs/shell is NOT part of any agent's model surface. readFileRaw/writeFileRaw
    // are internal-only (memory/todos + architect builders call them in un-typechecked
    // bodies), so they are never declared here. execShell + createScratch are declared ONLY
    // for the engineer's `fs:scratch` sandbox — where execShell is the scratch-rooted variant
    // (bootstrap step 4c). Every other agent persists through the typed writeProject*/architect
    // builder functions, so a stray readFile/writeFile/execShell call fails typecheck.
    caps.scratchFs ? EXEC_SHELL_DTS : '',
    caps.scratchFs ? SCRATCH_DTS : '',
    buildAppCapabilityDts(caps.app, opts.appDts, opts.projectRoot, opts.dbSchema),
    opts.overlay ?? '',
    opts.currentTask ? CURRENT_TASK_DTS : '',
    ...(opts.extraDecls ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}
