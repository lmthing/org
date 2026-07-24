/**
 * tamagui-tokens.mjs — pure, side-effect-free derivation of the Tamagui token/theme
 * data from the SAME `src/tokens/tokens.json` that `generate-theme.mjs` consumes.
 *
 * This module has NO filesystem or Tamagui-runtime dependencies so it can be imported
 * by BOTH the generator script (`generate-tamagui-config.mjs`) and the Layer-1
 * token-parity vitest (`src/__tests__/token-parity.test.ts`). The parity test proves,
 * by construction, that the values below resolve to the byte-identical CSS values the
 * browser gets from `theme.css` — so color/spacing/radius/font can never drift between
 * the Tailwind (`theme.css`) and Tamagui render targets. See
 * docs/tamagui-idiomatic-migration.md §3 (P1) and docs/react-native-tamagui-migration.md §5.
 *
 * ## Phase 2 (idiomatic) additions — SPIKE B + SPIKE A1
 *
 * Phase 1 only needed color/radius/font parity (the surfaces kept Tailwind classNames).
 * Phase 2 makes the surfaces express spacing/size/typography as Tamagui `$` props, so the
 * token set is extended to the COMPLETE Tamagui shape, with the scales pinned 1:1 to
 * Tailwind's defaults so a class→prop codemod is mechanical:
 *   - `space` / `size`  — Tailwind's spacing scale (unit = 0.25rem = 4px). `p-4 → $4`.
 *   - `fontSizes` / `lineHeights` — Tailwind's `text-*` ramp. `text-sm → $sm`.
 *   - `fontWeights` — Tailwind's `font-*` weights. `font-semibold → $semibold`.
 *   - `letterSpacings` — Tailwind's `tracking-*`. `tracking-wide → $wide`.
 *   - `zIndex` — a named overlay-layering scale (`$modal`, `$popover`, …).
 *   - `media` — Tailwind's breakpoints (`sm`=640 … `2xl`=1536), min-width / mobile-first.
 *   - `webThemes` — SPIKE A1: the light/dark themes with each color value rewritten to
 *     `var(--<name>)` so a Tamagui web theme resolves THROUGH `theme.css`'s cascade
 *     (`data-theme` light/dark + any runtime `--<name>` space-theme override). Native
 *     keeps the resolved hex (`themes`).
 *
 * The Tailwind scales are the canonical Tailwind v3/v4 defaults, asserted by the parity
 * test (`scale-parity.test.ts`) against the px math and known Tailwind values.
 */

// ── Spectrum interpolation ──────────────────────────────────────────
// Byte-for-byte identical to generate-theme.mjs#buildSpectrum: anchors (brand-1..5) at
// indices 1,14,27,40,53 (spacing 13); linear RGB lerp between consecutive anchors, rounded.
// Kept in lockstep by the token-parity test, which compares this output to theme.css.
const hexToRgb = (h) => {
  const n = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

export function buildSpectrum(spec, colorMap) {
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

// ── SPIKE B — Tailwind-parity scales (the codemod's target vocabulary) ─────────────
// These are Tailwind's canonical default scales, encoded as plain data so `$4`/`$sm`/…
// equal the values a `p-4`/`text-sm` class computes to. NOT derived from tokens.json
// (which carries no spacing/type ramp) — they ARE the Tailwind contract, and
// scale-parity.test.ts pins them to the px math + known Tailwind values.

/** Tailwind spacing unit in px (0.25rem @ 16px root). `space-N === N * SPACE_UNIT_PX`. */
export const SPACE_UNIT_PX = 4;

/** Tailwind spacing keys (used for padding/margin/gap AND width/height/inset). */
const SPACE_KEYS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32,
  36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];

/** Build the Tailwind spacing scale as a Tamagui token map: { "0":0, "0.5":2, "4":16, … }. */
export function buildSpaceScale() {
  const out = {};
  out.px = 1; // Tailwind `p-px`
  for (const k of SPACE_KEYS) out[String(k)] = k * SPACE_UNIT_PX;
  // Tamagui requires a `true` default token; Tailwind's most-common gap/padding is 1rem.
  out.true = 16;
  return out;
}

/** Tailwind `text-*` ramp → { size, lineHeight } in px (line-heights are Tailwind's defaults). */
const FONT_RAMP = {
  xs: { size: 12, lineHeight: 16 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 28 },
  '2xl': { size: 24, lineHeight: 32 },
  '3xl': { size: 30, lineHeight: 36 },
  '4xl': { size: 36, lineHeight: 40 },
  '5xl': { size: 48, lineHeight: 48 },
  '6xl': { size: 60, lineHeight: 60 },
  '7xl': { size: 72, lineHeight: 72 },
  '8xl': { size: 96, lineHeight: 96 },
  '9xl': { size: 128, lineHeight: 128 },
};

export function buildFontSizeScale() {
  const out = {};
  for (const [k, v] of Object.entries(FONT_RAMP)) out[k] = v.size;
  out.true = FONT_RAMP.base.size;
  return out;
}
export function buildLineHeightScale() {
  const out = {};
  for (const [k, v] of Object.entries(FONT_RAMP)) out[k] = v.lineHeight;
  out.true = FONT_RAMP.base.lineHeight;
  return out;
}

/** Tailwind `font-*` numeric weights (as strings — CSS font-weight). */
export function buildFontWeightScale() {
  return {
    thin: '100',
    extralight: '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900',
    true: '400',
  };
}

/** Tailwind `tracking-*` letter-spacing (em, so it scales with font-size like Tailwind). */
export function buildLetterSpacingScale() {
  return {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
    true: '0em',
  };
}

/** Named z-index scale for overlay layering (numeric aliases kept for back-compat). */
export function buildZIndexScale() {
  return {
    0: 0,
    1: 100,
    2: 200,
    3: 300,
    4: 400,
    5: 500,
    hide: -1,
    base: 0,
    docked: 10,
    dropdown: 1000,
    sticky: 1100,
    banner: 1200,
    overlay: 1300,
    modal: 1400,
    popover: 1500,
    skipLink: 1600,
    toast: 1700,
    tooltip: 1800,
    true: 0,
  };
}

/**
 * Tailwind breakpoints as a Tamagui media config (min-width / mobile-first, matching
 * Tailwind's `md:` = ≥768px semantics 1:1). `gt*` aliases cover Tamagui's idiom.
 */
export function buildMedia() {
  const bp = { sm: 640, md: 768, lg: 1024, xl: 1280, xxl: 1536 };
  const media = {};
  for (const [k, min] of Object.entries(bp)) media[k] = { minWidth: min };
  // Tamagui-idiom `$gtSm` etc. (strictly greater-than the *previous* breakpoint's ceiling).
  media.gtXs = { minWidth: bp.sm };
  media.gtSm = { minWidth: bp.md };
  media.gtMd = { minWidth: bp.lg };
  media.gtLg = { minWidth: bp.xl };
  media.gtXl = { minWidth: bp.xxl };
  return media;
}

/**
 * Derive the full Tamagui token payload from a parsed tokens.json.
 *
 * Returns:
 *   - radius:  { 'radius-sm': '0.125rem', … }         (from tokens.theme, radius-* keys)
 *   - fonts:   { 'font-sans': 'TypeMates …', … }      (from tokens.theme, font-* keys)
 *   - themes.light: { <colorName>: <cssValue>, … }    (every authored color + spectrum, light)
 *   - themes.dark:  { <colorName>: <cssValue>, … }    (light ⊕ dark overrides — the FULLY
 *                                                      RESOLVED dark theme, exactly what the
 *                                                      browser computes under [data-theme="dark"])
 *   - webThemes.{light,dark}: { <colorName>: 'var(--<name>)' }   (SPIKE A1 web indirection)
 *   - space/size/fontSizes/lineHeights/fontWeights/letterSpacings/zIndex/media (SPIKE B scales)
 *
 * Color/radius/font values are the exact CSS strings from tokens.json so parity with
 * theme.css is byte-identical. The scales are Tailwind's canonical defaults (SPIKE B).
 */
export function buildTamaguiTokens(tokens) {
  const colorMap = Object.fromEntries(tokens.colors.map((c) => [c.name, c]));
  const spectrum = buildSpectrum(tokens.spectrum, colorMap);

  // Full ordered color list: authored colors, then spectrum (same order as generate-theme.mjs).
  const colors = [
    ...tokens.colors.map((c) => ({ name: c.name, light: c.light, dark: c.dark })),
    ...spectrum.map((s) => ({ name: s.name, light: s.value, dark: s.value })),
  ];

  const radius = {};
  const fonts = {};
  for (const [k, v] of Object.entries(tokens.theme)) {
    if (k.startsWith('radius')) radius[k] = v;
    else if (k.startsWith('font')) fonts[k] = v;
  }

  const light = {};
  const dark = {};
  const webLight = {};
  const webDark = {};
  for (const c of colors) {
    light[c.name] = c.light;
    // Fully-resolved dark theme: a token with no distinct dark value inherits its light value,
    // exactly as the CSS cascade resolves it under [data-theme="dark"].
    dark[c.name] = c.dark;
    // SPIKE A1: web values are the CSS var so they resolve through theme.css (data-theme +
    // runtime --<name> overrides). Both light/dark map to the same var name — the *value* of
    // that var is what `data-theme` flips, so one web theme is enough on web; we still emit
    // both keys so the config shape mirrors `themes`.
    webLight[c.name] = `var(--${c.name})`;
    webDark[c.name] = `var(--${c.name})`;
  }

  return {
    radius,
    fonts,
    themes: { light, dark },
    webThemes: { light: webLight, dark: webDark },
    space: buildSpaceScale(),
    size: buildSpaceScale(),
    fontSizes: buildFontSizeScale(),
    lineHeights: buildLineHeightScale(),
    fontWeights: buildFontWeightScale(),
    letterSpacings: buildLetterSpacingScale(),
    zIndex: buildZIndexScale(),
    media: buildMedia(),
  };
}

/**
 * Render the checked-in generated module (`src/tamagui/tokens.generated.ts`).
 *
 * A pure-data TypeScript module — NO `@tamagui/core` import — so the token-parity vitest
 * (node env, no Tamagui installed) can import it directly. The buildable `tamagui.config.ts`
 * (needs @tamagui/core) is a thin shell that feeds this data into `createTamagui`.
 */
export function renderTokensModule(tokens) {
  const t = buildTamaguiTokens(tokens);
  const j = (obj) => JSON.stringify(obj, null, 2);
  const ji = (obj) => j(obj).replace(/\n/g, '\n  ');
  return `// AUTO-GENERATED by libs/css/scripts/generate-tamagui-config.mjs — DO NOT EDIT.
// Source of truth: src/tokens/tokens.json (colors/radius/fonts) + the Tailwind-parity
// scales in libs/css/scripts/tamagui-tokens.mjs (space/size/type/z/media). Regenerate with:
//   pnpm --filter @lmthing/css generate
//
// Pure data (no @tamagui/core import) so the Layer-1 token-parity test can load it in a
// node env. Every color/radius/font value here is byte-identical to the corresponding CSS
// custom property in src/theme.css — proven by src/__tests__/token-parity.test.ts. The
// Tailwind-parity scales are proven by src/__tests__/scale-parity.test.ts. See
// docs/tamagui-idiomatic-migration.md §3.

/** radius-* scale tokens (exact CSS values from tokens.json → tokens.theme). */
export const radius = ${j(t.radius)} as const;

/** font-* family tokens (exact CSS values). */
export const fonts = ${j(t.fonts)} as const;

/**
 * Theme colors keyed by design-token name. \`light\` mirrors :root; \`dark\` is the FULLY
 * RESOLVED [data-theme="dark"] theme (light ⊕ dark overrides), so a Tamagui theme can be
 * built directly from either map without replaying the CSS cascade. These are the RESOLVED
 * HEX values — the NATIVE render target.
 */
export const themes = {
  light: ${ji(t.themes.light)},
  dark: ${ji(t.themes.dark)},
} as const;

/**
 * SPIKE A1 — the WEB render target. Same token names, but each value is \`var(--<name>)\`
 * so a Tamagui web theme resolves THROUGH theme.css's cascade: \`data-theme\` flips
 * light↔dark, and a space's runtime \`--<name>\` override (see libs/ui theme.ts
 * applyThemeTokens) keeps working. Native uses \`themes\` (resolved hex); web uses these.
 */
export const webThemes = {
  light: ${ji(t.webThemes.light)},
  dark: ${ji(t.webThemes.dark)},
} as const;

/** Tailwind spacing scale (unit = 4px). Used for space AND size. \`p-4 → $4\`. */
export const space = ${j(t.space)} as const;

/** Tailwind spacing scale reused as the size scale (\`w-8 → $8\`). */
export const size = ${j(t.size)} as const;

/** Tailwind \`text-*\` font-size ramp in px (\`text-sm → $sm\`). */
export const fontSizes = ${j(t.fontSizes)} as const;

/** Tailwind \`text-*\` line-height ramp in px (paired with fontSizes by key). */
export const lineHeights = ${j(t.lineHeights)} as const;

/** Tailwind \`font-*\` weights as CSS strings (\`font-semibold → $semibold\`). */
export const fontWeights = ${j(t.fontWeights)} as const;

/** Tailwind \`tracking-*\` letter-spacing in em (\`tracking-wide → $wide\`). */
export const letterSpacings = ${j(t.letterSpacings)} as const;

/** Named z-index scale for overlay layering (\`zIndex="$modal"\`). */
export const zIndex = ${j(t.zIndex)} as const;

/** Tailwind breakpoints as a Tamagui media config (min-width, mobile-first). */
export const media = ${j(t.media)} as const;

export type TokenColorName = keyof typeof themes.light;
export type ThemeName = keyof typeof themes;

export default {
  radius,
  fonts,
  themes,
  webThemes,
  space,
  size,
  fontSizes,
  lineHeights,
  fontWeights,
  letterSpacings,
  zIndex,
  media,
};
`;
}
