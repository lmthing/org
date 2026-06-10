import type { LanguageModelV1 } from 'ai';

/**
 * Parse a "provider:modelId" spec and lazy-load the appropriate @ai-sdk/* provider.
 * Supported: openai, anthropic, google, mistral, azure.
 *
 * Azure requires AZURE_API_KEY and AZURE_RESOURCE_NAME env vars.
 * azure:modelId maps to the deployment name on the configured Azure resource.
 *
 * Custom OpenAI-compatible providers: set <NAME>_API_TYPE=openai and <NAME>_BASE_URL=<url>
 * where <NAME> is the provider portion uppercased (e.g. groq:llama3 → GROQ_API_TYPE, GROQ_BASE_URL).
 * <NAME>_API_KEY is optional.
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
    default: {
      const envKey = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const apiType = process.env[`${envKey}_API_TYPE`];
      if (apiType === 'openai') {
        const baseURL = process.env[`${envKey}_BASE_URL`];
        if (!baseURL) {
          throw new Error(`${envKey}_BASE_URL env var is required for custom provider "${provider}"`);
        }
        const apiKey = process.env[`${envKey}_API_KEY`];
        const { createOpenAI } = await import('@ai-sdk/openai');
        return createOpenAI({ baseURL, ...(apiKey ? { apiKey } : {}) })(modelId) as unknown as LanguageModelV1;
      }
      throw new Error(
        `Unsupported provider "${provider}": supported providers are openai, anthropic, google, mistral, azure. ` +
        `To use a custom OpenAI-compatible provider, set ${envKey}_API_TYPE=openai and ${envKey}_BASE_URL=<url>.`,
      );
    }
  }
}
