# execShell 30s timeout too short for first-run npm/npx commands

## Summary

`execShell` has a 30-second timeout. Commands like `npx tsx` or `npm install` that need to download packages on first run exceed this limit and get killed.

## Impact

Code generation + execution workflows (write file → run tests) fail on the first attempt because `npx tsx` needs to download the tsx package. The second attempt succeeds because the package is cached.

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  "Write a TypeScript file at /tmp/test.ts with console.log('hello'), then run execShell('npx tsx /tmp/test.ts')"
```

First run: `[execShell error] spawnSync /bin/sh ETIMEDOUT`
Second run (same session): succeeds

## Fix options

- Increase the default timeout (e.g., 60s or 120s)
- Allow per-call timeout override: `execShell(cmd, { timeout: 60000 })`
- Only increase for commands starting with `npm`, `npx`, `pnpm`, `yarn`

## Location

`packages/core/src/globals/host-tools.ts:84` — `execSync(cmd, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 })`
