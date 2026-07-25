/**
 * Ink compatibility barrel. Authors can `import { Box, Text, TextInput } from
 * '@lmthing/agent-ui/compat'`; the web bundler also aliases bare `ink` /
 * `ink-text-input` / `ink-select-input` imports here so Ink-flavored source
 * runs in the browser unchanged. Everything is themed via `--lm-*` CSS vars.
 */
export * from './ink';
export * from './inputs';
export { default as TextInput } from './inputs';
