/**
 * A {@link SessionLike} backed by an embedded DeepSeek Harness runtime.
 *
 * One `DshSession` owns one dsh `Context` for its lifetime. `start()` boots the
 * runtime, creates a dsh agent (its persona/tools installed in the `setup` hook
 * from the lmthing agent definition), subscribes the {@link createDshTraceBridge}
 * to that session's events so the turn renders in the lmthing UI, sends the user
 * message, and awaits idle. `continue()` sends a follow-up on the same agent.
 *
 * The LLM adapter is injected (`createAdapter`) rather than bridged from lmthing's
 * text-only `streamFn`: dsh Code Mode needs a provider that emits native
 * `run_code` tool-call blocks, which a text stream cannot express. A pod wires
 * its model/key into a dsh adapter here; tests inject a keyless mock.
 */

import { Tracer } from '@lmthing/core';
import type { UserInput } from '@lmthing/core';
import type { SessionLike } from '../session-manager.js';
import { createDshTraceBridge, type DshSessionEvent } from './event-bridge.js';
import {
  loadDshModules,
  type DshModules,
  type DshContext,
  type DshAgentHandle,
  type DshLlmSetup,
} from './modules.js';

/** Turn an lmthing {@link UserInput} into the plain text dsh receives. */
function inputText(message: UserInput): string {
  if (typeof message === 'string') return message;
  const m = message as { text?: unknown };
  return typeof m?.text === 'string' ? m.text : '';
}

export interface DshSessionOpts {
  sessionId: string;
  /** System prompt for the agent (from the lmthing agent's charter+instruct). */
  persona?: string;
  /** Turn on dsh Code Mode (mounts the worker-thread code runtime). */
  codeMode?: boolean;
  cwd?: string;
  /** Where the built dsh checkout lives (defaults to `LMTHING_DSH_HOME`). */
  dshHome?: string;
  /** Wires the LLM provider onto the booted Context and names the route/model to
   *  run on. Required — dsh needs a native-tool-calling provider; pods point
   *  llm-deepseek at LiteLLM, tests inject a keyless mock. */
  llm: DshLlmSetup;
}

export class DshSession implements SessionLike {
  private readonly tracer = new Tracer(null);
  private readonly opts: DshSessionOpts;
  private ctx?: DshContext;
  private handle?: DshAgentHandle;
  private offBridge?: () => void;
  private disposed = false;

  constructor(opts: DshSessionOpts) {
    this.opts = opts;
  }

  getTracer(): Tracer {
    return this.tracer;
  }

  getHistory(): ReturnType<import('@lmthing/core').Session['getHistory']> {
    // dsh keeps its own append-only session log; lmthing-format history is not
    // reconstructed in this MVP. Snapshot/summarize paths that read this get an
    // empty history rather than a wrong one.
    return [];
  }

  getRootNodeId(): string {
    return this.opts.sessionId;
  }

  async start(message: UserInput): Promise<void> {
    await this.boot();
    await this.runTurn(message);
  }

  async continue(message: UserInput): Promise<void> {
    if (!this.handle) {
      await this.boot();
    }
    await this.runTurn(message);
  }

  async resume(_snapshotDir: string, message: UserInput): Promise<void> {
    // dsh persistence/resume is not wired in this MVP; start a fresh runtime.
    await this.start(message);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offBridge?.();
    // dsh teardown is async; run it best-effort without blocking the sync API.
    const handle = this.handle;
    const ctx = this.ctx;
    void (async () => {
      try {
        await handle?.dispose();
      } catch {
        /* teardown best-effort */
      }
      try {
        await ctx?.fiber.dispose();
      } catch {
        /* teardown best-effort */
      }
    })();
    this.handle = undefined;
    this.ctx = undefined;
  }

  /** Boot the dsh Context and create the agent (once). */
  private async boot(): Promise<void> {
    if (this.handle) return;
    const dsh = await loadDshModules(this.opts.dshHome);

    const ctx = new dsh.Context();
    await ctx.plugin(dsh.LlmRuntime);
    await ctx.plugin(dsh.SessionStore);
    await ctx.plugin(dsh.SystemPrompt, { persona: '' });
    await ctx.plugin(dsh.ToolRuntime, this.opts.codeMode ? { mode: 'code' } : {});
    if (this.opts.codeMode) await ctx.plugin(dsh.CodeRuntimeWorker, {});
    await ctx.plugin(dsh.AgentRegistry);
    await ctx.plugin(dsh.AgentLoop, { agents: [] });
    const { provider, model } = await this.opts.llm.configure(ctx, dsh);

    // Bridge this session's dsh events onto our Tracer for the lmthing UI.
    const bridge = createDshTraceBridge(this.tracer, { context: 'session', nodeId: this.opts.sessionId });
    this.offBridge = ctx.on('session/event', (...args: unknown[]) => {
      const [, event] = args as [unknown, DshSessionEvent];
      if (event && typeof event.type === 'string') bridge(event);
    });

    const persona = this.opts.persona;
    this.handle = await ctx.agents.create({
      sessionId: dsh.SessionId(this.opts.sessionId),
      meta: { cwd: this.opts.cwd ?? process.cwd() },
      agentOptions: { provider, model },
      setup: (agentCtx) => {
        if (persona && persona.trim().length > 0) {
          agentCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: persona, complete: true });
        }
      },
    });
    this.ctx = ctx;
    this.createUserMessage = dsh.createUserMessage;
  }

  private createUserMessage?: DshModules['createUserMessage'];

  private async runTurn(message: UserInput): Promise<void> {
    if (!this.handle || !this.createUserMessage) throw new Error('dsh session not booted');
    const msg = this.createUserMessage({ content: [{ type: 'text', text: inputText(message) }], source: { kind: 'user' } });
    this.handle.agent.followup(msg);
    await this.handle.agent.whenIdle();
  }
}

/**
 * A keyless {@link DshLlmSetup} that answers every turn with `answer` as one text
 * block. Registers a mock adapter under the `mock` provider route. Used by the
 * live integration test to drive a real dsh turn end-to-end without a key.
 */
export function mockAnswerSetup(answer: string): DshLlmSetup {
  return {
    configure: async (ctx, dsh) => {
      const Base = dsh.LlmAdapter as unknown as new () => Record<string, unknown>;
      class MockAdapter extends Base {
        async *stream(): AsyncIterable<Record<string, unknown>> {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: answer };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
      }
      ctx.llm.registerAdapter(['mock'], new MockAdapter());
      return { provider: 'mock', model: 'mock' };
    },
  };
}
