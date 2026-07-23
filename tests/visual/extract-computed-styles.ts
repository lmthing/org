import type { Page, Locator } from '@playwright/test'
import { AUDITED_PROPERTIES } from './audited-properties'

/**
 * Walks a fixture stage subtree in the browser and records getComputedStyle for the audited
 * property set (§3 Layer 2) on every element, keyed by a stable structural path
 * (`tag[childIndex]/…`) so a structural change (an added/removed element, a reparent) shows up as
 * a key mismatch rather than a silently-shifted comparison.
 */
export type ElementStyles = Record<string, string>
export type FixtureStyles = Record<string, ElementStyles>

export async function extractFixtureStyles(page: Page, fxName: string): Promise<FixtureStyles> {
  const stage: Locator = page.locator(`[data-fx-stage="${fxName}"]`)
  await stage.waitFor({ state: 'attached' })
  return stage.evaluate(
    (root, props) => {
      const out: Record<string, Record<string, string>> = {}
      const walk = (el: Element, path: string) => {
        const cs = getComputedStyle(el as HTMLElement)
        const rec: Record<string, string> = {}
        for (const p of props) rec[p] = cs.getPropertyValue(p).trim()
        out[path] = rec
        const kids = Array.from(el.children)
        kids.forEach((child, i) => {
          walk(child, `${path}/${child.tagName.toLowerCase()}[${i}]`)
        })
      }
      walk(root, root.tagName.toLowerCase())
      return out
    },
    AUDITED_PROPERTIES as unknown as string[],
  )
}
