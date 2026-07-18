import ts from 'typescript';
import type { VM } from '../sandbox/quickjs.js';
import type { YieldRequest } from '../eval/yield.js';
import type { RenderHost } from '../session/types.js';
import { runTsc } from '../typecheck/tsc.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { emitVariables, extractBindingNames, extractBindingPattern } from '../context/variables.js';
import { bindYieldResults, formatReadDocuments, formatLoadKnowledgeContents } from '../eval/turn-loop.js';
import { serialize } from '../globals/serialize.js';
import { BudgetExceededError, type Budget } from '../eval/budget.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';

/**
 * Host-executed task prelude (Phase 4 of the reliability plan — fixes root
 * cause A3 of `.issues/investigate-forks-degrade-under-delegate-nesting.md`).
 *
 * Leaf task files used to DICTATE a fixed sequence of TS statements the model
 * had to re-emit verbatim (`const question = String(item); const results =
 * await webSearch(question); …`). Every yield is a turn boundary where a small
 * model can skip/rename/reorder a binding — the observed `Cannot find name
 * 'question'` failures under delegate nesting. Those statements need ZERO model
 * judgment, so the task author now puts them in frontmatter `prelude:` and the
 * HOST executes them in the fork VM before the model's first turn, through the
 * exact same statement pipeline the turn loop uses (typecheck → transpile →
 * globalThis propagation → eval → yield routing → `bindYieldResults`).
 *
 * Error semantics: a failing prelude statement must NOT kill the fork. On a
 * typecheck/eval/yield error its bound names are bound `undefined` in the VM
 * and declared ambient `any` (same pattern as the turn loop's
 * `yieldErrorNames`), the failure is noted in the VARIABLES block the model
 * sees, and execution CONTINUES with the remaining statements — task
 * instructions already specify degraded-output behavior, so the model gets a
 * chance to resolve something honest.
 *
 * Budget: prelude yields tick the fork's Budget toolCall counter (they are
 * real webSearch/webFetch calls); prelude statements do NOT count as episodes.
 * A BudgetExceededError (tool-call cap, nested fork-depth cap) PROPAGATES —
 * hard cost ceilings are honored exactly as in the turn loop.
 */

/** Statement failure surfaced in the prelude's VARIABLES block. */
export interface PreludeFailure {
  /** Zero-based statement index within the prelude source. */
  index: number;
  statement: string;
  /** Names the failed statement would have bound (now bound `undefined`). */
  names: string[];
  error: string;
}

export interface RunPreludeOpts {
  vm: VM;
  /** The task's frontmatter `prelude:` source (trusted, statically authored). */
  source: string;
  /** Ambient DTS the prelude statements typecheck against. Callers pass a
   *  variant WITHOUT `currentTask` so a prelude cannot resolve the task —
   *  `currentTask.resolve(...)` in a prelude fails typecheck (a per-statement
   *  prelude error) instead of silently pre-resolving on the model's behalf. */
  ambientDts: string;
  /** The fork's OWN yield resolver (routeCommonYield with the fork context) —
   *  the prelude can call webSearch/webFetch/fetch/sleep/loadKnowledge like
   *  any fork statement. */
  processYield: (req: YieldRequest) => Promise<unknown>;
  renderHost: RenderHost;
  /** Fork budget: each resolved prelude yield ticks tickToolCalls. */
  budget?: Budget;
  tracer?: Tracer;
  /** The fork's scope — prelude events carry its nodeId with a `:prelude`
   *  context-label suffix so trace tooling attributes the activity. */
  scope?: TraceScope;
}

export interface PreludeResult {
  /** Successfully executed statements, newline-joined — seeds the turn loop's
   *  `initialContext` so the model's statements typecheck against the
   *  prelude's bound names. */
  context: string;
  /** Every name the prelude bound (failed statements' names → undefined). */
  vars: Record<string, unknown>;
  /** Names of FAILED statements — the caller must declare these as ambient
   *  `declare const <n>: any;` (they are NOT in `context`, which only carries
   *  committed statements). */
  failedNames: string[];
  failures: PreludeFailure[];
  /** Ready-to-append first VARIABLES message for the fork's history (empty
   *  string when the prelude was empty). The model must SEE the values (e.g.
   *  search results), not just the names. */
  variablesBlock: string;
}

/**
 * Split trusted prelude source into top-level statements with a single TS
 * parse. The streaming BoundaryDetector heuristics are unnecessary here — the
 * source is a static string, so `ts.createSourceFile` + top-level statements
 * is exact. Exported for direct testing.
 */
export function splitPreludeStatements(source: string): string[] {
  const sf = ts.createSourceFile('_prelude.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  return sf.statements
    .map((s) => source.slice(s.getStart(sf), s.end).trim())
    .filter(Boolean);
}

/** Bound so a pathological space function that yields forever cannot wedge the host. */
const MAX_NESTED_YIELD_ROUNDS = 32;

export async function runPrelude(opts: RunPreludeOpts): Promise<PreludeResult> {
  const { vm, renderHost, processYield } = opts;
  const tracer = opts.tracer ?? NULL_TRACER;
  const scope = opts.scope;
  const ctx = `${scope?.label ?? 'fork'}:prelude`;
  const nodeId = scope?.nodeId;
  let yieldCounter = 0;

  const statements = splitPreludeStatements(opts.source);

  let context = '';
  const vars: Record<string, unknown> = {};
  const documentYields: YieldRequest[] = [];
  const documentResults: unknown[] = [];
  const knowledgeYields: YieldRequest[] = [];
  const knowledgeResults: unknown[] = [];
  const failedNames: string[] = [];
  const failures: PreludeFailure[] = [];

  // Ambient decls for failed statements' names, so LATER prelude statements
  // (and eventually the model, via the caller) referencing them still typecheck
  // — same mechanism as the turn loop's yieldErrorNames.
  const fullAmbient = (): string =>
    failedNames.length > 0
      ? opts.ambientDts + '\n' + failedNames.map((n) => `declare const ${n}: any;`).join('\n')
      : opts.ambientDts;

  const fail = (index: number, statement: string, names: string[], error: string): void => {
    failures.push({ index, statement, names, error });
    for (const name of names) {
      if (!failedNames.includes(name)) failedNames.push(name);
      // Seed undefined in the VM so a later statement that references the name
      // cannot ReferenceError (it evaluates against a defined-but-undefined global).
      vm.setVar(name, undefined);
      vars[name] = undefined;
    }
    renderHost.log(`[prelude] statement ${index + 1} failed: ${error}`);
  };

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    tracer.write({ ts: Date.now(), type: 'statement', context: ctx, ...(nodeId ? { nodeId } : {}), code: stmt });
    renderHost.log(`[prelude stmt] ${stmt}`);

    // 1. Typecheck against the fork's ambient DTS + accumulated prelude context.
    const tscResult = runTsc({ ambientDts: fullAmbient(), sessionContext: context, statement: stmt });
    if (!tscResult.ok) {
      const errMsg = tscResult.diagnostics.map((d) => d.message).join('; ');
      tracer.write({ ts: Date.now(), type: 'typecheck_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: errMsg, attempt: 1 });
      fail(i, stmt, extractBindingNames(stmt), errMsg);
      continue;
    }

    // 2. Transpile + globalThis propagation per bound name (each evalStatement
    //    is an isolated module — identical to the turn loop's pipeline).
    const boundNames = extractBindingNames(stmt);
    let jsCode = transpileStatement(stmt);
    if (boundNames.length > 0) {
      const assigns = boundNames.map((n) => `try { globalThis['${n}'] = ${n}; } catch {}`).join('\n');
      jsCode += '\n' + assigns;
    }

    // 3. Eval.
    const evalResult = vm.evalStatement(jsCode);
    if (!evalResult.ok) {
      tracer.write({ ts: Date.now(), type: 'eval_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: evalResult.error });
      fail(i, stmt, boundNames, evalResult.error);
      continue;
    }

    // 4. Resolve yields through the fork's OWN router. A resolved yield can
    //    surface FURTHER pending yields once jobs are driven (a space function
    //    awaiting fetch() more than once), so drain in rounds. The FIRST round's
    //    count/values carry the combinator semantics for bindYieldResults; the
    //    getVar preference inside it recovers the real outer value for nested
    //    yields (webSearch internally awaiting fetch — the load-bearing fix).
    if (vm.pendingYields.length > 0) {
      const pattern = extractBindingPattern(stmt);
      let firstRoundCount = 0;
      let firstRoundValues: unknown[] = [];
      let yieldError: string | null = null;

      for (let round = 0; round < MAX_NESTED_YIELD_ROUNDS && vm.pendingYields.length > 0; round++) {
        const yields = vm.pendingYields.splice(0);
        // Budget: prelude yields are real tool calls — tick the fork's counter.
        // Throws BudgetExceededError (propagates: hard caps are honored).
        opts.budget?.tickToolCalls(yields.length);

        const resolvedValues: unknown[] = new Array(yields.length);
        const roundErrors: string[] = [];
        await Promise.all(yields.map(async (yieldReq, j) => {
          const yieldId = `${nodeId ?? ctx}_p${++yieldCounter}`;
          tracer.write({ ts: Date.now(), type: 'yield', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, args: yieldReq.args, yieldId });
          try {
            const resolved = await processYield(yieldReq);
            tracer.write({ ts: Date.now(), type: 'yield_resolved', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, value: resolved, yieldId });
            yieldReq.deferred.resolve(resolved);
            resolvedValues[j] = resolved;
          } catch (err) {
            // Hard budget breaches (fork-depth, tool-call cap inside a nested
            // yield) propagate — everything else degrades this statement only.
            if (err instanceof BudgetExceededError) throw err;
            yieldReq.deferred.reject(err);
            resolvedValues[j] = undefined;
            roundErrors.push(`${yieldReq.kind}() failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }));
        vm.drivePendingJobs();
        for (let j = 0; j < yields.length; j++) {
          if (yields[j]?.kind === 'readDocument') {
            documentYields.push(yields[j]!);
            documentResults.push(resolvedValues[j]);
          }
          if (yields[j]?.kind === 'loadKnowledge') {
            knowledgeYields.push(yields[j]!);
            knowledgeResults.push(resolvedValues[j]);
          }
        }

        if (round === 0) {
          firstRoundCount = yields.length;
          firstRoundValues = resolvedValues;
        }
        if (roundErrors.length > 0) {
          yieldError = roundErrors.join('; ');
          break;
        }
      }

      if (yieldError) {
        fail(i, stmt, pattern.names, yieldError);
        continue;
      }

      // Bind results with the EXPORTED turn-loop helper — do NOT reimplement:
      // the getVar preference is load-bearing for nested yields.
      const bound = bindYieldResults(vm, pattern, firstRoundCount, firstRoundValues);
      for (const [name, value] of Object.entries(bound)) {
        vm.setVar(name, value);
        vars[name] = value;
      }
    } else if (boundNames.length > 0) {
      // Plain (non-yielding) binding: surface the VM's computed values so the
      // model SEES them, not just the names.
      for (const name of boundNames) {
        vars[name] = vm.getVar(name);
      }
    }

    // 5. Commit to the accumulated typecheck context (successful statements only).
    context += (context ? '\n' : '') + stmt;
  }

  // Variables snapshot for the observability tree (same event shape as the turn loop).
  if (Object.keys(vars).length > 0) {
    const serialized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vars)) serialized[k] = serialize(v);
    tracer.write({ ts: Date.now(), type: 'variables', context: ctx, ...(nodeId ? { nodeId } : {}), vars: serialized });
  }

  // First VARIABLES block for the model. emitVariables(vars, context) also
  // lists SCOPE + ALREADY EXECUTED so the model knows not to re-run the prelude.
  let variablesBlock = '';
  if (statements.length > 0) {
    variablesBlock =
      'A host-executed PRELUDE already ran the setup statements for this task. ' +
      'Their results are bound in scope — read them below; do NOT re-run these statements.\n\n' +
      emitVariables(vars, context || undefined);
    const documentBlock = formatReadDocuments(documentYields, documentResults);
    if (documentBlock) variablesBlock += `\n\n${documentBlock}`;
    const knowledgeBlock = formatLoadKnowledgeContents(knowledgeYields, knowledgeResults);
    if (knowledgeBlock) variablesBlock += `\n\n${knowledgeBlock}`;
    if (failures.length > 0) {
      variablesBlock += '\n\n' + failures
        .map((f) => {
          const firstLine = f.error.split('\n')[0]!;
          const namesNote = f.names.length > 0 ? ` (${f.names.join(', ')} bound undefined)` : '';
          return `// prelude: statement ${f.index + 1} failed: ${firstLine}${namesNote}`;
        })
        .join('\n');
    }
  }

  return { context, vars, failedNames, failures, variablesBlock };
}
