import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Select — the idiomatic `.select`. Renders `Prim.Select` (a real `<select>` at runtime via
 * `createComponent`) inside a positioned `Prim.Box`, with the styling as `$`-token PROPS from
 * its retired `styled()` proof (docs/tamagui-idiomatic-migration.md §4/§6). `select/index.css` is deleted.
 *
 * `.select__content` went with it: this element renders a NATIVE `<select>`, whose option list is
 * drawn by the browser, so the popover rules never applied to anything.
 */
// `Prim.ControlStyleProps` too, not just the DOM attrs: `Select` spreads its props straight onto
// `Prim.Select`, which is a real Tamagui control and honours style props — so `<Select width="6rem">`
// worked at runtime while failing to typecheck. `<select>` has no conflicting HTML attributes.
export type SelectProps = React.ComponentProps<'select'> & Prim.ControlStyleProps

/** `.select` — the positioning wrapper. */
const WRAPPER = { position: 'relative' } as const

/** `.select__trigger` — the control itself. Note `focus:`, not `focus-visible:`, per the stylesheet. */
const TRIGGER = {
  display: 'flex',
  height: '$9',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$input',
  backgroundColor: '$background',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  placeholderTextColor: '$muted-foreground',
  focusStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' },
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },
} as const

function Select({ children, ...props }: SelectProps) {
  return (
    <Prim.Box {...WRAPPER}>
      <Prim.Select {...TRIGGER} {...(props as Record<string, unknown>)}>
        {children}
      </Prim.Select>
    </Prim.Box>
  )
}

function SelectOption(props: React.ComponentProps<'option'>) {
  return <Prim.Option {...props} />
}

export { Select, SelectOption }
