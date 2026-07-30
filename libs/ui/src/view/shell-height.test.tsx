import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, waitFor } from '../test-utils/index'
import { ViewRenderer } from './renderer'
import { createViewClient, type EndpointManifest } from './client'
import type { ViewSpec } from './types'

/**
 * The shell must declare a DEFINITE HEIGHT, not only `flexGrow`.
 *
 * This exists because of a total, silent failure on the first model-built app: every page rendered
 * blank. The shell's root Col sized to its content (98px — the top bar plus the assistant strip)
 * because the web mount point is a plain `<div>` (`display: block`) under `display: contents` theme
 * wrappers, and a block box is not a flex container, so `flexGrow: 1` had nothing to grow inside.
 * Every descendant then divided zero: the scroller ended up `clientHeight: 0` around 719px of
 * content and the first list row's buttons sat at `y: -107`, off-screen and unclickable.
 *
 * **Why this asserts a declaration and not the geometry.** jsdom has no layout engine — every
 * `getBoundingClientRect()` is 0×0 — so a jsdom test cannot tell a collapsed shell from a healthy
 * one, and neither can the Metro suites, which mount without laying out. The bug was found by
 * screenshotting a real browser, and the real regression gate for it is the render rig
 * (Workstream D). This is the cheap structural guard that keeps the lesson next to the code: the
 * root must carry a height that does not depend on its parent being a flex container.
 */

const MANIFEST: EndpointManifest = { listPlants: { method: 'GET', routePath: '/plants' } }

function stubbedClient() {
  const client = createViewClient({
    baseUrl: '',
    endpoints: MANIFEST,
    fetchImpl: (async () => {
      throw new Error('fetchImpl should not be reached — call is stubbed')
    }) as never,
  })
  return { ...client, call: async () => [{ id: '1', name: 'Monstera' }] } as never
}

const SPEC: ViewSpec = {
  route: 'plants',
  title: 'Plants',
  sections: [{ kind: 'list', query: 'listPlants', item: { title: '$.name' } }],
}

describe('the view shell declares its own height', () => {
  it('sets a definite height on the root, so a non-flex mount point cannot collapse it', async () => {
    const { container } = render(
      <ViewRenderer spec={SPEC} shell={{ brand: 'Houseplant Care' }} routes={['index', 'plants']} client={stubbedClient()} />,
    )
    await waitFor(() => expect(container.textContent).toContain('Monstera'))

    // `render()` returns a wrapper, so the shell root is the wrapper's first element child. Tamagui
    // may compile a style prop to a class, so accept either surface.
    const root = container.querySelector('div') as HTMLElement | null
    expect(root, 'the shell rendered no root element').not.toBeNull()

    // Tamagui compiles `height="100%"` to an atomic class (`_height-10037`), so the declaration
    // lives on className rather than in an inline style. `_minHeight-` must NOT satisfy this — a
    // min-height still lets the box size to its content, which is the exact bug.
    const style = root!.getAttribute('style') ?? ''
    const declaresHeight =
      /(^|[;\s])height\s*:/.test(style) || /(^|\s)_height-/.test(root!.className || '')
    expect(
      declaresHeight,
      'the shell root declares no height — under a display:block mount point it sizes to its ' +
        `content and every page renders blank. class="${root!.className}" style="${style}"`,
    ).toBe(true)
  })

  it('still renders the page content — the guard must not have replaced it', async () => {
    const { container } = render(
      <ViewRenderer spec={SPEC} shell={{ brand: 'Houseplant Care' }} routes={['index', 'plants']} client={stubbedClient()} />,
    )
    await waitFor(() => expect(container.textContent).toContain('Monstera'))
  })
})
