import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { Message } from '../context/history.js';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { validateOutput } from '../tasklist/schema.js';
import { marshalToQuickJS } from '../sandbox/host-bridge.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer } from '../sandbox/trace.js';

export interface ForkTask {
  instruction: string;
  output: Record<string, string>;
  seed?: Record<string, unknown>;
  timeout?: number;
  taskId?: string;
  upstreamOutputs?: Record<string, unknown>;
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
}

export class ForkEngine {
  private activeForks = 0;
  private queue: Array<() => void> = [];

  constructor(private opts: ForkEngineOpts) {}

  async fork<T>(task: ForkTask): Promise<T> {
    // Wait for concurrency slot
    await this.acquireSlot();

    try {
      return await this.runFork<T>(task);
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.activeForks < this.opts.maxConcurrentForks) {
      this.activeForks++;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeForks++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeForks--;
    const next = this.queue.shift();
    if (next) next();
  }

  private async runFork<T>(task: ForkTask): Promise<T> {
    return new Promise<T>(async (resolve, reject) => {
      let settled = false;
      let didResolve = false;
      let resolvedValue: unknown;
      let resolvedError: Error | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      function settle(fn: () => void): void {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        fn();
      }

      // Set up timeout
      if (task.timeout && task.timeout > 0) {
        const clock = this.opts.clock;
        if (clock) {
          clock.setTimeout(() => {
            settle(() => reject(new Error(`Fork timed out after ${task.timeout}ms`)));
          }, task.timeout);
        } else {
          timeoutId = setTimeout(() => {
            settle(() => reject(new Error(`Fork timed out after ${task.timeout}ms`)));
          }, task.timeout);
        }
      }

      let vm: VM | undefined;
      try {
        vm = await createVM();

        // Inject seed variables
        if (task.seed) {
          for (const [name, value] of Object.entries(task.seed)) {
            vm.setVar(name, value);
          }
        }

        // Inject upstream outputs as __task_<id> variables
        if (task.upstreamOutputs) {
          for (const [id, output] of Object.entries(task.upstreamOutputs)) {
            vm.setVar(`__task_${id}`, output);
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

        // Inject standard globals (no fork/delegate/tasklist in child to avoid recursion issues)
        const { createAskGlobal } = await import('../globals/ask.js');
        const { createDisplayGlobal } = await import('../globals/display.js');
        const { createInspectGlobal } = await import('../globals/inspect.js');
        const { createSleepGlobal } = await import('../globals/sleep.js');

        const capturedVm = vm;
        const pushYield = (req: import('../eval/yield.js').YieldRequest) => {
          capturedVm.pendingYields.push(req);
        };

        type AnyFn = (...args: unknown[]) => unknown;
        injectGlobal(vm.ctx, 'ask', createAskGlobal(pushYield, this.opts.renderHost) as AnyFn);
        injectGlobal(vm.ctx, 'display', createDisplayGlobal(this.opts.renderHost) as AnyFn);
        injectGlobal(vm.ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
        injectGlobal(vm.ctx, 'sleep', createSleepGlobal(pushYield, this.opts.clock) as AnyFn);

        // Build user message for the child
        const inputSummary = task.upstreamOutputs
          ? `\nInputs:\n${Object.entries(task.upstreamOutputs)
              .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
              .join('\n')}`
          : '';

        const outputSchemaStr = JSON.stringify(task.output, null, 2);
        const userMessage = `${task.instruction}${inputSummary}\n\nOutput schema:\n${outputSchemaStr}\n\nWhen done, call: currentTask.resolve({ ...output })`;

        const history = new MessageHistory();
        history.append({ role: 'user', content: userMessage, blockType: 'normal' });

        const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
        const ambientDts = LIBRARY_DTS + '\n' + currentTaskDts;

        const systemBlock = [
          'CRITICAL INSTRUCTION: You are a TypeScript code execution agent. You MUST respond with TypeScript code ONLY. Do NOT write any prose, explanations, JSON, markdown, or natural language. Your entire response will be fed directly into a TypeScript evaluator.',
          '',
          'Respond with valid TypeScript statements only. Use top-level `await` for async operations. Do not wrap code in functions or markdown code blocks.',
          '',
          'When your task is complete, call `currentTask.resolve(value)` with an object matching the output schema.',
          'Do not ask for clarification — work with what you have.',
        ].join('\n');

        const result = await runTurnLoop({
          vm,
          history,
          systemBlock,
          ambientDts,
          renderHost: this.opts.renderHost,
          streamFn: this.opts.streamFn,
          processYield: async (req) => {
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
            return undefined;
          },
          maxRetries: 3,
          tracer: this.opts.tracer ?? NULL_TRACER,
          traceContext: `fork:${task.taskId ?? 'unknown'}`,
        });

        // All QuickJS call frames have exited — safe to dispose.
        vm.dispose();
        vm = undefined;

        settle(() => {
          if (didResolve) {
            resolvedError ? reject(resolvedError) : resolve(resolvedValue as T);
          } else {
            reject(new Error(`Fork completed without calling currentTask.resolve() (result: ${result})`));
          }
        });
      } catch (err) {
        if (vm) {
          try { vm.dispose(); } catch { /* ignore dispose errors in error path */ }
          vm = undefined;
        }
        settle(() => reject(err));
      }
    });
  }
}
