import type { StreamOpts, StreamSession } from '../eval/stream-types.js';

/**
 * Mock LLM provider — a scripted `streamFn` drop-in that emits TypeScript instead
 * of calling the AI SDK. Lets the runtime (and the whole live-testing plan) run
 * end-to-end with NO provider credentials.
 *
 * The model is reached through exactly one function — `streamFn` — injected at the
 * `Session` boundary and threaded unchanged into every fork and delegate. A single
 * mock therefore covers session + forks + delegates, and because it sits UPSTREAM of
 * the tracer, every `llm_request` / `llm_response` / `yield` trace event still fires:
 * only the *content* is scripted, the wiring is real.
 */

/** Context passed to a handler so it can branch on which call this is. */
export interface MockContext {
  /** Zero-based index of this streamFn call. Increments per call across the whole
   *  run (session turns AND fork/delegate turns share the counter). */
  callIndex: number;
}

/**
 * A handler decides what TypeScript the "model" emits for one turn. It inspects the
 * incoming prompt (`opts.system`, `opts.messages`, `opts.model`) and returns:
 *   - `string`            — emitted whole
 *   - `string[]`          — emitted as a sequence of chunks (exercises streaming)
 *   - `AsyncIterable<string>` — chunks pulled lazily
 * Returning an empty/whitespace string ends the turn loop (it treats "no statements"
 * as done), so a handler returns `''` to stop.
 */
export type MockHandler = (
  opts: StreamOpts,
  ctx: MockContext,
) => string | string[] | AsyncIterable<string>;

function isAsyncIterable(x: unknown): x is AsyncIterable<string> {
  return typeof x === 'object' && x !== null && Symbol.asyncIterator in (x as object);
}

/**
 * Raw escape hatch: wrap a `MockHandler` into a ready `streamFn`. The returned
 * `textStream` yields the handler's chunks and honors `abort()` (mirrors the
 * existing `scriptedStream` abort flag in turn-loop-yield.test.ts).
 */
export function createMockStreamFn(
  handler: MockHandler,
): (opts: StreamOpts) => Promise<StreamSession> {
  let callIndex = 0;
  return async (opts: StreamOpts): Promise<StreamSession> => {
    const produced = handler(opts, { callIndex: callIndex++ });
    let aborted = false;
    async function* gen(): AsyncIterable<string> {
      if (isAsyncIterable(produced)) {
        for await (const chunk of produced) {
          if (aborted) return;
          yield chunk;
        }
        return;
      }
      const chunks = Array.isArray(produced) ? produced : [produced];
      for (const chunk of chunks) {
        if (aborted) return;
        if (chunk) yield chunk;
      }
    }
    return {
      textStream: gen(),
      abort() {
        aborted = true;
      },
    };
  };
}

/**
 * Sequential queue: call N of the run emits `turns[N]`; once the queue is exhausted
 * it emits `''` (which ends the loop). Simplest builder — good for linear,
 * single-agent runs with no forks interleaving.
 */
export function mockScript(turns: string[]): (opts: StreamOpts) => Promise<StreamSession> {
  return createMockStreamFn((_opts, { callIndex }) => turns[callIndex] ?? '');
}

/** One rule for `mockMatch`. */
export interface MockRule {
  /** Match against the request. A `RegExp` tests the combined system+messages text;
   *  a predicate receives the raw `StreamOpts` for full control. */
  when: RegExp | ((opts: StreamOpts) => boolean);
  /** What to emit when this rule matches. */
  respond: MockHandler;
}

/** The text a `RegExp` rule is tested against: the system block plus every message. */
function matchHaystack(opts: StreamOpts): string {
  return opts.system + '\n' + opts.messages.map((m) => m.content).join('\n');
}

/**
 * First-matching-rule-wins router. Robust when forks/delegates interleave with the
 * main loop: forks carry their role preamble in `system` and their `instruction` in
 * the user `messages`; `solve` retries carry the verifier feedback. Match on those to
 * return a fork's answer vs. the orchestrator's next step.
 *
 * If no rule matches and no `fallback` is given, throws — a loud failure beats a
 * silent empty turn that looks like "the model decided it was done".
 */
export function mockMatch(
  rules: MockRule[],
  fallback?: MockHandler,
): (opts: StreamOpts) => Promise<StreamSession> {
  return createMockStreamFn((opts, ctx) => {
    for (const rule of rules) {
      const hit = rule.when instanceof RegExp ? rule.when.test(matchHaystack(opts)) : rule.when(opts);
      if (hit) return rule.respond(opts, ctx);
    }
    if (fallback) return fallback(opts, ctx);
    const last = opts.messages.at(-1)?.content.slice(0, 160) ?? '';
    throw new Error(
      `mockMatch: no rule matched and no fallback provided.\n` +
        `  system (head): ${opts.system.slice(0, 120)}\n` +
        `  last message (head): ${last}`,
    );
  });
}
