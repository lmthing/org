import type { LanguageModelV1 } from 'ai';

/**
 * Parse a "provider:modelId" spec and lazy-load the appropriate @ai-sdk/* provider.
 * Supported: openai, anthropic, google, mistral, azure, groq, cohere, bedrock, openai-compatible
 *
 * Azure requires AZURE_API_KEY and AZURE_RESOURCE_NAME env vars.
 * azure:modelId maps to the deployment name on the configured Azure resource.
 */
export async function resolveModel(modelSpec: string): Promise<LanguageModelV1> {
  const colonIdx = modelSpec.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `Invalid model spec "${modelSpec}": expected "provider:modelId" format`,
    );
  }

  const provider = modelSpec.slice(0, colonIdx).toLowerCase();
  const modelId = modelSpec.slice(colonIdx + 1);

  if (!modelId) {
    throw new Error(`Invalid model spec "${modelSpec}": model ID is empty`);
  }

  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI()(modelId) as unknown as LanguageModelV1;
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic()(modelId) as unknown as LanguageModelV1;
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI()(modelId) as unknown as LanguageModelV1;
    }
    case 'mistral': {
      const { createMistral } = await import('@ai-sdk/mistral');
      return createMistral()(modelId) as unknown as LanguageModelV1;
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure');
      const resourceName = process.env['AZURE_RESOURCE_NAME'];
      const apiKey = process.env['AZURE_API_KEY'];
      if (!resourceName) throw new Error('AZURE_RESOURCE_NAME env var is required for azure: provider');
      if (!apiKey) throw new Error('AZURE_API_KEY env var is required for azure: provider');
      const azure = createAzure({ resourceName, apiKey });
      return azure(modelId) as unknown as LanguageModelV1;
    }
    default:
      throw new Error(
        `Unsupported provider "${provider}": supported providers are openai, anthropic, google, mistral, azure`,
      );
  }
}
