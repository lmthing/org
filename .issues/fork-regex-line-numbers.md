# Fork subagent regex analysis fails due to readFile line numbers in .content

## Summary

Fork subagents that read files and perform regex analysis (e.g., finding exported functions) get wrong results because `readFile().content` has `1\t`, `2\t` line number prefixes that break line-start patterns.

## Impact

A fork subagent reading `packages/core/src/globals/host-tools.ts` and searching for `^\s*export\s+(async\s+)?function\s+(\w+)` found **0 functions** because lines start with `1\timport...` instead of `import...`. The `\s*` matches the tab but not the leading digit+tab.

Subagents don't know to use `.raw` instead of `.content` because the tool summary truncates the `raw` explanation (see `tool-jsdoc-truncation.md`).

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  "Use fork({ role: 'explore', instruction: 'Read packages/core/src/globals/host-tools.ts (first 60 lines) and list the exported functions by regex', output: { summary: 'string' } })"
```

Fork returns `"Host primitive functions in ...: "` (empty list).

## Fix

Coupled with the JSDoc truncation fix — if subagents see the `raw` field documented, they'll use it for regex analysis. Alternatively, the fork preamble could instruct: "Use `readFile().raw` for regex/text analysis; use `.content` only for display."

## Location

- Fork role prompts: `packages/core/src/fork/roles.ts`
- readFile implementation: `packages/core/system-spaces/fs/functions/readFile.ts`
