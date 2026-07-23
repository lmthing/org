import { Dimensions } from 'react-native'

/**
 * Viewport dimensions + resize subscription — NATIVE implementation (RN `Dimensions`). Mirrors
 * `dimensions.ts` (web). See §7 step 8.
 */
export type Size = { width: number; height: number }

export function getWindowSize(): Size {
  const { width, height } = Dimensions.get('window')
  return { width, height }
}

export function subscribeWindowSize(cb: (size: Size) => void): () => void {
  const sub = Dimensions.addEventListener('change', ({ window }) => {
    cb({ width: window.width, height: window.height })
  })
  return () => sub.remove()
}
