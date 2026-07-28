/**
 * A bare string child, in every component that takes one.
 *
 * React Native raises "Text strings must be rendered within a `<Text>` component" and then DROPS
 * the string. On web the same markup — `<DropdownItem>Add channel</DropdownItem>` — is ordinary and
 * correct, so it is written that way everywhere, `tsc` is happy, jsdom is happy, and the Metro
 * graph gate only proves the module resolved. It surfaces the first time somebody opens the menu on
 * a device, which is exactly how it was found: tapping the channel section's ⋮ menu logged the
 * error and drew two empty rows.
 *
 * The individual surface suites already check this for what they render (`looseStrings` in
 * `team.tsx`), but that only covers components a suite happens to mount. This one asserts the
 * property over the shared LEAF components themselves — the ones whose whole job is to accept a
 * caller's children — so a surface written the web way is safe by construction rather than by
 * having been tested.
 *
 * `labelled()` is what makes it true, and it is shared for the same reason: `Button` had a private
 * copy and every sibling had the same bug and no copy.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, NATIVE_TEXT, type NativeNode } from '../render'

import { Button } from '../../src/elements/forms/button'
import { DropdownItem } from '../../src/elements/overlays/dropdown'
import { Item as ContextMenuItem } from '../../src/elements/overlays/context-menu'
import { SelectOption } from '../../src/elements/forms/select'
import { ListItem } from '../../src/elements/content/list-item'
import { Badge } from '../../src/elements/content/badge'

/** Reproduces React Native's own check: a string may only sit under a text host. */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT) as NativeNode[]) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(child)
    }
  }
  return out
}

/**
 * Every shared leaf whose contract is "render the children I am given".
 *
 * Listed by hand rather than discovered, because the property only makes sense for a component that
 * accepts arbitrary children — and a list that has to be added to is the point: a new one is a
 * deliberate decision, the same way a new fork is.
 */
const LEAVES: Array<[string, React.ReactElement]> = [
  ['Button', <Button>Save</Button>],
  ['DropdownItem', <DropdownItem>Add channel</DropdownItem>],
  ['ContextMenuItem', <ContextMenuItem>Rename</ContextMenuItem>],
  ['SelectOption', <SelectOption value="a">Editor</SelectOption>],
  ['ListItem', <ListItem>A row</ListItem>],
  ['Badge', <Badge>editor</Badge>],
]

for (const [name, element] of LEAVES) {
  test(`${name} wraps a bare string child, instead of dropping it on a device`, () => {
    const { tree } = render(element)
    expect(looseStrings(tree).join('|'), `${name} leaves no string loose in a View`).toBe('')
  })
}
