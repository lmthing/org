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
      // …and one level down. `components/ui/` holds the shared overlay pieces (the `Drawer` both
      // the chat shell and the mobile app mount), and the single-level glob above meant a suite
      // written next to one of them would never run — so `Drawer.test.tsx` had to be exiled to the
      // parent directory to be executed at all.
      'src/chat/components/**/*.test.tsx',
      // The chat SHELL's own components (`chat/app/*`). Same story one directory over: the
      // `.tsx` suites here ran nowhere, which is how the shell's no-session pane could ship a
      // dead end — a phone-sized screen holding one sentence about a sidebar that was not on
      // it, with nothing to press. These need only jsdom + react-dom + the Tamagui provider.
      'src/chat/app/*.test.tsx',
      // Pure codemod-mapping tests (node-safe, no DOM) — the objective correctness gate for the
      // P3 classnames-to-props codemod. See docs/tamagui-idiomatic-migration.md §5.
      'scripts/**/*.test.mjs',
      // The view renderer (`src/view/**`) — the shared ViewRenderer the viewbuilder's specs
      // render through. Needs only jsdom + react-dom + the Tamagui provider, all already here.
      // NB: jsdom cannot see the native target (`isWeb` is always true), so the fork selection
      // and the mounting claims are proven by `metro/suites/view.tsx` instead.
      'src/view/**/*.test.ts',
      'src/view/**/*.test.tsx',
      // The TEAM surface. Same story as `chat/` two entries up, one step worse: this include
      // never named `team/`, so there was nowhere for a team test to run and — unsurprisingly —
      // not one had ever been written. The whole surface (transcript, threads, composer, the
      // `@` picker, sidebar, unread, rail) shipped with no suite at all, and a test added here
      // would have passed silently by never running.
      'src/team/**/*.test.ts',
      'src/team/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
