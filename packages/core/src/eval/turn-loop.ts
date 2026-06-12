import type { VM } from '../sandbox/quickjs.js';
import type { MessageHistory } from '../context/history.js';
import type { RenderHost } from '../session/types.js';
import type { YieldRequest } from './yield.js';
import type { StreamOpts, StreamSession } from './stream-types.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { BoundaryDetector } from '../sandbox/boundary.js';
import { runTsc } from '../typecheck/tsc.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { buildErrorBlock } from './error-rewind.js';
import { emitVariables, extractBindingNames, extractBindingPattern } from '../context/variables.js';
import { formatInspectResult, type InspectQuery } from '../globals/inspect.js';
import { serialize } from '../globals/serialize.js';
import { BudgetExceededError, type Budget } from './budget.js';

export type { StreamOpts, StreamSession };

/** A line that is nothing but a code-fence language tag — left behind when the
 *  stream splits the opening ``` from its language (```\n + `typescript`) across
 *  chunks, so the per-chunk fence filter strips the ``` but not the tag. A bare
 *  `typescript`/`ts`/… statement is never valid TS, so dropping it is safe. */
const BARE_FENCE_LANG = /^\s*(?:typescript|ts|tsx|javascript|js|jsx|json)\s*$/i;

/** Strip markdown code fence lines (and stray fence language tags) from a chunk
 *  before feeding to the boundary detector. Exported for direct testing. */
export function stripMarkdownFences(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !/^\s*```/.test(line) && !BARE_FENCE_LANG.test(line))
    .join('\n');
}

export interface TurnLoopDeps {
  vm: VM;
  history: MessageHistory;
  systemBlock: string;
  ambientDts: string;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  processYield: (req: YieldRequest) => Promise<unknown>;
  maxRetries?: number;
  tracer?: Tracer;
  /** Label for trace events — e.g. 'session', 'fork:analyze_dish', 'delegate:pairing' */
  traceContext?: string;
  /** Structured execution scope (superset of traceContext). When present, every
   *  trace event carries nodeId for full observability. */
  scope?: TraceScope;
  /** Host-set budget. tickEpisode() per turn, tickToolCalls() per resolved yield.
   *  Exceeding a limit throws BudgetExceededError, which the caller disposes the VM on. */
  budget?: Budget;
  /** Optional model spec/alias for every request in this loop (e.g. a fork's
   *  role model). Passed through to streamFn; the provider resolves it. */
  model?: string;
}

export async function runTurnLoop(deps: TurnLoopDeps): Promise<'done' | 'error'> {
  const { vm, history, systemBlock, ambientDts, renderHost, streamFn, processYield } = deps;
  const maxRetries = deps.maxRetries ?? 3;
  const tracer = deps.tracer ?? NULL_TRACER;
  const scope = deps.scope;
  const ctx = scope?.label ?? deps.traceContext ?? 'session';
  const nodeId = scope?.nodeId;
  // Mint a per-turn yieldId counter (cheap monotonic suffix)
  let yieldCounter = 0;

  let attempt = 0;
  let accumulatedContext = ''; // persists across yield-continuations; only resets on a fresh start

  while (attempt < maxRetries) {
    attempt++;
    // Budget: count this LLM turn before issuing the request. Throws
    // BudgetExceededError (propagates out of runTurnLoop) if over the episode
    // or wall-clock cap — the caller disposes the VM. Counted outside the
    // stream try/catch so it cannot be swallowed as an abort.
    deps.budget?.tickEpisode();

    const promptMessages = history.getPromptMessages();
    tracer.write({ ts: Date.now(), type: 'llm_request', context: ctx, ...(nodeId ? { nodeId } : {}), system: systemBlock, messages: promptMessages, model: deps.model });
    let lastProgressTs = 0;
    const stream = await streamFn({ system: systemBlock, messages: promptMessages, model: deps.model });

    const detector = new BoundaryDetector();
    let pendingYield: YieldRequest | null = null;
    let yieldingStatement: string | null = null;
    let hadStatements = false;
    let turnError: string | null = null;
    let failingStatement: string | null = null;
    let aborted = false;
    let assistantContent = '';
    const parsedStatements: string[] = [];

    renderHost.log(`[turn ${attempt}] streaming...`);
    try {
      for await (const chunk of stream.textStream) {
        assistantContent += chunk;
        const statements = detector.feed(stripMarkdownFences(chunk));

        for (const stmt of statements) {
          hadStatements = true;
          renderHost.log(`[stmt] ${stmt}`);
          tracer.write({ ts: Date.now(), type: 'statement', context: ctx, ...(nodeId ? { nodeId } : {}), code: stmt });

          // Throttled streaming progress (≥250ms between emissions, subscriber-only)
          const now = Date.now();
          if (now - lastProgressTs >= 250) {
            lastProgressTs = now;
            tracer.write({ ts: now, type: 'llm_progress', context: ctx, ...(nodeId ? { nodeId } : {}), chars: assistantContent.length, statements: parsedStatements.length });
          }

          const tscResult = runTsc({ ambientDts, sessionContext: accumulatedContext, statement: stmt });
          if (!tscResult.ok) {
            const errMsg = tscResult.diagnostics.map((d) => d.message).join('; ');
            stream.abort();
            aborted = true;
            turnError = errMsg;
            failingStatement = stmt;
            tracer.write({ ts: Date.now(), type: 'typecheck_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: errMsg, attempt });
            break;
          }

          // Transpile TS/JSX → JS, append globalThis bindings so the next module can
          // access variables declared here (each evalStatement is an isolated module).
          const boundNames = extractBindingNames(stmt);
          let jsCode = transpileStatement(stmt);
          if (boundNames.length > 0) {
            const assigns = boundNames
              .map((n) => `try { globalThis['${n}'] = ${n}; } catch {}`)
              .join('\n');
            jsCode += '\n' + assigns;
          }
          const evalResult = vm.evalStatement(jsCode);
          if (!evalResult.ok) {
            stream.abort();
            aborted = true;
            turnError = evalResult.error;
            failingStatement = stmt;
            tracer.write({ ts: Date.now(), type: 'eval_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: evalResult.error });
            break;
          }

          if (vm.pendingYields.length > 0) {
            pendingYield = vm.pendingYields[vm.pendingYields.length - 1]!;
            yieldingStatement = stmt;
            parsedStatements.push(stmt);
            stream.abort();
            aborted = true;
            break;
          }

          parsedStatements.push(stmt);
          accumulatedContext += (accumulatedContext ? '\n' : '') + stmt;
        }

        if (aborted) break;
      }
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (!isAbort) {
        renderHost.log(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Flush remaining buffer
    if (!aborted) {
      const trailing = stripMarkdownFences(detector.flush());
      if (trailing.trim()) {
        const stmt = trailing.trim();
        hadStatements = true;

        const tscResult = runTsc({ ambientDts, sessionContext: accumulatedContext, statement: stmt });
        if (!tscResult.ok) {
          turnError = tscResult.diagnostics.map((d) => d.message).join('; ');
          failingStatement = stmt;
        } else {
          const boundNamesFlush = extractBindingNames(stmt);
          let jsCodeFlush = transpileStatement(stmt);
          if (boundNamesFlush.length > 0) {
            const assigns = boundNamesFlush
              .map((n) => `try { globalThis['${n}'] = ${n}; } catch {}`)
              .join('\n');
            jsCodeFlush += '\n' + assigns;
          }
          const evalResult = vm.evalStatement(jsCodeFlush);
          if (!evalResult.ok) {
            turnError = evalResult.error;
            failingStatement = stmt;
          } else {
            if (vm.pendingYields.length > 0) {
              pendingYield = vm.pendingYields[vm.pendingYields.length - 1]!;
              yieldingStatement = stmt;
              parsedStatements.push(stmt);
            } else {
              parsedStatements.push(stmt);
              accumulatedContext += (accumulatedContext ? '\n' : '') + stmt;
            }
          }
        }
      }
    }

    // Use parsed statements for history so incomplete trailing stream text is excluded.
    const historyContent = parsedStatements.length > 0 ? parsedStatements.join('\n') : assistantContent.trim();
    if (historyContent) {
      renderHost.log(`[model response]\n${historyContent}\n[/model response]`);
      tracer.write({ ts: Date.now(), type: 'llm_response', context: ctx, ...(nodeId ? { nodeId } : {}), attempt, text: historyContent });
      history.append({ role: 'assistant', content: historyContent, blockType: 'normal' });
    }

    if (turnError && failingStatement) {
      // process.exit() is intentional termination, not a recoverable error. The model
      // uses it as control flow (e.g. `if (!ok) process.exit(1)`); retrying re-runs the
      // exact same code and burns LLM calls in a loop. Treat it as a clean stop.
      if (/\bprocess\.exit\(/.test(turnError)) {
        renderHost.log(`[process.exit] intentional termination — not retrying`);
        return 'done';
      }
      // Do NOT roll back accumulatedContext: statements that succeeded earlier in
      // this turn already bound their variables in the VM (globalThis) and persist
      // into the retry. Keeping them in the typecheck context matches VM reality —
      // rolling back would make tsc reject valid references with "Cannot find name".
      // The failing statement was never appended (it errors before accumulation), so
      // there is nothing partial to discard.
      renderHost.log(`[error] ${turnError}`);
      history.append({ role: 'user', content: buildErrorBlock(failingStatement, turnError, attempt, maxRetries, accumulatedContext), blockType: 'error' });
      if (attempt >= maxRetries) return 'error';
      continue;
    }

    if (pendingYield && yieldingStatement) {
      const yields = vm.pendingYields.splice(0);
      // Budget: count each resolved yield as a tool call. Throws (and the caller
      // disposes the VM) if over the tool-call or wall-clock cap.
      deps.budget?.tickToolCalls(yields.length);
      const variables: Record<string, unknown> = {};

      // Binding pattern of the yielding statement (kind + names).
      const pattern = extractBindingPattern(yieldingStatement);

      // Resolve every pending yield. A single statement can produce several yields
      // when they run concurrently — `await Promise.all([fork(...), fork(...)])`.
      // The QuickJS module continuation after `await` does NOT re-run in this sync
      // eval model, so the host must bind the values itself (see below).
      const resolvedValues: unknown[] = new Array(yields.length);
      await Promise.all(yields.map(async (yieldReq, i) => {
        const yieldId = `${nodeId ?? ctx}_y${++yieldCounter}`;
        tracer.write({ ts: Date.now(), type: 'yield', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, args: yieldReq.args, yieldId });
        try {
          const resolved = await processYield(yieldReq);
          tracer.write({ ts: Date.now(), type: 'yield_resolved', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, value: resolved, yieldId });
          yieldReq.deferred.resolve(resolved);
          resolvedValues[i] = resolved;
        } catch (err) {
          // A budget breach inside a yield (e.g. a fork rejected by the fork-depth
          // cap, or an over-budget fork/solve) is a HARD stop, not a recoverable
          // tool error. Propagate it so it surfaces exactly like the episode and
          // tool-call caps (clean non-zero exit + VM disposal by the caller) —
          // instead of being swallowed into an undefined binding that lets the run
          // continue past its ceiling.
          if (err instanceof BudgetExceededError) throw err;
          yieldReq.deferred.reject(err);
          resolvedValues[i] = undefined;
        }
      }));
      vm.drivePendingJobs();

      // Map resolved values onto the bound names. Multiple yields ⟹ the statement
      // awaited a combinator (Promise.all), whose result is the array of resolved
      // values in source order; a single yield ⟹ the result is that one value.
      const awaited: unknown = yields.length > 1 ? resolvedValues : resolvedValues[0];
      const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
      const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
      if (pattern.kind === 'array') {
        const arr = asArray(awaited);
        pattern.names.forEach((name, i) => { variables[name] = arr[i]; });
      } else if (pattern.kind === 'object') {
        const obj = asRecord(awaited);
        pattern.names.forEach((name) => { variables[name] = obj[name]; });
      } else if (pattern.names.length === 1) {
        variables[pattern.names[0]!] = awaited;
      }
      for (const [name, value] of Object.entries(variables)) {
        vm.setVar(name, value); // inject into VM scope + host scope for the next turn
      }

      // Emit a serialized variables snapshot for the observability tree
      if (Object.keys(variables).length > 0) {
        const serialized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          serialized[k] = serialize(v);
        }
        tracer.write({ ts: Date.now(), type: 'variables', context: ctx, ...(nodeId ? { nodeId } : {}), vars: serialized });
      }

      // Add the yielding statement to accumulated context for future typecheck
      accumulatedContext += (accumulatedContext ? '\n' : '') + yieldingStatement;

      // inspect() is a read-only probe: its whole purpose is to surface a value
      // (or a queried slice/path/keys view of it) to the MODEL. Unlike other yields
      // it is normally called WITHOUT a binding (`inspect(x)` / `inspect([x, q])`),
      // so the generic name-binding above captures nothing. Surface the inspected
      // values explicitly via formatInspectResult, independent of any binding —
      // otherwise a bare inspect() resolves to an empty VARIABLES block and the
      // model sees nothing (the exact failure that lets it re-type/​hallucinate
      // values instead of reading them).
      const inspectArgs = yields
        .filter((y) => y.kind === 'inspect')
        .flatMap((y) => (y.args as Array<{ value: unknown; query?: InspectQuery }>));

      // Always emit a continuation message so the model knows the yield resolved and
      // what's already in scope — even for yields with no variable bindings (e.g. sleep).
      if (Object.keys(variables).length > 0) {
        renderHost.log(`[variables] ${Object.keys(variables).join(', ')}`);
      } else if (inspectArgs.length > 0) {
        renderHost.log(`[inspect] ${inspectArgs.length} value(s)`);
      } else {
        renderHost.log(`[resumed]`);
      }

      let varContent = emitVariables(variables, accumulatedContext);
      if (inspectArgs.length > 0) {
        // Fold the inspected lines into the VARIABLES section the model already reads.
        // formatInspectResult returns "VARIABLES\ninspected[i]: …" — drop its header
        // and splice its lines in right after the existing VARIABLES header.
        const inspectLines = formatInspectResult(inspectArgs).split('\n').slice(1);
        varContent = varContent.replace(/^VARIABLES\n?/, (m) => m + inspectLines.join('\n') + '\n');
      }
      history.append({ role: 'user', content: varContent, blockType: 'variables' });

      attempt = 0;
      continue;
    }

    if (!hadStatements) {
      renderHost.log(`[turn ${attempt}] model produced no statements — done`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_statements' });
      return 'done';
    }

    renderHost.log(`[turn ${attempt}] done`);
    tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'done' });
    return 'done';
  }

  tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'max_retries' });
  return 'error';
}
