// src/providers/custom.ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
function scanCustomProviders() {
  const configs = [];
  const processedPrefixes = /* @__PURE__ */ new Set();
  for (const key in process.env) {
    const match = key.match(/^([A-Z0-9_]+)_API_KEY$/);
    if (match) {
      const name = match[1];
      if (processedPrefixes.has(name)) {
        continue;
      }
      const builtInPrefixes = ["OPENAI", "ANTHROPIC", "GOOGLE_GENERATIVE_AI", "GOOGLE_VERTEX", "MISTRAL", "AZURE", "GROQ", "COHERE", "AWS"];
      if (builtInPrefixes.includes(name)) {
        continue;
      }
      const apiType = process.env[`${name}_API_TYPE`];
      if (apiType !== "openai") {
        continue;
      }
      const apiKey = process.env[key];
      const baseURL = process.env[`${name}_API_BASE`];
      const displayName = process.env[`${name}_API_NAME`] || name.toLowerCase();
      if (apiKey && baseURL) {
        configs.push({
          name: displayName,
          apiKey,
          baseURL,
          prefix: name
        });
        processedPrefixes.add(name);
      }
    }
  }
  return configs;
}
function createCustomProvider(config) {
  return createOpenAICompatible({
    name: config.name,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    queryParams: {
      "api-version": "1.0.0"
    }
  });
}
var customProvidersRegistry = null;
function getCustomProviders() {
  if (!customProvidersRegistry) {
    customProvidersRegistry = /* @__PURE__ */ new Map();
    const configs = scanCustomProviders();
    for (const config of configs) {
      const provider = createCustomProvider(config);
      customProvidersRegistry.set(config.name, provider);
    }
  }
  return customProvidersRegistry;
}
function isCustomProvider(name) {
  return getCustomProviders().has(name);
}
function getCustomProvider(name) {
  return getCustomProviders().get(name);
}
function listCustomProviders() {
  return Array.from(getCustomProviders().keys());
}

// src/providers/errors.ts
var ProviderError = class _ProviderError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ProviderError";
    Object.setPrototypeOf(this, _ProviderError.prototype);
  }
};
var ErrorCodes = {
  UNKNOWN_PROVIDER: "UNKNOWN_PROVIDER",
  MISSING_API_KEY: "MISSING_API_KEY",
  MISSING_API_BASE: "MISSING_API_BASE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED"
};

// src/providers/resolver.ts
var BUILT_IN_PROVIDER_NAMES = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "azure",
  "groq",
  "cohere",
  "bedrock"
];
var builtInProviderLoaders = {
  openai: async () => (await import("./openai-GPSFBN42.js")).openai,
  anthropic: async () => (await import("./anthropic-WRAZ7O65.js")).anthropic,
  google: async () => (await import("./google-QAGNCIN7.js")).google,
  mistral: async () => (await import("./mistral-AT3W67JB.js")).mistral,
  azure: async () => (await import("./azure-2JCOJZLW.js")).azure,
  groq: async () => (await import("./groq-EMINUXAO.js")).groq,
  cohere: async () => (await import("./cohere-V2T5Z2PE.js")).cohere,
  bedrock: async () => (await import("./bedrock-HP6KGZMQ.js")).bedrock
};
function isBuiltInProvider(name) {
  return Object.hasOwn(builtInProviderLoaders, name);
}
function createLazyBuiltInModel(providerName, modelId) {
  let modelPromise;
  const getModel = async () => {
    if (!modelPromise) {
      modelPromise = builtInProviderLoaders[providerName]().then((provider) => provider(modelId));
    }
    return modelPromise;
  };
  return {
    specificationVersion: "v3",
    provider: providerName,
    modelId,
    supportedUrls: getModel().then((model) => model.supportedUrls),
    doGenerate: async (options) => {
      const model = await getModel();
      return model.doGenerate(options);
    },
    doStream: async (options) => {
      const model = await getModel();
      return model.doStream(options);
    }
  };
}
function resolveModel(model) {
  if (typeof model !== "string") {
    return model;
  }
  const colonIndex = model.indexOf(":");
  if (colonIndex === -1) {
    const aliasKey = `LM_MODEL_${model.toUpperCase()}`;
    const aliasValue = process.env[aliasKey];
    if (aliasValue) {
      return resolveModel(aliasValue);
    }
    throw new ProviderError(
      `Model alias "${model}" not found. Please set the environment variable ${aliasKey} (e.g., ${aliasKey}=openai:gpt-4o)`,
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      { alias: model, envVar: aliasKey }
    );
  }
  const providerName = model.slice(0, colonIndex);
  const modelId = model.slice(colonIndex + 1);
  if (isBuiltInProvider(providerName)) {
    return createLazyBuiltInModel(providerName, modelId);
  }
  if (isCustomProvider(providerName)) {
    const customProvider = getCustomProvider(providerName);
    if (customProvider) {
      return customProvider(modelId);
    }
  }
  const builtInProviders = BUILT_IN_PROVIDER_NAMES;
  const customProviders = listCustomProviders();
  const allProviders = [...builtInProviders, ...customProviders];
  throw new ProviderError(
    `Unknown provider: "${providerName}". Available providers: ${allProviders.join(", ")}`,
    ErrorCodes.UNKNOWN_PROVIDER,
    { provider: providerName, available: allProviders }
  );
}
export {
  resolveModel
};
