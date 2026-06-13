// @repl/ui — React web component surface + client hook
export { useReplSession } from './client/useReplSession.js';
export { ReplRpcClient } from './client/rpc-client.js';
export { DisplayBlock } from './components/DisplayBlock.js';
export { AskBlock } from './components/AskBlock.js';
export { VariablesBlock } from './components/VariablesBlock.js';
export type { ReplBlock } from './client/useReplSession.js';

// Design system: Ink-compatibility layer + theming
export * as compat from './compat/index.js';
export { applyTheme, initTheme, currentTheme, useTheme, applyThemeTokens } from './theme/theme.js';
export type { ThemeName } from './theme/theme.js';
