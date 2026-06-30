/**
 * Resolve a model alias to a full model spec.
 * Checks process.env["LM_MODEL_" + alias.toUpperCase()] first,
 * then falls back to returning the alias itself.
 */
export function resolveAlias(alias: string): string {
  const envKey = 'LM_MODEL_' + alias.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  return alias;
}
