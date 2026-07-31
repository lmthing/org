/**
 * Drawer — the side panel used for the mobile sidebar, the DevTools dock (tablet) and project
 * settings.
 *
 * Lives flat here, not next to `ui/Drawer.tsx`, because `libs/ui/vitest.config.ts`'s `include` only
 * globs `chat/components/*.test.tsx` (one level), not `chat/components/ui/**` — that config file is
 * outside this change's file partition.
 *
 * Regression coverage for a native-only bug: `width` used to default to `'20rem'` and every caller
 * passed a CSS length (`'16rem'`, `'24rem'`) straight through to `Prim.Box width={width}`. `rem` has
 * no meaning on React Native, and `width` is deliberately NOT one of the props `nativeSafeProps`
 * numeric-casts (`elements/primitives/_native.tsx` — RN accepts a percentage STRING for `width`, so
 * it is not numeric-only), so the value reached Yoga unparsed and the drawer sized to its content
 * instead of the width its caller asked for. `jsdom` cannot see the native target (only
 * `pnpm test:native` can), so this cannot assert the width actually applies on a device — what it
 * CAN prove, and what would have caught the regression, is that the component's default and its
 * real call sites hand it a Tamagui size TOKEN or a number, never a CSS length string.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '../../test-utils/index';
import { Drawer } from './ui/Drawer';

describe('Drawer width', () => {
  it('defaults to a Tamagui size token, not a CSS length', () => {
    const { container } = render(
      <Drawer open onClose={() => {}}>
        content
      </Drawer>,
    );
    // A CSS length like `20rem`/`24rem` would show up verbatim in an inline style or class name;
    // a token (`$80`) never carries a unit suffix.
    expect(container.innerHTML).not.toMatch(/\d+rem\b/);
  });

  it('accepts a token width and never emits a `rem` length for it', () => {
    const { container } = render(
      <Drawer open onClose={() => {}} width="$96">
        content
      </Drawer>,
    );
    expect(container.innerHTML).not.toMatch(/\d+rem\b/);
  });

  it('clamps to the viewport width so a phone-width drawer never overflows horizontally', () => {
    const { container } = render(
      <Drawer open onClose={() => {}} width="$96">
        content
      </Drawer>,
    );
    // `maxWidth: 100%` is the clamp. Tamagui's atomic engine hashes the VALUE into the class
    // suffix (`_maxWidth-<hash>`, not a literal `100%`), so assert the PROP reached an atomic
    // class at all — its absence is what the pre-fix `Drawer` (no `maxWidth` prop) would show.
    expect(container.innerHTML).toMatch(/_maxWidth-/);
  });
});
