import type { VM } from '../sandbox/quickjs.js';
import type { MessageHistory } from '../context/history.js';
import type { RenderHost } from '../session/types.js';
import type { YieldRequest } from './yield.js';
import type { StreamOpts, StreamSession } from './stream-types.js';
import { BoundaryDetector } from '../sandbox/boundary.js';
import { runTsc } from '../typecheck/tsc.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { buildErrorBlock } from './error-rewind.js';
import { emitVariables, extractBindingNames } from '../context/variables.js';

export type { StreamOpts, StreamSession };

export interface TurnLoopDeps {
  vm: VM;
  history: MessageHistory;
  systemBlock: string;
  ambientDts: string;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  processYield: (req: YieldRequest) => Promise<unknown>;
  maxRetries?: number;
}

export async function runTurnLoop(deps: TurnLoopDeps): Promise<'done' | 'error'> {
  const { vm, history, systemBlock, ambientDts, renderHost, streamFn, processYield } = deps;
  const maxRetries = deps.maxRetries ?? 3;

  let attempt = 0;
  let accumulatedContext = ''; // persists across yield-continuations; only resets on a fresh start

  while (attempt < maxRetries) {
    attempt++;
    const contextSnapshot = accumulatedContext; // restore on error so re-tries don't see partial turn

    const promptMessages = history.getPromptMessages();
    const stream = await streamFn({ system: systemBlock, messages: promptMessages });

    const detector = new BoundaryDetector();
    let pendingYield: YieldRequest | null = null;
    let yieldingStatement: string | null = null;
    let hadStatements = false;
    let turnError: string | null = null;
    let failingStatement: string | null = null;
    let aborted = false;
    let assistantContent = '';

    renderHost.log(`[turn ${attempt}] streaming...`);
    try {
      for await (const chunk of stream.textStream) {
        assistantContent += chunk;
        const statements = detector.feed(chunk);

        for (const stmt of statements) {
          hadStatements = true;
          renderHost.log(`[stmt] ${stmt.slice(0, 120)}`);

          const tscResult = runTsc({ ambientDts, sessionContext: accumulatedContext, statement: stmt });
          if (!tscResult.ok) {
            const errMsg = tscResult.diagnostics.map((d) => d.message).join('; ');
            stream.abort();
            aborted = true;
            turnError = errMsg;
            failingStatement = stmt;
            break;
          }

          // Transpile TS/JSX → JS, append globalThis bindings so the next module can
          // access variables declared here (each evalStatement is an isolated module).
          const boundNames = extractBindingNames(stmt);
          let jsCode = transpileStatement(stmt);
          if (boundNames.length > 0) {
            const assigns = boundNames
              .map((n) => `if (typeof ${n} !== 'undefined') globalThis['${n}'] = ${n};`)
              .join('\n');
            jsCode += '\n' + assigns;
          }
          const evalResult = vm.evalStatement(jsCode);
          if (!evalResult.ok) {
            stream.abort();
            aborted = true;
            turnError = evalResult.error;
            failingStatement = stmt;
            break;
          }

          if (vm.pendingYields.length > 0) {
            pendingYield = vm.pendingYields[vm.pendingYields.length - 1]!;
            yieldingStatement = stmt;
            stream.abort();
            aborted = true;
            break;
          }

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
      const trailing = detector.flush();
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
              .map((n) => `if (typeof ${n} !== 'undefined') globalThis['${n}'] = ${n};`)
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
            } else {
              accumulatedContext += (accumulatedContext ? '\n' : '') + stmt;
            }
          }
        }
      }
    }

    if (assistantContent.trim()) {
      renderHost.log(`[model response]\n${assistantContent.trim().slice(0, 500)}\n[/model response]`);
      history.append({ role: 'assistant', content: assistantContent.trim(), blockType: 'normal' });
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
      const variables: Record<string, unknown> = {};

      // Extract binding names from the statement that caused the yield
      const boundNames = extractBindingNames(yieldingStatement);

      for (const yieldReq of yields) {
        let resolved: unknown;
        try {
          // processYield does the actual async work (renders form, sleeps, etc.)
          resolved = await processYield(yieldReq);
          // Resolve the JS Promise — triggers VM deferred resolution as a microtask
          yieldReq.deferred.resolve(resolved);
          // Flush microtasks so the VM deferred resolves and executePendingJobs runs
          await Promise.resolve();
          // Drive remaining VM jobs (module continuation binds the variable)
          vm.drivePendingJobs();
        } catch (err) {
          yieldReq.deferred.reject(err);
          await Promise.resolve();
          resolved = undefined;
        }

        for (const name of boundNames) {
          variables[name] = resolved;
          // Inject into VM global scope so next-turn modules can access the variable
          vm.setVar(name, resolved);
        }
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
