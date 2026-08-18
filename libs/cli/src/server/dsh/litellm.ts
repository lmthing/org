/**
 * LiteLLM provider wiring for the dsh harness.
 *
 * dsh Code Mode needs a native tool-calling provider, and lmthing already routes
 * its models through the LiteLLM gateway (`cloud/`), an OpenAI-compatible
 * `/chat/completions` endpoint. dsh's own `llm-deepseek` adapter speaks exactly
 * that wire format with a configurable `baseURL`/`apiKeyEnv`, so we reuse it
 * (already tested upstream) rather than hand-rolling an OpenAI client — pointing
 * it at the LiteLLM base URL + the pod's key.
 *
 * Endpoint + key mirror lmthing's own provider resolution (`providers/resolve.ts`):
 * `LMTHINGCLOUD_BASE_URL` (default `https://lmthing.cloud/v1`) and
 * `LMTHINGCLOUD_API_KEY`.
 */

import type { DshLlmSetup } from './modules.js';

export interface LiteLlmOpts {
  /** The LiteLLM `model_name` the agent runs on (e.g. `DeepSeek-V4-Flash`). */
  model: string;
  /** OpenAI-compatible base URL; defaults to `LMTHINGCLOUD_BASE_URL` then the public gateway. */
  baseUrl?: string;
  /** Env var holding the LiteLLM key; defaults to `LMTHINGCLOUD_API_KEY`. */
  apiKeyEnv?: string;
  /** Advisory context window for the model catalog entry. */
  contextWindow?: number;
}

export interface LiteLlmDeepseekConfig {
  baseURL: string;
  apiKeyEnv: string;
  models: Array<{ id: string; name: string; contextWindow: number }>;
}

/** The provider route `llm-deepseek` registers under. */
export const LITELLM_PROVIDER = 'deepseek-official';

/** Build the `llm-deepseek` plugin config for a LiteLLM endpoint. Pure, so the
 *  env/default resolution and the catalog entry are unit-testable without dsh. */
export function liteLlmDeepseekConfig(opts: LiteLlmOpts, env: NodeJS.ProcessEnv = process.env): LiteLlmDeepseekConfig {
  const baseURL = opts.baseUrl ?? env['LMTHINGCLOUD_BASE_URL'] ?? 'https://lmthing.cloud/v1';
  const apiKeyEnv = opts.apiKeyEnv ?? 'LMTHINGCLOUD_API_KEY';
  const contextWindow = opts.contextWindow ?? 1_000_000;
  return { baseURL, apiKeyEnv, models: [{ id: opts.model, name: opts.model, contextWindow }] };
}

/** A {@link DshLlmSetup} that mounts dsh's `llm-deepseek` provider against the
 *  LiteLLM gateway and runs the agent on `opts.model`. */
export function createLiteLlmSetup(opts: LiteLlmOpts): DshLlmSetup {
  return {
    configure: async (ctx, dsh) => {
      await ctx.plugin(dsh.LlmDeepseek, liteLlmDeepseekConfig(opts));
      return { provider: LITELLM_PROVIDER, model: opts.model };
    },
  };
}
