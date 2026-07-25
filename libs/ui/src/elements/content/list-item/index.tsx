import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * ListItem — the idiomatic `.list-item`. Renders `Prim.Box` (real `<div>`) with the styling as
 * `$`-token PROPS transcribed from its retired `styled()` proof; label/meta render `Prim.Text` (`<span>`). CSS deleted.
 */
// `Prim.*StyleProps` too: the body spreads props straight onto a Tamagui primitive, so style props
// have always WORKED here — they just could not be typed, which is what forced callers into `style`.
export interface ListItemProps extends React.ComponentProps<'div'>, Prim.LayoutStyleProps, Prim.BoxStyleProps, Prim.MarginStyleProps, Prim.TextStyleProps {
  selected?: boolean
  label?: React.ReactNode
  meta?: React.ReactNode
}

function ListItem({ selected, label, meta, children, ...props }: ListItemProps) {
  return (
    <Prim.Box
      display="flex"
      alignItems="center"
      gap="$3"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius="$radius-md"
      fontSize="$sm"
      cursor="pointer"
      hoverStyle={{ backgroundColor: '$accent', color: '$accent-foreground' }}
      {...(selected ? { backgroundColor: '$accent', color: '$accent-foreground', fontWeight: '$medium' } : {})}
      {...(props as Record<string, unknown>)}
    >
      {label != null ? (
        <>
          <Prim.Text
            flexGrow={1}
            flexShrink={1}
            flexBasis="0%"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            color="$foreground"
          >
            {label}
          </Prim.Text>
          {meta != null && (
            <Prim.Text fontSize="$xs" color="$muted-foreground" flexShrink={0}>
              {meta}
            </Prim.Text>
          )}
        </>
      ) : (
        children
      )}
    </Prim.Box>
  )
}

export { ListItem }
