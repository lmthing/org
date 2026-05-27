/**
 * Model resolution — resolves an LM_MODEL_<ALIAS>
 * env var to an `ai`-SDK LanguageModel. Lazy-imports the right provider SDK.
 */
import type { LanguageModel } from "ai";

export type ModelAlias = "XS" | "S" | "M" | "M_R" | "L" | "L_R";

export async function resolveLLM(alias: ModelAlias): Promise<LanguageModel> {
  const raw = process.env[`LM_MODEL_${alias}`];
  if (!raw) {
    throw new Error(`LM_MODEL_${alias} is not set in env`);
  }
  const sep = raw.indexOf(":");
  if (sep < 0) throw new Error(`LM_MODEL_${alias}="${raw}" — expected "provider:modelId"`);
  const provider = raw.slice(0, sep);
  const modelId = raw.slice(sep + 1);

  switch (provider) {
    case "azure": {
      const { createAzure } = await import("@ai-sdk/azure");
      const az = createAzure({
        apiKey: process.env.AZURE_API_KEY,
        resourceName: process.env.AZURE_RESOURCE_NAME,
      });
      return az.chat(modelId) as unknown as LanguageModel;
    }
    case "anthropic": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return anthropic(modelId) as unknown as LanguageModel;
    }
    case "openai": {
      const { openai } = await import("@ai-sdk/openai");
      return openai(modelId) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unsupported provider in LM_MODEL_${alias}: ${provider}`);
  }
}
