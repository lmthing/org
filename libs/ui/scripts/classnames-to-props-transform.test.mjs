import { describe, it, expect } from 'vitest'
import { transform } from './classnames-to-props.mjs'

/**
 * Transform-level gate for the P3 codemod driver (docs/tamagui-idiomatic-migration.md §5). The
 * class→prop TABLE is pinned in classnames-to-props.test.mjs; this pins how `transform` rewrites JSX
 * around it — the plain static `className="…"` path AND the `className={cn("literal", …rest)}` path
 * that drains the most common dynamic-className shape (lift the literal, keep the dynamic rest).
 */
const TARGETS = new Set(['Box', 'Row', 'Col', 'Text', 'Pressable'])
const run = (src) => transform('t.tsx', src, TARGETS)

describe('static string className', () => {
  it('lifts all-mappable classes and drops the className', () => {
    const { text, count } = run(`<Prim.Box className="flex-col h-full" />`)
    expect(count).toBe(1)
    expect(text).toContain('flexDirection="column"')
    expect(text).toContain('height="100%"')
    expect(text).not.toContain('className')
  })
  it('keeps residual (animation) classes in a string className', () => {
    // NB: the example is an ANIMATION — alpha modifiers used to live here too, but they now map
    // to a `color-mix` (matching the hand-written elements), so they are no longer residual.
    const { text } = run(`<Prim.Box className="rounded-md animate-pulse" />`)
    expect(text).toContain('borderRadius="$radius-md"')
    expect(text).toContain('className="animate-pulse"')
  })
})

describe('cn("literal", ...rest) className', () => {
  it('lifts the literal and keeps the passthrough arg inline', () => {
    const { text, count } = run(`<Prim.Box className={cn('flex-col h-full bg-background', className)} />`)
    expect(count).toBe(1)
    expect(text).toContain('flexDirection="column"')
    expect(text).toContain('height="100%"')
    expect(text).toContain('backgroundColor="$background"')
    // single surviving arg (the passthrough) is inlined, cn() dropped
    expect(text).toContain('className={className}')
    expect(text).not.toContain('cn(')
  })
  it('re-wraps residual + rest in cn() when both survive', () => {
    const { text } = run(`<Prim.Box className={cn('rounded-md animate-pulse', className)} />`)
    expect(text).toContain('borderRadius="$radius-md"')
    // residual static class + passthrough both kept, still via cn()
    expect(text).toContain('className={cn("animate-pulse", className)}')
  })
  it('keeps a conditional rest arg verbatim', () => {
    const { text } = run(`<Prim.Box className={cn('overflow-auto', open && 'left-0')} />`)
    expect(text).toContain('overflow="auto"')
    expect(text).toContain("className={open && 'left-0'}")
  })
  it('skips (does not touch) when the literal has an unmapped class', () => {
    const { text, count, skips } = run(`<Prim.Box className={cn('panel', className)} />`)
    expect(count).toBe(0)
    expect(skips.length).toBe(1)
    expect(text).toContain(`className={cn('panel', className)}`)
  })
  it('does not treat a non-cn call or a non-literal first arg as liftable', () => {
    expect(run(`<Prim.Box className={clsx('flex-col', x)} />`).count).toBe(0)
    expect(run(`<Prim.Box className={cn(base, 'flex-col')} />`).count).toBe(0)
  })
  it('leaves a prop the element already sets as a manual merge', () => {
    // `h-full` lifts to `height`, which the element already sets → collision, not a silent overwrite.
    const { count, skips } = run(`<Prim.Box height={10} className={cn('h-full', className)} />`)
    expect(count).toBe(0)
    expect(skips[0].why).toContain('already sets')
  })
})
