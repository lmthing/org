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
    include: [
      'src/elements/primitives/**/*.test.tsx',
      'src/elements/overlays/**/*.test.tsx',
      // P2 — the BEM→styled() variant conversions (elements/**/*-styled.test.tsx). See §4. Covers
      // every leaf slice: forms (button/input/select/textarea), content (badge/card/panel/…),
      // typography (heading/label/…), branding.
      // (The pre-existing `index.test.tsx` suites predate the Phase-1 primitive swap and have
      // unrelated DOM-structure drift; reactivating them is tracked separately, not part of P2.)
      'src/elements/**/*-styled.test.tsx',
      'src/**/*.parity.test.tsx',
      'src/theme/**/*.test.ts',
      'src/platform/**/*.test.ts',
      // Pure codemod-mapping tests (node-safe, no DOM) — the objective correctness gate for the
      // P3 classnames-to-props codemod. See docs/tamagui-idiomatic-migration.md §5.
      'scripts/**/*.test.mjs',
    ],
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
