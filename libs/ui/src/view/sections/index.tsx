/**
 * The section dispatcher — the one place a `kind` becomes a rendering.
 *
 * The union is FULL at 8. The `never`-typed default is the guard: a ninth kind added to
 * the contract and not handled here fails `pnpm typecheck`, rather than rendering nothing
 * on a device where nobody would see the difference between "unimplemented" and "no data".
 */

import * as React from 'react'
import type { SectionSpec } from '../types'
import type { Scope } from '../bind'
import { CollectionSection } from './collection'
import { DetailSectionView } from './detail'
import { CreateSectionView } from './create'
import { StatsSectionView, MarkdownSectionView, ToolbarSectionView } from './misc'
import { ChatSectionView } from './chat'

export function SectionView({ section, scope }: { section: SectionSpec; scope: Scope }): React.ReactElement | null {
  switch (section.kind) {
    case 'list':
    case 'timeline':
      return <CollectionSection section={section} scope={scope} />
    case 'detail':
      return <DetailSectionView section={section} scope={scope} />
    case 'create':
      return <CreateSectionView section={section} scope={scope} />
    case 'stats':
      return <StatsSectionView section={section} scope={scope} />
    case 'markdown':
      return <MarkdownSectionView section={section} scope={scope} />
    case 'toolbar':
      return <ToolbarSectionView section={section} scope={scope} />
    case 'chat':
      return <ChatSectionView section={section} scope={scope} />
    default: {
      const never: never = section
      void never
      return null
    }
  }
}

export { CollectionSection, DetailSectionView, CreateSectionView, StatsSectionView, MarkdownSectionView, ToolbarSectionView, ChatSectionView }
export * from './common'
