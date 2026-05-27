/**
 * MockLLM — deterministic LLM mock for testing sessions end-to-end.
 *
 * Uses the AI SDK's built-in MockLanguageModelV3 (from `ai/test`) as the
 * underlying primitive. Provides a scripting API for queuing responses,
 * plus utilities for common agent patterns (inspect, display, ask).
 *
 * Usage:
 *   const mock = new MockLLM()
 *     .queueAnalysis()                        // for the Analyzer XS call
 *     .queueCode('const x = 42\ninspect(x)')  // for the main LLM cycle
 *
 *   const session = new SpaceChatSession({ ..., model: mock.build() })
 *   await session.init()
 *   await session.handleUserMessage('hello')
 *
 *   expect(mock.streamCalls).toHaveLength(1)
 */
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3GenerateResult,
  LanguageModelV3CallOptions,
} from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'

// ── Public re-exports ─────────────────────────────────────────────────────────

export interface AnalyzerResult {
  difficulty: 'simple' | 'moderate' | 'complex'
  skip_planner: boolean
  estimated_tasks: number
  needs_fork: boolean
  needs_ask: boolean
  rationale: string
}

export interface MockStreamSpec {
  kind: 'stream'
  text: string
  chunkDelayMs?: number
  inputTokens?: number
  outputTokens?: number
}

export interface MockGenerateSpec {
  kind: 'generate'
  text: string
  inputTokens?: number
  outputTokens?: number
}

export interface MockErrorSpec {
  kind: 'error'
  error: Error
}

export type MockSpec = MockStreamSpec | MockGenerateSpec | MockErrorSpec

// ── Internal helpers ──────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN))

function makeV3Usage(
  inputTokens: number,
  outputTokens: number,
): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

function makeFinishReason(): LanguageModelV3GenerateResult['finishReason'] {
  return { unified: 'stop', raw: 'stop' }
}

/**
 * Build a V3-compliant ReadableStream for a text response.
 * Splits into ~30-char chunks to simulate realistic token streaming.
 */
function textToStream(
  text: string,
  opts: { chunkDelayMs?: number; inputTokens?: number; outputTokens?: number } = {},
): Pick<Awaited<ReturnType<LanguageModelV3CallOptions['doStream'] extends unknown ? never : never>>,
  never> & { stream: ReadableStream<LanguageModelV3StreamPart> } {
  const CHUNK_SIZE = 30
  const textId = 'text_0'
  const inTokens = opts.inputTokens ?? 100
  const outTokens = opts.outputTokens ?? estimateTokens(text)

  const parts: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'response-metadata', id: 'mock-response', modelId: 'mock-llm', timestamp: new Date() },
    { type: 'text-start', id: textId },
  ]

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    parts.push({ type: 'text-delta', id: textId, delta: text.slice(i, i + CHUNK_SIZE) })
  }

  parts.push({ type: 'text-end', id: textId })
  parts.push({
    type: 'finish',
    finishReason: makeFinishReason(),
    usage: makeV3Usage(inTokens, outTokens),
  })

  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      chunks: parts,
      chunkDelayInMs: opts.chunkDelayMs ?? null,
    }),
  }
}

/** Build a V3-compliant doGenerate result for a text response. */
function textToGenerateResult(
  text: string,
  opts: { inputTokens?: number; outputTokens?: number } = {},
): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: makeFinishReason(),
    usage: makeV3Usage(opts.inputTokens ?? 50, opts.outputTokens ?? estimateTokens(text)),
  }
}

/** Build an error stream (single error part). */
function errorToStream(error: Error): { stream: ReadableStream<LanguageModelV3StreamPart> } {
  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      chunks: [{ type: 'error', error }],
    }),
  }
}

// ── MockLLM ───────────────────────────────────────────────────────────────────

/**
 * Fluent mock for the AI SDK's LanguageModel interface.
 *
 * Maintains two independent FIFO queues:
 *  - streamQueue  → consumed by `doStream`  (streamText calls in the main cycle)
 *  - generateQueue → consumed by `doGenerate` (generateText calls in the Analyzer)
 *
 * Both queues throw if exhausted — failing fast is better than silently looping.
 */
export class MockLLM {
  private streamQueue: (MockStreamSpec | MockErrorSpec)[] = []
  private generateQueue: (MockGenerateSpec | MockErrorSpec)[] = []
  private _underlying: MockLanguageModelV3 | null = null

  // ── Stream queue (main LLM cycle) ───────────────────────────────────────

  /** Queue TypeScript code to be returned by the next streamText() call. */
  queueCode(
    code: string,
    opts: { comment?: string; chunkDelayMs?: number; inputTokens?: number; outputTokens?: number } = {},
  ): this {
    const text = opts.comment ? `// ${opts.comment}\n${code}` : code
    this.streamQueue.push({ kind: 'stream', text, chunkDelayMs: opts.chunkDelayMs, inputTokens: opts.inputTokens, outputTokens: opts.outputTokens })
    return this
  }

  /** Queue arbitrary text to be returned by the next streamText() call. */
  queueText(
    text: string,
    opts: { chunkDelayMs?: number; inputTokens?: number; outputTokens?: number } = {},
  ): this {
    this.streamQueue.push({ kind: 'stream', text, ...opts })
    return this
  }

  /**
   * Queue code that ends with `inspect()`.
   * This is the primary yield primitive in the session loop.
   */
  queueInspect(code: string, comment?: string): this {
    const lines: string[] = []
    if (comment) lines.push(`// ${comment}`)
    lines.push(code.trimEnd())
    lines.push('inspect()')
    return this.queueText(lines.join('\n'))
  }

  /**
   * Queue code that calls display() to render a JSX block in the UI.
   * Pass a pre-serialized JSX string (e.g. '<p>Hello</p>').
   */
  queueDisplay(jsxString: string, comment?: string): this {
    const code = `display(${jsxString})`
    return this.queueCode(code, { comment })
  }

  /**
   * Queue code that calls ask() to render an interactive form.
   */
  queueAsk(jsxString: string, variableName = '_userInput', comment?: string): this {
    const code = `const ${variableName} = await ask(${jsxString})\ninspect(${variableName})`
    return this.queueCode(code, { comment })
  }

  /** Queue an API error for the next streamText() call. */
  queueStreamError(error: Error | string): this {
    this.streamQueue.push({
      kind: 'error',
      error: typeof error === 'string' ? new Error(error) : error,
    })
    return this
  }

  // ── Generate queue (Analyzer) ───────────────────────────────────────────

  /**
   * Queue an AnalyzerResult for the next generateText() call (XS model).
   * Defaults to a "simple, no planning needed" result.
   */
  queueAnalysis(result: Partial<AnalyzerResult> = {}): this {
    const full: AnalyzerResult = {
      difficulty: 'simple',
      skip_planner: true,
      estimated_tasks: 1,
      needs_fork: false,
      needs_ask: false,
      rationale: 'Simple one-step task.',
      ...result,
    }
    this.generateQueue.push({ kind: 'generate', text: JSON.stringify(full) })
    return this
  }

  /** Queue raw text for the next generateText() call. */
  queueGenerate(text: string, opts: { inputTokens?: number; outputTokens?: number } = {}): this {
    this.generateQueue.push({ kind: 'generate', text, ...opts })
    return this
  }

  /** Queue an API error for the next generateText() call. */
  queueGenerateError(error: Error | string): this {
    this.generateQueue.push({
      kind: 'error',
      error: typeof error === 'string' ? new Error(error) : error,
    })
    return this
  }

  // ── Convenience ──────────────────────────────────────────────────────────

  /**
   * Fill the queues with enough idle responses for n cycles.
   * Each cycle gets: 1 analysis + 1 "no-op" code response.
   */
  autoFill(cycles = 10): this {
    for (let i = 0; i < cycles; i++) {
      this.queueAnalysis()
      this.queueCode(`// cycle ${i + 1}\n`, { comment: `cycle ${i + 1}` })
    }
    return this
  }

  /** Flush and reset both queues. */
  reset(): this {
    this.streamQueue = []
    this.generateQueue = []
    return this
  }

  // ── Model build ───────────────────────────────────────────────────────────

  /**
   * Build and return a LanguageModel that consumes the queued responses.
   * Call once per test; the model is stateful (it tracks calls).
   */
  build(): LanguageModel {
    const self = this

    this._underlying = new MockLanguageModelV3({
      provider: 'mock',
      modelId: 'mock-llm',

      doGenerate: async () => {
        const spec = self.dequeueGenerate()
        if (spec.kind === 'error') throw spec.error
        return textToGenerateResult(spec.text, {
          inputTokens: spec.inputTokens,
          outputTokens: spec.outputTokens,
        })
      },

      doStream: async () => {
        const spec = self.dequeueStream()
        if (spec.kind === 'error') return errorToStream(spec.error)
        return textToStream(spec.text, {
          chunkDelayMs: spec.chunkDelayMs,
          inputTokens: spec.inputTokens,
          outputTokens: spec.outputTokens,
        })
      },
    })

    return this._underlying as unknown as LanguageModel
  }

  // ── Call inspection ───────────────────────────────────────────────────────

  /** All doStream call options recorded (each = one LLM cycle). */
  get streamCalls(): LanguageModelV3CallOptions[] {
    return this._underlying?.doStreamCalls ?? []
  }

  /** All doGenerate call options recorded (each = one Analyzer call). */
  get generateCalls(): LanguageModelV3CallOptions[] {
    return this._underlying?.doGenerateCalls ?? []
  }

  /** The most recent doStream call. */
  get lastStreamCall(): LanguageModelV3CallOptions | undefined {
    return this.streamCalls[this.streamCalls.length - 1]
  }

  /** The most recent doGenerate call. */
  get lastGenerateCall(): LanguageModelV3CallOptions | undefined {
    return this.generateCalls[this.generateCalls.length - 1]
  }

  /**
   * Extract the system prompt from the last doStream call.
   * Useful for asserting what context was passed to the model.
   */
  get lastSystemPrompt(): string | undefined {
    const call = this.lastStreamCall
    if (!call) return undefined
    // AI SDK v3 passes the system via the prompt array or as a separate field
    const msgs = call.prompt
    const systemMsg = msgs.find((m) => m.role === 'system')
    if (systemMsg?.role === 'system') {
      const c = systemMsg.content
      return typeof c === 'string' ? c : JSON.stringify(c)
    }
    return undefined
  }

  /**
   * Extract the user message text from the last doStream call.
   */
  get lastUserPrompt(): string | undefined {
    const call = this.lastStreamCall
    if (!call) return undefined
    const msgs = call.prompt
    const userMsg = msgs.findLast((m) => m.role === 'user')
    if (!userMsg || userMsg.role !== 'user') return undefined
    const content = userMsg.content
    if (typeof content === 'string') return content
    const textPart = content.find((p) => p.type === 'text')
    return textPart && 'text' in textPart ? textPart.text : undefined
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private dequeueStream(): MockStreamSpec | MockErrorSpec {
    const spec = this.streamQueue.shift()
    if (!spec) {
      throw new Error(
        `MockLLM: stream queue exhausted — call queueCode()/queueText() to add more responses.\n` +
          `Recorded stream calls so far: ${this.streamCalls.length}`,
      )
    }
    return spec
  }

  private dequeueGenerate(): MockGenerateSpec | MockErrorSpec {
    const spec = this.generateQueue.shift()
    if (!spec) {
      throw new Error(
        `MockLLM: generate queue exhausted — call queueAnalysis()/queueGenerate() to add more responses.\n` +
          `Recorded generate calls so far: ${this.generateCalls.length}`,
      )
    }
    return spec
  }
}

// ── Factory helpers ───────────────────────────────────────────────────────────

/** Quick factory: one analysis + one code response for a single-cycle test. */
export function singleCycleMock(code: string, opts: { analysis?: Partial<AnalyzerResult> } = {}): MockLLM {
  return new MockLLM().queueAnalysis(opts.analysis).queueCode(code)
}

/** Quick factory: n cycles of analysis + code for multi-cycle tests. */
export function multiCycleMock(cycles: Array<{ code: string; analysis?: Partial<AnalyzerResult> }>): MockLLM {
  const mock = new MockLLM()
  for (const cycle of cycles) {
    mock.queueAnalysis(cycle.analysis).queueCode(cycle.code)
  }
  return mock
}

/** Quick factory: one analysis + code that calls inspect(). */
export function inspectMock(code: string, comment?: string): MockLLM {
  return new MockLLM().queueAnalysis().queueInspect(code, comment)
}
