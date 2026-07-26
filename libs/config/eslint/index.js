import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript's compiler enforces these — no need to duplicate in ESLint
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Pre-existing patterns across the codebase — warn rather than error
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
    },
  },
  {
    // Plain-JS Node files — codemods, lint gates, the Metro harness runners. They are executed by
    // `node` directly and never bundled, but the block above only gives globals to `.ts`/`.tsx`, so
    // every one of them tripped `no-undef` on `console` and `process`. That is why
    // `libs/ui/scripts/lint-rn-safety.mjs` — a gate that has been in `pnpm lint` for months —
    // contributed six errors to its own lint run.
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.gen.ts'] },
];
