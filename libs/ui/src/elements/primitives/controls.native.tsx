import * as React from 'react'
import { TextInput } from 'react-native'
import { NativeText, NativeView } from './_native'

/**
 * Form-control primitives (native fork): `TextField`/`TextArea` → RN `TextInput` (multiline for
 * TextArea), `Select`/`Option` → placeholder containers (a real native picker is a follow-up).
 * Same symbols + prop shapes as `controls.tsx` (web); web-only attrs are mapped/ignored:
 * `value`/`placeholder`/`onChange`→`onChangeText`. Metro prefers this `.native.tsx`.
 * (Typechecked in the mobile app, which provides react-native types.)
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>
export const TextField = React.forwardRef<any, TextFieldProps>(
  ({ value, placeholder, onChange, style }, ref) => (
    <TextInput
      ref={ref}
      value={value as string | undefined}
      placeholder={placeholder}
      onChangeText={(t) =>
        onChange?.({ target: { value: t } } as unknown as React.ChangeEvent<HTMLInputElement>)
      }
      style={style as never}
    />
  ),
)
TextField.displayName = 'TextField'

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>
export const TextArea = React.forwardRef<any, TextAreaProps>(
  ({ value, placeholder, onChange, style }, ref) => (
    <TextInput
      ref={ref}
      multiline
      value={value as string | undefined}
      placeholder={placeholder}
      onChangeText={(t) =>
        onChange?.({ target: { value: t } } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
      }
      style={style as never}
    />
  ),
)
TextArea.displayName = 'TextArea'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>
export const Select = React.forwardRef<any, SelectProps>(({ children, style }, ref) => (
  <NativeView ref={ref} style={style as never}>
    {children}
  </NativeView>
))
Select.displayName = 'Select'

export type OptionProps = React.OptionHTMLAttributes<HTMLOptionElement>
export const Option = React.forwardRef<any, OptionProps>(({ children, style }, ref) => (
  <NativeText ref={ref} style={style as never}>
    {children}
  </NativeText>
))
Option.displayName = 'Option'
