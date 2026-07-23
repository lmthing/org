/**
 * Viewport dimensions + resize subscription — WEB implementation (`window`). Native counterpart
 * uses RN `Dimensions`. Behind the `platform/` seam (§7 step 8); replaces raw
 * `window.innerWidth` / `window.addEventListener('resize', …)` in the surfaces.
 */
export type Size = { width: number; height: number }

export function getWindowSize(): Size {
  return {
    width: globalThis.window?.innerWidth ?? 0,
    height: globalThis.window?.innerHeight ?? 0,
  }
}

/** Subscribe to viewport size changes. Returns an unsubscribe fn. */
export function subscribeWindowSize(cb: (size: Size) => void): () => void {
  const handler = () => cb(getWindowSize())
  globalThis.window?.addEventListener('resize', handler)
  return () => globalThis.window?.removeEventListener('resize', handler)
}
