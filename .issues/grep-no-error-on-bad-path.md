# grep on nonexistent path silently returns { ok: true, matches: [] }

## Summary

When `grep()` is given a path that doesn't exist (file or directory), it returns `{ ok: true, matches: [] }` with no error. The agent has no way to distinguish "path doesn't exist" from "search term not found".

## Impact

The agent silently gets empty results for invalid paths. In a multi-step workflow, this means the agent proceeds with wrong assumptions (e.g., "no matches found" when the real issue is a typo in the path).

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  "Use grep to search for 'test' in the path /tmp/no-such-dir/. Display the result."
```

Output: `{"ok":true,"matches":[],"truncated":false}` — no error, no indication the directory doesn't exist.

## Root cause

The grep function uses `|| true` on both rg and grep fallback commands, which suppresses exit code 2 (error) from grep. It should check if the path exists before searching, or detect grep's "No such file or directory" stderr.

## Fix

Check stderr for error messages or verify the path exists before running the search:

```ts
// In the fallback section, after running grep:
if (!gr.ok && gr.stderr.includes('No such file')) {
  return { ok: false, matches: [], truncated: false, error: gr.stderr.trim() };
}
```

## Location

`packages/core/system-spaces/fs/functions/grep.ts` — the `|| true` patterns on lines 16 and 41.
