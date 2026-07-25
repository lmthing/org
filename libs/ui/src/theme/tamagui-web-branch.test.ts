import { describe, it, expect } from 'vitest'
import { tamaguiWebConfig } from './tamagui.config'
import {
  webColorTokens,
  space as genSpace,
  zIndex as genZIndex,
} from '@lmthing/css/tamagui-tokens'

/**
 * SPIKE A1 — the WEB config constructs with var(--name)-backed color tokens.
 *
 * The empirical browser proof that the indirection resolves under light/dark + a runtime
 * space override lives in `apps/web/b0-probe/spike-a-runtime-theme.spec.ts`. THIS unit test
 * proves the config itself is well-formed: `createTamagui` accepts the var-backed color tokens
 * and carries them + the Tailwind-parity scales through unchanged, keeping the single empty
 * `app` theme (so no theme-scoped var injection collides with theme.css).
 */
const val = (v: unknown): string =>
  typeof v === 'object' && v !== null && 'val' in v ? String((v as { val: unknown }).val) : String(v)

describe('tamagui.config createTamagui (SPIKE A1)', () => {
  it('constructs with the single empty `app` theme', () => {
    expect(tamaguiWebConfig).toBeTruthy()
    expect(tamaguiWebConfig.themes.app).toBeTruthy()
    // No colored light/dark theme that would inject `.t_light`-scoped vars over theme.css.
    expect(tamaguiWebConfig.themes.light).toBeUndefined()
    expect(tamaguiWebConfig.themes.dark).toBeUndefined()
  })

  it('every color token is the var(--name) indirection (SPIKE A1)', () => {
    for (const [name, expected] of Object.entries(webColorTokens)) {
      expect(val(tamaguiWebConfig.tokens.color[name]), `color.${name}`).toBe(expected)
      expect(expected).toBe(`var(--${name})`)
    }
  })

  it('carries the Tailwind-parity space + z-index scales', () => {
    for (const [name, expected] of Object.entries(genSpace)) {
      expect(val(tamaguiWebConfig.tokens.space[name]), `space.${name}`).toBe(String(expected))
    }
    for (const [name, expected] of Object.entries(genZIndex)) {
      expect(val(tamaguiWebConfig.tokens.zIndex[name]), `zIndex.${name}`).toBe(String(expected))
    }
  })

  it('registers the Tailwind breakpoint media config', () => {
    expect(tamaguiWebConfig.media.md).toEqual({ minWidth: 768 })
  })
})
