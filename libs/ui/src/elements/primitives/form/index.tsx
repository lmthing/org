import * as React from 'react'
import { hostPrimitive } from '../_host'

/**
 * Form — the `<form>` primitive (Phase 0). Pure passthrough. On native there is no `<form>`;
 * Phase 1's native fork renders a plain container and wires `onSubmit` to the submit control.
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type FormProps = React.FormHTMLAttributes<HTMLFormElement>

const Form = hostPrimitive<HTMLFormElement, FormProps>('form', 'Form')

export { Form }
