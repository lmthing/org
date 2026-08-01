import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    rules: {
      // ## The layer that turns off base rules TypeScript already enforces
      //
      // This used to be two hand-written `off`s — `no-undef` and `no-unused-vars` — which are two of
      // the ~23 rules this layer exists to disable. The rest were left firing, and they cannot be
      // right: they are the JS versions of checks the compiler does properly, so on TypeScript they
      // are noise at best and WRONG at worst. `no-redeclare` was the one that bit: it reported
      // `studio/workflow/workflow-card` for importing the TYPE `TasklistListItem` and exporting a
      // FUNCTION of the same name, which is legal — types and values are separate declaration
      // spaces, and `tsc` is silent on it. Patching rules one at a time as each false positive shows
      // up means the list is only ever as complete as the last person's patience.
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      // The layer above does not only turn rules OFF — it also ENABLES `prefer-const`, on the
      // grounds that TypeScript makes the analysis reliable. Its default is too strict for a pattern
      // this codebase uses deliberately: declare `let x` with no initialiser, define a closure that
      // reads `x`, then assign it once. `worker-load`'s `timer` and `team-channels`' `run` are both
      // that shape, and neither can become a `const` — merging the declaration into the assignment
      // moves the binding out of scope for the closure that was defined above it. `prefer-const` has
      // the option for exactly this case; the default `false` is what made it fire.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Pre-existing patterns across the codebase — warn rather than error
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      // ## React hooks — a declared dependency that was never registered
      //
      // `eslint-plugin-react-hooks` has been in this package's dependencies all along and the flat
      // config above never listed it in `plugins`, so **`rules-of-hooks` had never run anywhere in
      // the monorepo**. The only visible symptom was the opposite of a warning: source files
      // carrying `// eslint-disable-next-line react-hooks/exhaustive-deps` failed lint with
      // "Definition for rule was not found", which reads like a config typo rather than like a
      // family of checks being absent.
      //
      // Registering it immediately reported four `rules-of-hooks` ERRORS in `chat/app/Composer.tsx`
      // — an early `return` for replay mode sitting above four hook calls, so the hook COUNT
      // depended on a prop. React matches hook state positionally, so that is data corruption or a
      // hard "Rendered fewer hooks than expected", not a style question. `exhaustive-deps` stays at
      // the plugin's own `warn`: there are ~47 of them, several deliberate and already annotated,
      // and promoting them to errors would make this gate un-passable for reasons unrelated to why
      // it is being turned on.
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Plain-JS Node files — codemods, lint gates, the Metro harness runners. They are executed by
    // `node` directly and never bundled, but the block above only gives globals to `.ts`/`.tsx`, so
    // every one of them tripped `no-undef` on `console` and `process`. That is why
    // `libs/ui/scripts/lint-rn-safety.mjs` — a gate that has been in `pnpm lint` for months —
    // contributed six errors to its own lint run.
    // `.js` is in this list too, and its absence is why the Metro harness's CommonJS module mocks
    // (`libs/ui/metro/mocks/*.js`) each reported `'module' is not defined` — plain `.js` matched
    // neither this block nor the TypeScript one above, so it got bare `js.configs.recommended` with
    // no globals at all. `browser` is included because these mock Expo modules and reach for `URL`
    // and `URLSearchParams`.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // The same shape the TypeScript block gets from `@typescript-eslint/no-unused-vars`, applied to
      // the base rule so a deliberately-unused `_redirectUrl` in a mock signature — the argument
      // exists to document the real module's API — is not an error in plain JS while being fine one
      // directory over. A codemod's leftover local is a warning worth seeing, not a build break.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // GENERATED output, not source. `.tamagui/` is the Tamagui compiler's cache — a single
    // ~600 KB `tamagui.config.mjs` that alone accounted for most of `apps/web`'s lint errors, on
    // rules like `no-func-assign` and `no-fallthrough` that only ever fire on machine-written code.
    // Linting it says nothing about this codebase and buries the findings that do.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.gen.ts',
      '**/.tamagui/**',
      '**/*.bundle.js',
      '**/*.min.js',
    ],
  },
];
