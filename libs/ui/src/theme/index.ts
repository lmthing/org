export { applyTheme, initTheme, currentTheme, useTheme, applyThemeTokens } from './theme';
export type { ThemeName } from './theme';

// The theme context every `Prim.*` primitive requires. Any host rendering a `@lmthing/ui` component
// must mount this at its root — without it the whole app error-boundaries. See `./provider`.
export { UiThemeProvider } from './provider';
export { tamaguiConfig } from './tamagui.config';
