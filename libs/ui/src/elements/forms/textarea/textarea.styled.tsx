/**
 * textarea.styled.tsx — P2 leaf conversion of the `.textarea` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/forms/textarea/index.css —
 * the `.textarea` base + `.textarea--sm` (the `compact` prop) — into ONE `styled(View, { variants })`
 * using the SPIKE-A1 var-backed `$` colors and SPIKE-B Tailwind scales.
 *
 * Lands alongside the shipped className Textarea (index.tsx); textarea-styled.test.tsx pins the frame.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * The `.textarea` base + the `compact` variant:
 *   .textarea      → flex, min-h-20, w-full, rounded-md, border-input, bg-background, px-3/py-2,
 *                    text-sm, placeholder muted-foreground, focus-visible ring, disabled, resize-y
 *   .textarea--sm  → compact (min-h-14, text-xs, px-2, py-1.5)
 */
export const TextareaFrame = styled(View, {
  name: 'Textarea',
  tag: 'textarea',
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
  resize: 'vertical', // resize-y (web-only style; native textarea has no resize)
  focusVisibleStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' },
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },

  variants: {
    compact: {
      true: { minHeight: '$14', fontSize: '$xs', paddingHorizontal: '$2', paddingVertical: '$1.5' },
    },
  } as const,
})

export interface StyledTextareaProps extends React.ComponentProps<'textarea'> {
  compact?: boolean
}

const Frame = TextareaFrame as unknown as React.ComponentType<any>

/** Idiomatic Textarea — same public API as the shipped className Textarea (`compact?: boolean`). */
export function StyledTextarea({ compact, ...props }: StyledTextareaProps) {
  return <Frame compact={compact} {...props} />
}
