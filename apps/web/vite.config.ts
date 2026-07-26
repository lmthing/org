import { createViteConfig } from '@lmthing/utils/vite'

// `tailwind: false` — phase 4 of docs/tamagui-final-steps.md removed every Tailwind directive from
// this app's stylesheets, so the plugin has nothing to compile here, and `@tailwindcss/vite` is no
// longer a dependency of this app at all: the shared factory loads it lazily, inside the branch.
//
// The DEFAULT is `true` because the seven product SPAs share this factory and are NOT migrated: they
// still use `@apply` and utility classNames, and would render unstyled without it.
export default createViteConfig(__dirname, undefined, { tailwind: false })
