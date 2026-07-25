import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * Form (native fork). RN has no `<form>`; renders a plain container. `onSubmit` is wired by the
 * submit control on native. Same prop shape as the web `Form`. Metro prefers this `.native.tsx`.
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type FormProps = React.FormHTMLAttributes<HTMLFormElement>

const Form = React.forwardRef<any, FormProps>(({ children, ...props }, ref) => (
  <NativeView ref={ref} {...nativeSafeProps(props)}>
    {children}
  </NativeView>
))
Form.displayName = 'Form'

export { Form }
