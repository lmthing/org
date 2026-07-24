/**
 * list-item.styled.tsx — P2 leaf conversion of the `.list-item` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/list-item/index.css
 * — the `.list-item` base + `.list-item--selected` and the `.list-item__label`/`__meta` parts — into
 * idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * Lands alongside the shipped className ListItem (index.tsx); list-item-styled.test.tsx pins them.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.list-item` base (flex, items-center, gap-3, px-3, py-2, rounded-md, text-sm, hover accent,
 * cursor-pointer; `transition-colors` awaits the animation driver, §5/P4) + the `selected` variant.
 */
export const ListItemFrame = styled(View, {
  name: 'ListItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-md',
  fontSize: '$sm',
  cursor: 'pointer',
  hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },

  variants: {
    selected: {
      true: { backgroundColor: '$accent', color: '$accent-foreground', fontWeight: '$medium' },
    },
  } as const,
})

/** `.list-item__label` — flex-1, truncate, text-foreground. */
export const ListItemLabelFrame = styled(View, {
  name: 'ListItemLabel',
  tag: 'span',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  // truncate = overflow-hidden + text-ellipsis + whitespace-nowrap
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '$foreground',
})

/** `.list-item__meta` — text-xs, text-muted-foreground, shrink-0. */
export const ListItemMetaFrame = styled(View, {
  name: 'ListItemMeta',
  tag: 'span',
  fontSize: '$xs',
  color: '$muted-foreground',
  flexShrink: 0,
})

export interface StyledListItemProps extends React.ComponentProps<'div'> {
  selected?: boolean
  label?: React.ReactNode
  meta?: React.ReactNode
}

const Frame = ListItemFrame as unknown as React.ComponentType<any>
const Label = ListItemLabelFrame as unknown as React.ComponentType<any>
const Meta = ListItemMetaFrame as unknown as React.ComponentType<any>

/** Idiomatic ListItem — same public API as the shipped className ListItem (`selected`/`label`/`meta`). */
export function StyledListItem({ selected, label, meta, children, ...props }: StyledListItemProps) {
  return (
    <Frame selected={selected} {...props}>
      {label != null ? (
        <>
          <Label>{label}</Label>
          {meta != null && <Meta>{meta}</Meta>}
        </>
      ) : (
        children
      )}
    </Frame>
  )
}
