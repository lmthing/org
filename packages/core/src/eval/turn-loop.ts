import type { VM } from '../sandbox/quickjs.js';
import type { MessageHistory } from '../context/history.js';
import type { RenderHost } from '../session/types.js';
import type { YieldRequest } from './yield.js';
import type { StreamOpts, StreamSession } from './stream-types.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer } from '../sandbox/trace.js';
import { BoundaryDetector } from '../sandbox/boundary.js';
import { runTsc } from '../typecheck/tsc.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { buildErrorBlock } from './error-rewind.js';
import { emitVariables, extractBindingNames, extractBindingPattern } from '../context/variables.js';
import type { Budget } from './budget.js';

export type { StreamOpts, StreamSession };

/** Strip markdown code fence lines from a chunk before feeding to the boundary detector. */
function stripMarkdownFences(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
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
  const ctx = deps.traceContext ?? 'session';

  let attempt = 0;
  let accumulatedContext = ''; // persists across yield-continuations; only resets on a fresh start

  while (attempt < maxRetries) {
    attempt++;
    // Budget: count this LLM turn before issuing the request. Throws
    // BudgetExceededError (propagates out of runTurnLoop) if over the episode
    // or wall-clock cap — the caller disposes the VM. Counted outside the
    // stream try/catch so it cannot be swallowed as an abort.
    deps.budget?.tickEpisode();
    const contextSnapshot = accumulatedContext; // restore on error so re-tries don't see partial turn

    const promptMessages = history.getPromptMessages();
    tracer.write({ ts: Date.now(), type: 'llm_request', context: ctx, system: systemBlock, messages: promptMessages, model: deps.model });
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
          renderHost.log(`[stmt] ${stmt.slice(0, 120)}`);
          tracer.write({ ts: Date.now(), type: 'statement', context: ctx, code: stmt });

          const tscResult = runTsc({ ambientDts, sessionContext: accumulatedContext, statement: stmt });
          if (!tscResult.ok) {
            const errMsg = tscResult.diagnostics.map((d) => d.message).join('; ');
            stream.abort();
            aborted = true;
            turnError = errMsg;
            failingStatement = stmt;
            tracer.write({ ts: Date.now(), type: 'typecheck_error', context: ctx, statement: stmt, message: errMsg, attempt });
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
            tracer.write({ ts: Date.now(), type: 'eval_error', context: ctx, statement: stmt, message: evalResult.error });
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
      renderHost.log(`[model response]\n${historyContent.slice(0, 500)}\n[/model response]`);
      tracer.write({ ts: Date.now(), type: 'llm_response', context: ctx, attempt, text: historyContent });
      history.append({ role: 'assistant', content: historyContent, blockType: 'normal' });
    }

    if (turnError && failingStatement) {
      accumulatedContext = contextSnapshot; // roll back partial-turn context
      renderHost.log(`[error] ${turnError}`);
      history.append({ role: 'user', content: buildErrorBlock(failingStatement, turnError, attempt, maxRetries), blockType: 'error' });
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
        tracer.write({ ts: Date.now(), type: 'yield', context: ctx, kind: yieldReq.kind, args: yieldReq.args });
        try {
          const resolved = await processYield(yieldReq);
          tracer.write({ ts: Date.now(), type: 'yield_resolved', context: ctx, kind: yieldReq.kind, value: resolved });
          yieldReq.deferred.resolve(resolved);
          resolvedValues[i] = resolved;
        } catch (err) {
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

      // Add the yielding statement to accumulated context for future typecheck
      accumulatedContext += (accumulatedContext ? '\n' : '') + yieldingStatement;

      // Always emit a continuation message so the model knows the yield resolved and
      // what's already in scope — even for yields with no variable bindings (e.g. sleep).
      if (Object.keys(variables).length > 0) {
        renderHost.log(`[variables] ${Object.keys(variables).join(', ')}`);
      } else {
        renderHost.log(`[resumed]`);
      }
      history.append({ role: 'user', content: emitVariables(variables, accumulatedContext), blockType: 'variables' });

      attempt = 0;
      continue;
    }

    if (!hadStatements) {
      renderHost.log(`[turn ${attempt}] model produced no statements — done`);
      return 'done';
    }

    renderHost.log(`[turn ${attempt}] done`);
    return 'done';
  }

  return 'error';
}
