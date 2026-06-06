# execShell result missing exitCode field

## Summary

`execShell()` returns `{ ok, stdout, stderr }` but models expect an `exitCode` field to distinguish between different non-zero exit codes. When the model tries `execResult.exitCode`, it gets a typecheck error.

## Impact

The model can't tell the difference between "command not found" (127), "permission denied" (126), or a test failure (1). It must rely solely on `ok` (boolean) and `stderr` (string), which loses information.

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  "Write a test file and run it with execShell. Check the exitCode of the result."
```

Error: `Property 'exitCode' does not exist on type '{ ok: boolean; stdout: string; stderr: string; }'.`

## Fix

Add `exitCode` to the return type:

```ts
// host-tools.ts
setGlobal('execShell', (cmd: string) => {
  try {
    const result = execSync(cmd, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    return { ok: true, stdout: result.toString(), stderr: '', exitCode: 0 };
  } catch (e) {
    const err = e as { message?: string; stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? String(e),
      exitCode: err.status ?? 1,
    };
  }
});
```

And update the typecheck declaration in `library-dts.ts`:
```diff
-declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string };
+declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string; exitCode: number };
```

## Location

- Implementation: `packages/core/src/globals/host-tools.ts:79-91`
- Type declaration: `packages/core/src/typecheck/library-dts.ts:56`
