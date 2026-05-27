/**
 * AI Provider Registry for @lmthing/llm-repl-cli
 */

export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'azure'
  | 'groq'
  | 'cohere'
  | 'bedrock';

const providerLoaders: Record<ProviderName, () => Promise<any>> = {
  openai: () => import('./openai.js').then((m) => m.openai),
  anthropic: () => import('./anthropic.js').then((m) => m.anthropic),
  google: () => import('./google.js').then((m) => m.google),
  mistral: () => import('./mistral.js').then((m) => m.mistral),
  azure: () => import('./azure.js').then((m) => m.azure),
  groq: () => import('./groq.js').then((m) => m.groq),
  cohere: () => import('./cohere.js').then((m) => m.cohere),
  bedrock: () => import('./bedrock.js').then((m) => m.bedrock),
};

/**
 * Get a provider by name (dynamically imported)
 */
export async function getProvider(name: ProviderName) {
  return providerLoaders[name]();
}

/**
 * List all available provider names
 */
export function listProviders(): ProviderName[] {
  return Object.keys(providerLoaders) as ProviderName[];
}

/**
 * Model resolution utilities
 */
export { resolveModel, type ModelInput } from './resolver.js';

/**
 * Custom provider utilities
 */
export {
  scanCustomProviders,
  createCustomProvider,
  getCustomProviders,
  getCustomProvider,
  isCustomProvider,
  listCustomProviders,
  type CustomProviderConfig,
} from './custom.js';

/**
 * Provider errors
 */
export { ProviderError, ErrorCodes } from './errors.js';
