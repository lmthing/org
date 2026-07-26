import * as React from 'react'
import { TextInput } from 'react-native'
import { NativeText, NativeView, nativeSafeProps, styled } from './_native'

/**
 * Form-control primitives (native fork): `TextField`/`TextArea` → RN `TextInput` (multiline for
 * TextArea), `Select`/`Option` → placeholder containers (a real native picker is a follow-up).
 * Same symbols + prop shapes as `controls.tsx` (web). Metro prefers this `.native.tsx`.
 * (Typechecked in the mobile app, which provides react-native types.)
 *
 * **These forks used to destructure `value`/`placeholder`/`onChange`/`style` and drop everything
 * else**, which meant `Input`'s whole `INPUT_BASE` — height, border, radius, background, font size,
 * the focus ring — evaporated on native and every text field rendered as an unstyled system input.
 * Box and Text were fixed to forward through `nativeSafeProps`; these were missed, so the styling
 * axis was only half done. They now go through the same seam, on a Tamagui-styled `TextInput` so
 * `$`-tokens resolve.
 *
 * Three web props have no RN prop of the same name and are translated rather than forwarded:
 * `onChange`(event) → `onChangeText`(string), `type="password"` → `secureTextEntry`, and
 * `disabled` → `editable={false}`. The first two are why `nativeSafeProps` alone is not enough
 * here — it drops `onChange` as a DOM handler, and `type` means nothing to a `TextInput`.
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */

/**
 * A Tamagui-styled RN `TextInput`. `styled()` is what makes `$`-token style props (`height: '$9'`,
 * `borderColor: '$input'`, `fontSize: '$sm'`) resolve against the shared config — spreading them
 * onto a raw `TextInput` would pass unknown props to a native view, which silently ignores them.
 */
const NativeTextInput: React.ComponentType<any> = styled(
  TextInput,
  {
    name: 'NativeTextInput',
    // Same reason as `NativeText`: a `$`-token fontSize is looked up in the font face's scale, so
    // with no family set Tamagui has nothing to resolve against and drops the size silently.
    fontFamily: '$body',
  },
  {
    // `isInput` goes in styled()'s THIRD argument — the static config. Putting it in the second
    // (the style bag, where `name` lives) makes it an ordinary prop and it does nothing at all.
    //
    // It is load-bearing, not a label: without it Tamagui does not treat the target as a text
    // surface, so `fontSize`/`fontFamily` are forwarded as bare PROPS. An RN `TextInput` accepts
    // unknown props silently and reads typography only from `style`, so the field renders at the
    // platform default size with nothing anywhere reporting a problem. The render assertion in
    // `metro/suites/primitives.tsx` is what pins this; web cannot see it.
    isInput: true,
  },
) as unknown as React.ComponentType<any>

/**
 * Split a web control's props into the RN-translated ones and the rest (forwarded through
 * `nativeSafeProps`, so style props and `$`-tokens survive).
 */
function controlProps({
  value,
  onChange,
  type,
  disabled,
  ...rest
}: Record<string, any>): Record<string, unknown> {
  return {
    ...nativeSafeProps(rest),
    value: value as string | undefined,
    // RN hands back the string; the web surfaces read `event.target.value`, so the shape they
    // expect is reconstructed rather than making every caller branch on platform.
    onChangeText: onChange
      ? (text: string) => onChange({ target: { value: text } } as never)
      : undefined,
    // Without this a `type="password"` field renders its content in plain text — which is what
    // `SettingsSchemaForm` uses for every integration API token.
    ...(type === 'password' ? { secureTextEntry: true } : {}),
    ...(disabled ? { editable: false } : {}),
  }
}

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement>
export const TextField = React.forwardRef<any, TextFieldProps>((props, ref) => (
  <NativeTextInput ref={ref} {...controlProps(props as Record<string, any>)} />
))
TextField.displayName = 'TextField'

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>
export const TextArea = React.forwardRef<any, TextAreaProps>((props, ref) => (
  <NativeTextInput ref={ref} multiline {...controlProps(props as Record<string, any>)} />
))
TextArea.displayName = 'TextArea'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>
export const Select = React.forwardRef<any, SelectProps>(({ children, ...props }, ref) => (
  <NativeView ref={ref} {...nativeSafeProps(props)}>
    {children}
  </NativeView>
))
Select.displayName = 'Select'

export type OptionProps = React.OptionHTMLAttributes<HTMLOptionElement>
export const Option = React.forwardRef<any, OptionProps>(({ children, ...props }, ref) => (
  <NativeText ref={ref} {...nativeSafeProps(props)}>
    {children}
  </NativeText>
))
Option.displayName = 'Option'
