import { createViteConfig } from '@lmthing/utils/vite'

// `@tailwindcss/vite` stays a devDependency of this app even though nothing here uses Tailwind: the
// SHARED factory imports the plugin at module scope (it must, for the seven product SPAs that still
// need it), so the import has to resolve from every caller. Relying on pnpm hoisting for that would
// break on a clean install.
//
// `tailwind: false` — phase 4 of docs/tamagui-final-steps.md removed every Tailwind directive from
// this app's stylesheets, so the plugin has nothing to compile here. The DEFAULT is `true` because
// the seven product SPAs share this factory and are NOT migrated: they still use `@apply` and utility
// classNames, and would render unstyled without it.
export default createViteConfig(__dirname, undefined, { tailwind: false })
