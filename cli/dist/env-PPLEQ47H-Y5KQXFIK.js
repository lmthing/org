// ../repl/dist/env-PPLEQ47H.js
var SECRET_PATTERNS = [/_KEY$/, /_SECRET$/, /_TOKEN$/, /_PASSWORD$/, /^PASSWORD$/, /^SECRET$/];
var DEFAULT_ALLOW = ["HOME", "USER", "PATH", "LANG", "TERM", "SHELL", "EDITOR", "NODE_ENV"];
var ALLOW_PREFIXES = ["LMTHING_"];
var customAllowlist = null;
function setEnvAllowlist(names) {
  customAllowlist = new Set(names);
}
function isAllowed(key) {
  if (customAllowlist?.has(key)) return true;
  if (DEFAULT_ALLOW.includes(key)) return true;
  if (ALLOW_PREFIXES.some((p) => key.startsWith(p))) return true;
  if (SECRET_PATTERNS.some((p) => p.test(key))) return false;
  return false;
}
function getAllowedKeys() {
  return Object.keys(process.env).filter(isAllowed).sort();
}
var envModule = {
  id: "env",
  description: "Environment variable access (allowlisted)",
  functions: [
    {
      name: "getEnv",
      description: "Read environment variable (allowlisted only)",
      signature: "(key: string) => string | undefined",
      fn: (key) => {
        const k = key;
        if (!isAllowed(k)) {
          throw new Error(`Environment variable ${k} is not in the allowlist`);
        }
        return process.env[k];
      }
    },
    {
      name: "listEnv",
      description: "List available (allowlisted) variable names",
      signature: "() => string[]",
      fn: () => getAllowedKeys()
    }
  ]
};
var env_default = envModule;
export {
  env_default as default,
  setEnvAllowlist
};
