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
      // The SHIPPED element layer — `index.tsx`, the component the app actually renders. P2's
      // parallel `*.styled.tsx` proof tree and its `*-styled.test.tsx` gates are DELETED: they
      // proved the BEM→`styled()` translation for a copy nothing imported, and the translation
      // they proved now lives in the shipped elements as `$`-token props with the same provenance
      // comments. These suites are the real gate. See docs/tamagui-idiomatic-migration.md §4/§6.
      'src/elements/**/index.test.tsx',
      'src/**/*.parity.test.tsx',
      'src/theme/**/*.test.ts',
      'src/platform/**/*.test.ts',
      // The chat surface's NODE-safe suites (auth, url-state, node-meta, auto-resume, the store).
      // These ran nowhere at all: the root config excludes libs/ui, and this include never named
      // `chat/`. `.ts` only — the `.tsx` component suites still need peers that are not installed.
      'src/chat/**/*.test.ts',
      // The descriptor renderers. These are `.tsx` and so were outside the include above —
      // which is exactly how `DisplayBlock` kept its own half-finished switch (no `Table`, no
      // `Stack`, `JSON.stringify` for anything else) with three suites sitting next to it that
      // ran nowhere. They need only jsdom + react-dom, both already here.
      'src/chat/components/*.test.tsx',
      // Pure codemod-mapping tests (node-safe, no DOM) — the objective correctness gate for the
      // P3 classnames-to-props codemod. See docs/tamagui-idiomatic-migration.md §5.
      'scripts/**/*.test.mjs',
      // The view renderer (`src/view/**`) — the shared ViewRenderer the viewbuilder's specs
      // render through. Needs only jsdom + react-dom + the Tamagui provider, all already here.
      // NB: jsdom cannot see the native target (`isWeb` is always true), so the fork selection
      // and the mounting claims are proven by `metro/suites/view.tsx` instead.
      'src/view/**/*.test.ts',
      'src/view/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
