/**
 * label.styled.tsx — P2 leaf conversion of the `.label` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/typography/label/index.css
 * — the `.label` base + `.label--sm` (`compact`) and `.label--required` — into ONE
 * `styled(Text, { variants })` using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * `leading-none` → the unitless multiplier `1`. The `.label--required::after` pseudo-element (a
 * destructive " *") is not expressible as a style prop, so it becomes a real rendered marker element
 * in the component — the idiomatic replacement for a content:'' pseudo. Lands alongside the shipped
 * className Label (index.tsx); label-styled.test.tsx pins it.
 */
import * as React from 'react'
import { styled, Text } from '../../../theme/tamagui-web.config'

/** `.label` base (text-sm, font-medium, leading-none, text-foreground) + the `compact` variant. */
export const LabelFrame = styled(Text, {
  name: 'Label',
  tag: 'label',
  fontSize: '$sm',
  fontWeight: '$medium',
  lineHeight: '1' as unknown as number, // leading-none
  color: '$foreground',

  variants: {
    compact: {
      true: { fontSize: '$xs' }, // .label--sm (font-medium already on the base)
    },
  } as const,
})

/** The destructive " *" marker — the rendered replacement for `.label--required::after`. */
export const LabelRequiredMarkFrame = styled(Text, {
  name: 'LabelRequiredMark',
  tag: 'span',
  color: '$destructive',
})

export interface StyledLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  compact?: boolean
  required?: boolean
}

const Frame = LabelFrame as unknown as React.ComponentType<any>
const Mark = LabelRequiredMarkFrame as unknown as React.ComponentType<any>

/** Idiomatic Label — same public API as the shipped className Label (`compact`/`required`/`htmlFor`). */
export function StyledLabel({ compact, required, onMouseDown, children, ...props }: StyledLabelProps) {
  return (
    <Frame
      compact={compact}
      onMouseDown={(e: React.MouseEvent<HTMLElement>) => {
        onMouseDown?.(e as unknown as React.MouseEvent<HTMLLabelElement>)
        // Match Radix: don't start a text selection on a double (or more) click on the label.
        if (!e.defaultPrevented && e.detail > 1) e.preventDefault()
      }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
      {required && <Mark> *</Mark>}
    </Frame>
  )
}
