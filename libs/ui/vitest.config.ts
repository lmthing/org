import { defineConfig } from 'vitest/config'

// libs/ui has its own vitest config (like libs/state): its component suites need jsdom +
// the React JSX transform the root node runner does not provide, so the root config excludes
// libs/ui and this runs via `pnpm --filter @lmthing/ui test`.
//
// Scope: the Phase-0 vocabulary primitives (elements/primitives/**) and the de-HTML parity
// proofs (*.parity.test.tsx — a migrated surface component rendered byte-identical to its
// pre-migration golden). The rest of libs/ui's co-located *.test.tsx suites depend on
// Radix/lucide/etc. peers that are not installed here; widening this include is follow-up
// work once those peers are added. See docs/react-native-tamagui-migration.md §1.5.
export default defineConfig({
  // Use esbuild's automatic JSX runtime (react/jsx-runtime) — no @vitejs/plugin-react needed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    include: ['src/elements/primitives/**/*.test.tsx', 'src/**/*.parity.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
