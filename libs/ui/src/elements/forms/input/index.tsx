import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Input — the idiomatic `.input`. Renders `Prim.TextField` (a real `<input>` at runtime via
 * `createComponent`) with the `.input` styling as `$`-token PROPS from input.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4/§6). `input/index.css` is deleted.
 */
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  error?: boolean
  /** `.input--sm` — the compact row height. */
  size?: 'default' | 'sm'
}

/** `.input` base. Exported: many surfaces put the class straight onto a `Prim.TextField`/
 * `Prim.TextArea`/`Prim.Select` rather than going through this element. */
export const INPUT_BASE = {
  display: 'flex',
  height: '$9',
  width: '100%',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$input',
  backgroundColor: '$background',
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  fontSize: '$sm',
  placeholderTextColor: '$muted-foreground', // placeholder:text-muted-foreground
  // focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
  focusVisibleStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' },
  // disabled:cursor-not-allowed disabled:opacity-50
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },
} as const

/** `.input--error` — destructive border + a /30-alpha focus ring. */
const ERROR = {
  borderColor: '$destructive',
  focusVisibleStyle: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)',
  },
} as const

/** `.input--sm`. `default` is a no-op: `.input` already carries h-9/px-3/text-sm. */
export const INPUT_SM = { height: '$7', fontSize: '$xs', paddingHorizontal: '$2' } as const

const SIZE: Record<'default' | 'sm', Record<string, unknown>> = {
  default: {},
  sm: INPUT_SM,
}

function Input({ error, size = 'default', ...props }: InputProps) {
  return (
    <Prim.TextField
      {...INPUT_BASE}
      {...SIZE[size]}
      {...(error ? ERROR : {})}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Input }
