import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Textarea — the idiomatic `.textarea`. Renders `Prim.TextArea` (a real `<textarea>` at runtime via
 * `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4/§6). `textarea/index.css` is deleted.
 */
export interface TextareaProps extends React.ComponentProps<'textarea'> {
  compact?: boolean
}

/** `.textarea` base. */
const BASE = {
  display: 'flex',
  minHeight: '$20',
  width: '100%',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$input',
  backgroundColor: '$background',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  placeholderTextColor: '$muted-foreground',
  resize: 'vertical', // resize-y
  focusVisibleStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' },
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },
} as const

/** `.textarea--sm`. */
const COMPACT = {
  minHeight: '$14',
  fontSize: '$xs',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
} as const

function Textarea({ compact, ...props }: TextareaProps) {
  return (
    <Prim.TextArea {...BASE} {...(compact ? COMPACT : {})} {...(props as Record<string, unknown>)} />
  )
}

export { Textarea }
