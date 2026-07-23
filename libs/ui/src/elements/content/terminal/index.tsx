// Platform seam for the xterm terminal (web-only widget, §1.6).
//
// This default module re-exports the WEB implementation, so bundlers without platform resolution
// (Vite) get xterm. React Native's Metro resolves `./index` to `index.native.tsx` first (the
// <UnavailableOnMobile> fallback), so it never sees @xterm/*. Keeping this file a pure re-export
// mirrors the Monaco `ide-editor.tsx` seam.
//
// See docs/react-native-tamagui-migration.md §1.6 / §7.
export { Terminal } from './index.web'
export type { TerminalProps, TerminalSession } from './index.web'
