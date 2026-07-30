import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Label — the idiomatic `.label`, a form `<label>` (`Prim.Text as="label"`, real tag via
 * `createComponent`) styled by `$`-token PROPS transcribed from its retired `styled()` proof. The `required` marker renders a
 * destructive " *" span (replacing `.label--required::after`). The double-click text-selection guard
 * (Radix parity) is kept on `onMouseDown`. CSS deleted.
 */
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  compact?: boolean
  required?: boolean
}

function Label({ compact, required, onMouseDown, children, ...props }: LabelProps) {
  return (
    <Prim.Text
      as="label"
      fontSize={compact ? '$xs' : '$sm'}
      fontWeight="$medium"
      lineHeight={compact ? 12 : 14}
      color="$foreground"
      onMouseDown={(e: React.MouseEvent<HTMLElement>) => {
        onMouseDown?.(e as unknown as React.MouseEvent<HTMLLabelElement>)
        // Match Radix: don't start a text selection on a double (or more) click on the label.
        if (!e.defaultPrevented && e.detail > 1) e.preventDefault()
      }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
      {required && <Prim.Text color="$destructive"> *</Prim.Text>}
    </Prim.Text>
  )
}

export { Label }
