/**
 * The Home dashboard and the surface switcher, MOUNTED on the React Native target.
 *
 * Home is the first screen a signed-in user sees, so the invariants that matter most are the ones a
 * device enforces and no jsdom test can: no string outside a text host (React Native drops it and
 * the label is simply absent), and no style value where Android expects a `Double`.
 *
 * The data hook is not stubbed — `fetch` is. Home's contract is that its three sources fail
 * INDEPENDENTLY, so the interesting case is not "everything loaded" but "the gateway is
 * unreachable and the pod is fine", which is what a phone on a bad connection actually gets.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, findByText, flattenStyle, NATIVE_TEXT } from '../render'
import { AuthProvider } from '@lmthing/auth'
import { DashboardHome } from '../../src/dashboard/DashboardHome'
import { SurfaceSwitcher } from '../../src/elements/nav/surface-switcher'

function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT)) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(`${node.type}: ${child}`)
    }
  }
  return out
}

/** Every source rejects — the "offline phone" case. */
function withFailingFetch(run: () => void): void {
  const original = globalThis.fetch
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  try {
    run()
  } finally {
    globalThis.fetch = original
  }
}

function renderHome() {
  return render(
    <AuthProvider appName="mobile">
      <DashboardHome />
    </AuthProvider>,
  )
}

test('Home mounts no bare strings outside a native text host', () => {
  withFailingFetch(() => {
    const { tree } = renderHome()
    expect(looseStrings(tree)).toEqual([])
  })
})

test('Home still greets and offers a new chat when every source fails', () => {
  // The point of settling the three sources independently: an unreachable gateway must not blank
  // the screen. The primary action has to survive a total data failure.
  withFailingFetch(() => {
    const { tree } = renderHome()
    expect(findByText(tree, 'Ask THING anything…')?.type).toBe(NATIVE_TEXT)
  })
})

test('the surface switcher renders every surface as real text', () => {
  const { tree } = render(<SurfaceSwitcher current="home" onSwitch={() => {}} />)
  for (const label of ['Home', 'Chat', 'Teams']) {
    expect(findByText(tree, label)?.type).toBe(NATIVE_TEXT)
  }
  expect(looseStrings(tree)).toEqual([])
})

test('the surface switcher lays out as a ROW — `display: flex` alone would stack it on native', () => {
  const { tree } = render(<SurfaceSwitcher current="home" onSwitch={() => {}} />)
  const label = findByText(tree, 'Home')
  const bar = findAll(tree, () => true).find((n) =>
    (n.children ?? []).some((c) => c !== null && typeof c === 'object'),
  )
  expect(label).toBeTruthy()
  expect(flattenStyle(bar?.props?.style).flexDirection).toBe('row')
})

test('WITHOUT onSwitch (web) it drops Home — there is no lmthing.home to link at', () => {
  const { tree } = render(<SurfaceSwitcher current="chat" />)
  expect(findByText(tree, 'Home')).toBe(null)
  for (const label of ['Chat', 'Teams']) {
    expect(findByText(tree, label)?.type).toBe(NATIVE_TEXT)
  }
})
