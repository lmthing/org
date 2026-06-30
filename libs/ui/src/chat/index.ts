// @lmthing/ui — chat surface public API
export { useReplSession } from './client/useReplSession.js';
export { ReplRpcClient } from './client/rpc-client.js';
export type { ReplClientConfig } from './client/rpc-client.js';
export { DisplayBlock } from './components/DisplayBlock.js';
export { AskBlock } from './components/AskBlock.js';
export { VariablesBlock } from './components/VariablesBlock.js';
export type { ReplBlock } from './client/useReplSession.js';
export { AgentChatPanel } from './components/AgentChatPanel.js';
export type { AgentChatPanelProps, SessionTarget } from './components/AgentChatPanel.js';
export { ChatShell } from './app/ChatShell.js';

// Design system: Ink-compatibility layer + theming
export * as compat from './compat/index.js';
export { applyTheme, initTheme, currentTheme, useTheme, applyThemeTokens } from '../theme/theme.js';
export type { ThemeName } from '../theme/theme.js';
