// Platform seam for the Monaco code editor (web-only widget, §1.6).
//
// This default module re-exports the WEB implementation, so bundlers without platform
// resolution (Vite) get Monaco. React Native's Metro resolves `./ide-editor` to
// `ide-editor.native.tsx` first (the <UnavailableOnMobile> fallback), so it never sees Monaco.
// Keeping this file a pure re-export means it has no raw host tags and stays RN-safe-lint clean.
//
// See docs/react-native-tamagui-migration.md §1.6.
export { IdeEditor } from './ide-editor.web'
export type { IdeEditorProps } from './ide-editor.web'
