/**
 * `detail` — one record. Replaces the core of ~20 catalogue pages.
 *
 * The record is reached by `param`, which defaults to the route's single `[param]`: a page
 * at `recipes/[id]` does not have to say `param: '$route.id'`, because there is nothing
 * else it could mean. That default is why 20 detail pages need one line of spec each.
 *
 * S1 is doing quiet heavy lifting in `fields`: a keyvalue row whose value is missing takes
 * its LABEL with it, so a record with three of its eight optional fields populated shows
 * three rows rather than eight, five of them reading "Paid by · —". That is the behaviour
 * the hand-written pages spent `{x ? … : null}` on, and it is why this section needs no
 * conditionals.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import type { DetailSection } from '../types'
import { itemScope, resolveValue, type Scope } from '../bind'
import { renderSlot } from '../elements'
import { KeyValueRows } from '../elements'
import { ActionRow } from '../actions'
import { usePublish } from '../runtime'
import { SectionFrame, titleFromEndpoint, useSectionSource } from './common'

export function DetailSectionView({ section, scope }: { section: DetailSection; scope: Scope }): React.ReactElement {
  const source = useSectionSource({
    query: section.query,
    input: section.input,
    param: section.param,
    poll: section.poll,
    scope,
    id: section.id,
  })
  usePublish(section.id, source.query.data)

  const record = source.record
  const inner = itemScope(scope, record)
  const title = resolveValue(section.title, scope).value ?? titleFromEndpoint(section.query)

  return (
    <SectionFrame
      title={title as string | undefined}
      scope={scope}
      source={source}
      skeleton="block"
      empty={section.empty}
      emptyDefault="Not found"
      isEmpty={record === undefined || record === null}
      actions={<ActionRow items={section.actions} scope={inner} size="sm" />}
    >
      <Prim.Col gap="$4">
        {section.header ? renderSlot(section.header, inner) : null}
        {section.fields ? <KeyValueRows pairs={section.fields} scope={inner} /> : null}
        {section.body ? renderSlot(section.body, inner) : null}
      </Prim.Col>
    </SectionFrame>
  )
}
