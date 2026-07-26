import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * Form (native fork). RN has no `<form>`; renders a plain container. `onSubmit` is wired by the
 * submit control on native. Same prop shape as the web `Form`. Metro prefers this `.native.tsx`.
 * See docs/react-native-tamagui-migration.md §1.5.
 */
/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { FormProps as FormPrimitiveProps } from '../_tamagui'

export type FormProps = FormPrimitiveProps

const Form = React.forwardRef<any, FormProps>(({ children, ...props }, ref) => (
  <NativeView ref={ref} {...nativeSafeProps(props)}>
    {children}
  </NativeView>
))
Form.displayName = 'Form'

export { Form }
