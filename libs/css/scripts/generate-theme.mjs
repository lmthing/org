#!/usr/bin/env node
/**
 * generate-theme.mjs — the design-system generator.
 *
 * Single source of truth: src/tokens/tokens.json.
 * Emits (do NOT hand-edit either output):
 *   - src/theme.css           Tailwind v4 tokens: @theme + @theme inline + :root (light) + .dark
 *   - tokens.manifest.json    flat, machine-readable token index (for humans + LLMs)
 *
 * Run: pnpm --filter @lmthing/css generate   (also runs on prebuild)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tokens = JSON.parse(readFileSync(join(root, 'src/tokens/tokens.json'), 'utf8'));

const BANNER = 'generate-theme.mjs';

// ── Spectrum interpolation ──────────────────────────────────────────
// Anchors (brand-1..5) sit at indices 1,14,27,40,53 (spacing 13); linear RGB
// lerp between consecutive anchors, rounded. Emits `steps` values (1..steps).
const hexToRgb = (h) => {
  const n = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

function buildSpectrum(spec, colorMap) {
  const anchorNames = ['brand-1', 'brand-2', 'brand-3', 'brand-4', 'brand-5'];
  const anchors = anchorNames.map((n) => hexToRgb(colorMap[n].light));
  const spacing = 13; // anchors at 1, 14, 27, 40, 53
  const out = [];
  for (let i = 1; i <= spec.steps; i++) {
    const pos = i - 1; // 0-based position along the ramp
    const seg = Math.min(Math.floor(pos / spacing), anchors.length - 2);
    const t = (pos - seg * spacing) / spacing;
    const a = anchors[seg];
    const b = anchors[seg + 1];
    const rgb = [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * t);
    out.push({ name: `spectrum-${i}`, value: rgbToHex(rgb) });
  }
  return out;
}

// ── Assemble ────────────────────────────────────────────────────────
const colorMap = Object.fromEntries(tokens.colors.map((c) => [c.name, c]));
const spectrum = buildSpectrum(tokens.spectrum, colorMap);

// Full ordered color list: authored colors, then spectrum.
const colors = [
  ...tokens.colors,
  ...spectrum.map((s) => ({
    name: s.name,
    group: tokens.spectrum.group,
    light: s.value,
    dark: s.value,
    description: tokens.spectrum.description,
  })),
];

const indent = '  ';
const themeLines = Object.entries(tokens.theme).map(([k, v]) => `${indent}--${k}: ${v};`);
const inlineLines = colors.map((c) => `${indent}--color-${c.name}: var(--${c.name});`);
const rootLines = colors.map((c) => `${indent}--${c.name}: ${c.light};`);
const darkLines = colors
  .filter((c) => c.dark !== c.light)
  .map((c) => `${indent}--${c.name}: ${c.dark};`);

const darkSel = tokens.$meta.darkSelector; // e.g. [data-theme="dark"]
const css = `@import "tailwindcss";

@custom-variant dark (&:is(${darkSel} *));

/* Auto-generated @theme fonts by ${BANNER} — edit src/tokens/tokens.json, not this file */
@theme {
${themeLines.join('\n')}
}
/* End Auto-generated global */

/* Auto-generated @theme by ${BANNER} */
@theme inline {
${inlineLines.join('\n')}
}
/* End Auto-generated @theme */

/* Auto-generated :root (light) by ${BANNER} */
:root {
${rootLines.join('\n')}
}
/* End Auto-generated :root */

/* Auto-generated dark theme by ${BANNER} — warm-stone (brand + spectrum unchanged) */
${darkSel} {
${darkLines.join('\n')}
}
/* End Auto-generated dark */
`;

writeFileSync(join(root, 'src/theme.css'), css);

// ── Manifest ────────────────────────────────────────────────────────
const manifest = {
  $meta: {
    generatedBy: BANNER,
    source: 'src/tokens/tokens.json',
    darkSelector: tokens.$meta.darkSelector,
    note: 'Generated. Every token is a CSS custom property; colors are also exposed as Tailwind utilities via --color-* (e.g. bg-primary, text-agent).',
  },
  scales: Object.entries(tokens.theme).map(([name, value]) => ({
    name,
    cssVar: `--${name}`,
    group: name.startsWith('font') ? 'font' : 'radius',
    value,
  })),
  colors: colors.map((c) => ({
    name: c.name,
    cssVar: `--${c.name}`,
    utility: `--color-${c.name}`,
    group: c.group,
    light: c.light,
    dark: c.dark,
    description: c.description,
  })),
};
writeFileSync(join(root, 'tokens.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `[generate-theme] wrote src/theme.css (${colors.length} color tokens, ${darkLines.length} dark overrides) + tokens.manifest.json`,
);
