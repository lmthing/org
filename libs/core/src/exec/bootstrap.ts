import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { injectSpaceFunctions } from '../sandbox/inject-functions.js';
import { injectHostTools } from '../globals/host-tools.js';
import { createAskGlobal } from '../globals/ask.js';
import { createDisplayGlobal } from '../globals/display.js';
import { createInspectGlobal } from '../globals/inspect.js';
import { createSleepGlobal } from '../globals/sleep.js';
import { createFetchGlobal } from '../globals/fetch.js';
import { createLoadKnowledgeGlobal } from '../globals/load-knowledge.js';
import { createForkGlobal } from '../globals/fork.js';
import { createDelegateGlobal } from '../globals/delegate.js';
import { createTasklistGlobal } from '../globals/tasklist.js';
import { createRegisterSpaceGlobal } from '../globals/register-space.js';
import { CATALOG_NAMES } from '../ui/catalog.js';
import { ASK_DTS, TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS } from '../typecheck/library-dts.js';
import type { RenderHost, Clock } from '../session/types.js';
import type { YieldRequest } from '../eval/yield.js';
import type { BudgetSnapshot } from '../eval/budget.js';
import type { CapabilityProfile } from './capability.js';

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
  /** Exposed as LMTHING_PROJECT_SPACES_DIR (architect scaffolding target). */
  projectSpacesDir?: string;
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
  });

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
  injectGlobal(ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
  injectGlobal(ctx, 'sleep', createSleepGlobal(pushYield, opts.clock) as AnyFn);
  injectGlobal(ctx, 'fetch', createFetchGlobal(pushYield) as AnyFn);
  injectGlobal(ctx, 'loadKnowledge', createLoadKnowledgeGlobal(pushYield, opts.spaceDir + '/knowledge') as AnyFn);
  if (caps.orchestrate) {
    injectGlobal(ctx, 'fork', createForkGlobal(pushYield) as AnyFn);
    injectGlobal(ctx, 'tasklist', createTasklistGlobal(pushYield) as AnyFn);
  }
  if (caps.delegate) injectGlobal(ctx, 'delegate', createDelegateGlobal(pushYield) as AnyFn);
  if (caps.registerSpace) injectGlobal(ctx, 'registerSpace', createRegisterSpaceGlobal(pushYield) as AnyFn);

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
  /** Which orchestration globals are declared. `registerSpace` and everything
   *  in COMMON_DTS are declared unconditionally (matching the old DTS). */
  capabilities: Pick<CapabilityProfile, 'ask' | 'orchestrate' | 'delegate'>;
  /** Function/component overlay (buildOverlay output). Empty/omitted → none. */
  overlay?: string;
  /** Declare the `currentTask` capture global (fork + delegate contexts). */
  currentTask?: boolean;
  /** Extra ambient declarations (fork seed/upstream vars, delegate query/context). */
  extraDecls?: string[];
}

export function buildAmbientDts(opts: AmbientDtsOpts): string {
  const caps = opts.capabilities;
  return [
    caps.ask ? ASK_DTS : '',
    caps.orchestrate ? TASKLIST_DTS : '',
    caps.orchestrate ? FORK_DTS : '',
    caps.delegate ? DELEGATE_DTS : '',
    COMMON_DTS,
    opts.overlay ?? '',
    opts.currentTask ? CURRENT_TASK_DTS : '',
    ...(opts.extraDecls ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}
