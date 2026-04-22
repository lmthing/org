// src/providers/factory.ts
function sanitizeEnvValue(value) {
  if (value === void 0) return void 0;
  let result = value.trim();
  let quoteChar = null;
  for (let i = 0; i < result.length; i += 1) {
    const char = result[i];
    if (char === '"' || char === "'") {
      if (!quoteChar) {
        quoteChar = char;
      } else if (quoteChar === char) {
        quoteChar = null;
      }
      continue;
    }
    if (char === "#" && !quoteChar) {
      const prevChar = i > 0 ? result[i - 1] : "";
      if (i === 0 || /\s/.test(prevChar)) {
        result = result.slice(0, i).trim();
        break;
      }
    }
  }
  if (result.startsWith('"') && result.endsWith('"') || result.startsWith("'") && result.endsWith("'")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}
function defineProvider(definition) {
  const { name, envKey, sdkFactory, mapConfig, models } = definition;
  const createProvider = (config) => {
    const baseConfig = {
      apiKey: config?.apiKey || sanitizeEnvValue(process.env[envKey]),
      baseURL: config?.baseURL
    };
    const finalConfig = mapConfig ? mapConfig({ ...baseConfig, ...config }) : baseConfig;
    return sdkFactory(finalConfig);
  };
  return {
    createProvider,
    provider: createProvider(),
    models
  };
}

export {
  defineProvider
};
