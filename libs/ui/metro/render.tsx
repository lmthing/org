/**
 * render.tsx — rendering a shared component on the React Native target.
 *
 * `react-test-renderer` is what RN's own jest preset renders with: it drives the real React
 * reconciler over host elements without a native view hierarchy, so what comes back from
 * `toJSON()` is the RN element tree a device would mount ("View"/"Text"/"TextInput"/…), styles
 * resolved by Tamagui's native path.
 *
 * The provider wraps the SHARED `tamaguiConfig` — the same object the web app builds with. That is
 * the point of the whole exercise: this file proves the config works with `isWeb === false`, which
 * a jsdom test structurally cannot (see `src/theme/tamagui-config.test.ts`, which has to
 * parameterise the branch instead of running it).
 */
import * as React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiConfig } from '../src/theme/tamagui.config'

export type NativeNode = {
  type: string
  props: Record<string, unknown>
  children: (NativeNode | string)[] | null
}

/**
 * The host names React Native actually mounts. They are the NATIVE view names (`RCTView`), not the
 * JS component names (`View`), because this harness does not mock RN's components — see
 * `native-mocks.cjs#NOT_MOCKED_COMPONENTS`. Named here so a suite asserts on a concept, and so the
 * platform-dependent ones stay in one place: a text input is `RCTSinglelineTextInputView` on iOS
 * and `AndroidTextInput` on Android, which is why {@link findTextInput} matches instead of compares.
 */
export const NATIVE_VIEW = 'RCTView'
export const NATIVE_TEXT = 'RCTText'
export const NATIVE_IMAGE = 'RCTImageView'

/** Render inside the shared Tamagui provider and return the RN element tree + the renderer. */
export function render(element: React.ReactElement, theme: 'light' | 'dark' = 'light') {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      <TamaguiProvider config={tamaguiConfig} defaultTheme={theme}>
        {element}
      </TamaguiProvider>,
    )
  })
  return { renderer, tree: renderer.toJSON() as NativeNode | null }
}

/** Depth-first search for the first node whose host type satisfies `match`. */
export function find(
  node: NativeNode | string | null,
  match: (type: string) => boolean,
): NativeNode | null {
  if (!node || typeof node === 'string') return null
  if (match(node.type)) return node
  for (const child of node.children ?? []) {
    const hit = find(child, match)
    if (hit) return hit
  }
  return null
}

/** Depth-first search for the first node of an exact host type (`RCTView`, `RCTText`, …). */
export function findByType(node: NativeNode | string | null, type: string): NativeNode | null {
  return find(node, (t) => t === type)
}

/**
 * The first text input in the tree. Matched by substring because RN mounts a DIFFERENT native view
 * per platform and per mode — `RCTSinglelineTextInputView` / `RCTMultilineTextInputView` on iOS,
 * `AndroidTextInput` on Android — and a suite that hard-coded one would pass on `ios` and fail on
 * `android` for no product reason.
 */
export function findTextInput(node: NativeNode | string | null): NativeNode | null {
  return find(node, (t) => t.includes('TextInput'))
}

/** Every host type in the tree, in document order — handy for "what did this actually mount?". */
export function hostTypes(node: NativeNode | string | null, out: string[] = []): string[] {
  if (!node || typeof node === 'string') return out
  out.push(node.type)
  for (const child of node.children ?? []) hostTypes(child, out)
  return out
}

/**
 * Press a native node the way a finger does.
 *
 * There is no `onPress` prop on the mounted host element: React Native runs presses through the
 * RESPONDER system, so a component's `onPress` becomes `onStartShouldSetResponder` +
 * `onResponderGrant` + `onResponderRelease` on the host node. Asserting on an `onPress` prop
 * therefore tests nothing on native (and silently passes on web, where it does exist) — driving the
 * responder sequence is the only way to prove the handler is actually wired up.
 */
export function press(node: NativeNode | null): void {
  if (!node) throw new Error('press(): no node')
  const props = node.props as Record<string, (event: unknown) => unknown>
  if (typeof props.onResponderRelease !== 'function')
    throw new Error(`press(): ${node.type} has no responder handlers — nothing is listening`)
  const event = {
    nativeEvent: { locationX: 0, locationY: 0, pageX: 0, pageY: 0, timestamp: 0, touches: [], changedTouches: [] },
    currentTarget: 1,
    target: 1,
    persist() {},
    preventDefault() {},
    stopPropagation() {},
  }
  act(() => {
    props.onStartShouldSetResponder?.(event)
    props.onResponderGrant?.(event)
    props.onResponderRelease?.(event)
  })
}

/**
 * RN accepts `style` as an object OR an array of objects (and nested arrays). Assertions want one
 * flat bag, which is also how the device flattens it.
 */
export function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {}
  if (Array.isArray(style)) return style.reduce((acc, s) => ({ ...acc, ...flattenStyle(s) }), {})
  return style as Record<string, unknown>
}

/** The flattened style of the first node of `type`. */
export function styleOf(node: NativeNode | string | null, type: string): Record<string, unknown> {
  const found = findByType(node, type)
  return flattenStyle(found?.props?.style)
}
