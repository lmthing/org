#!/usr/bin/env node
/**
 * generate-tamagui-config.mjs — sibling of generate-theme.mjs, reading the SAME
 * src/tokens/tokens.json and emitting the Tamagui token/theme data used by the RN /
 * universal render target.
 *
 * Emits (do NOT hand-edit):
 *   - src/tamagui/tokens.generated.ts   pure-data module: radius, fonts, themes.{light,dark}
 *
 * Because both this file and src/theme.css derive from tokens.json, and the Layer-1
 * token-parity test (src/__tests__/token-parity.test.ts) asserts byte-equality between
 * them, color/spacing/radius/font drift between the Tailwind (web) and Tamagui (universal)
 * targets is structurally impossible. See docs/react-native-tamagui-migration.md §5.
 *
 * Run: pnpm --filter @lmthing/css generate   (also runs on prebuild)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderTokensModule, buildTamaguiTokens } from './tamagui-tokens.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tokens = JSON.parse(readFileSync(join(root, 'src/tokens/tokens.json'), 'utf8'));

const source = renderTokensModule(tokens);
const outDir = join(root, 'src/tamagui');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tokens.generated.ts'), source);

const { themes } = buildTamaguiTokens(tokens);
console.log(
  `[generate-tamagui-config] wrote src/tamagui/tokens.generated.ts ` +
    `(${Object.keys(themes.light).length} color tokens × 2 themes)`,
);
