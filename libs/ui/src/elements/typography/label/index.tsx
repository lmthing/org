import '@lmthing/css/elements/typography/label/index.css'
import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Label — a form label. Migrated off `@radix-ui/react-label` to the universal Tamagui `Text as="label"`
 * (Part III / B3.4): Radix Label.Root is a `<label>` whose only extra behaviour is suppressing
 * text-selection on a double-click; a native `<label htmlFor>` already handles click-to-focus, so
 * `Prim.Text as="label"` matches for our use. Renders on native via the Text fork. Keeps the `label`
 * CSS classes and the `htmlFor`/`compact`/`required` API. The double-click guard is preserved via
 * `onMouseDown`.
 */
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  compact?: boolean
  required?: boolean
}

function Label({ className, compact, required, onMouseDown, ...props }: LabelProps) {
  return (
    <Prim.Text
      as="label"
      className={cn('label', compact && 'label--sm', required && 'label--required', className)}
      onMouseDown={(e: React.MouseEvent<HTMLElement>) => {
        onMouseDown?.(e as unknown as React.MouseEvent<HTMLLabelElement>)
        // Match Radix: don't start a text selection on a double (or more) click on the label.
        if (!e.defaultPrevented && e.detail > 1) e.preventDefault()
      }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    />
  )
}

export { Label }
