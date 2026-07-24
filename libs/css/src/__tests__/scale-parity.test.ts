/**
 * SPIKE B — Tailwind ⇄ Tamagui scale parity (the codemod's foundation).
 *
 * Proves the generated Tamagui `space`/`size`/`fontSizes`/`lineHeights`/`fontWeights`/
 * `letterSpacings`/`media` scales equal Tailwind's canonical default values, so a
 * class→prop codemod (`p-4 → paddingHorizontal="$4"`, `text-sm → fontSize="$sm"`, …) is
 * mechanical and non-lossy. This is the P3 counterpart of the Layer-1 color parity test.
 *
 * The expected values here are Tailwind's documented defaults (v3/v4, root 16px). If a
 * scale ever drifts from Tailwind, the codemod's output silently stops matching the old
 * class output — this test is the guard. See docs/tamagui-idiomatic-migration.md §1 (SPIKE B).
 */
import { describe, it, expect } from 'vitest';

import {
  space,
  size,
  fontSizes,
  lineHeights,
  fontWeights,
  letterSpacings,
  zIndex,
  media,
} from '../tamagui/tokens.generated';
import { SPACE_UNIT_PX } from '../../scripts/tamagui-tokens.mjs';

describe('SPIKE B — spacing scale ⇄ Tailwind', () => {
  it('unit is 4px (0.25rem @ 16px root)', () => {
    expect(SPACE_UNIT_PX).toBe(4);
  });

  it('every numeric key resolves to key × 4px', () => {
    for (const [k, v] of Object.entries(space)) {
      if (k === 'px' || k === 'true') continue;
      expect(v, `$${k}`).toBe(Number(k) * 4);
    }
  });

  it('pins the load-bearing Tailwind values', () => {
    // px, half-steps, whole steps, and the big end of the ramp.
    expect(space.px).toBe(1);
    expect(space['0']).toBe(0);
    expect(space['0.5']).toBe(2);
    expect(space['1']).toBe(4);
    expect(space['2']).toBe(8);
    expect(space['4']).toBe(16);
    expect(space['8']).toBe(32);
    expect(space['12']).toBe(48);
    expect(space['16']).toBe(64);
    expect(space['96']).toBe(384);
  });

  it('size scale equals the space scale (Tailwind reuses spacing for w/h)', () => {
    expect(size).toEqual(space);
  });

  it('has a `true` default', () => {
    expect(space.true).toBe(16);
  });
});

describe('SPIKE B — type ramp ⇄ Tailwind text-*', () => {
  const expected: Record<string, [size: number, lh: number]> = {
    xs: [12, 16],
    sm: [14, 20],
    base: [16, 24],
    lg: [18, 28],
    xl: [20, 28],
    '2xl': [24, 32],
    '3xl': [30, 36],
    '4xl': [36, 40],
    '5xl': [48, 48],
    '6xl': [60, 60],
    '7xl': [72, 72],
    '8xl': [96, 96],
    '9xl': [128, 128],
  };

  it('font sizes match Tailwind text-* sizes', () => {
    for (const [k, [sz]] of Object.entries(expected)) {
      expect(fontSizes[k as keyof typeof fontSizes], `text-${k} size`).toBe(sz);
    }
  });

  it('line-heights match Tailwind text-* line-heights', () => {
    for (const [k, [, lh]] of Object.entries(expected)) {
      expect(lineHeights[k as keyof typeof lineHeights], `text-${k} line-height`).toBe(lh);
    }
  });

  it('fontSizes and lineHeights share the same keys (paired ramp)', () => {
    expect(Object.keys(fontSizes)).toEqual(Object.keys(lineHeights));
  });

  it('`true` defaults to Tailwind `base` (16/24)', () => {
    expect(fontSizes.true).toBe(16);
    expect(lineHeights.true).toBe(24);
  });
});

describe('SPIKE B — weights ⇄ Tailwind font-*', () => {
  it('maps every Tailwind weight name to its numeric string', () => {
    expect(fontWeights).toMatchObject({
      thin: '100',
      extralight: '200',
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
      black: '900',
    });
  });
});

describe('SPIKE B — tracking ⇄ Tailwind tracking-*', () => {
  it('maps every Tailwind tracking name to its em value', () => {
    expect(letterSpacings).toMatchObject({
      tighter: '-0.05em',
      tight: '-0.025em',
      normal: '0em',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em',
    });
  });
});

describe('SPIKE B — media ⇄ Tailwind breakpoints', () => {
  it('named breakpoints match Tailwind (min-width, mobile-first)', () => {
    expect(media.sm).toEqual({ minWidth: 640 });
    expect(media.md).toEqual({ minWidth: 768 });
    expect(media.lg).toEqual({ minWidth: 1024 });
    expect(media.xl).toEqual({ minWidth: 1280 });
    expect(media.xxl).toEqual({ minWidth: 1536 });
  });

  it('gt* aliases step up one breakpoint (Tamagui idiom)', () => {
    expect(media.gtSm).toEqual({ minWidth: 768 });
    expect(media.gtMd).toEqual({ minWidth: 1024 });
  });
});

describe('SPIKE B — z-index named overlay scale', () => {
  it('orders overlay layers with modal < popover < toast < tooltip', () => {
    expect(zIndex.modal).toBeLessThan(zIndex.popover);
    expect(zIndex.popover).toBeLessThan(zIndex.toast);
    expect(zIndex.toast).toBeLessThan(zIndex.tooltip);
  });
});
