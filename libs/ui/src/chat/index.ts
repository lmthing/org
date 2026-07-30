// @lmthing/ui — chat surface public API
export { useReplSession } from './client/useReplSession';
export { ReplRpcClient } from './client/rpc-client';
export type { ReplClientConfig } from './client/rpc-client';
export { DisplayBlock } from './components/DisplayBlock';
// The one descriptor renderer. Exported so every surface that receives an
// agent's JSX — the transcript, the team channels, an embedded panel — draws it
// the same way instead of growing a second, smaller switch of its own.
export { renderDescriptor, isDescriptor, toRenderableDescriptor } from './components/render-descriptor';
export type { Descriptor } from './components/render-descriptor';
export { AskBlock } from './components/AskBlock';
export { ConsentCard, isConsentDescriptor, consentPropsFromDescriptor } from './components/ConsentCard';
export { VariablesBlock } from './components/VariablesBlock';
export type { ReplBlock } from './client/useReplSession';
export { AgentChatPanel } from './components/AgentChatPanel';
export type { AgentChatPanelProps, SessionTarget } from './components/AgentChatPanel';
export { ReplChatView } from './components/ReplChatView';
export type { ReplChatViewProps } from './components/ReplChatView';
export { ChatShell } from './app/ChatShell';
export { getAccessToken, authHeaders, wsTokenSuffix, withAuthToken } from './app/auth';
// The same slide-over `AppShell` uses for its mobile sidebar. Exported so a host that has to
// supply its own (the mobile app, for the two surfaces that have no sidebar to hang one off)
// gets the identical overlay, dismiss handling and back-gesture wiring rather than a second one.
export { Drawer } from './components/ui/Drawer';

// Design system: Ink-compatibility layer + theming
export * as compat from './compat/index';
export { applyTheme, initTheme, currentTheme, useTheme, applyThemeTokens } from '../theme/theme';
export type { ThemeName } from '../theme/theme';
