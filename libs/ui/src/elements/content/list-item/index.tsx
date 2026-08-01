import * as React from 'react'
import { labelled } from '../../primitives/labelled'
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
  // The row's EFFECTIVE label styling — not just its own props. `Prim.Box` is an RN `View`, so
  // `selected`'s `color`/`fontWeight` above style the row's background and nothing else; the label
  // used to hardcode `color="$foreground"` regardless, which meant a selected row's own label never
  // switched to `$accent-foreground` — on WEB too, not only native, because an explicit `color` prop
  // on the label always wins over whatever the row (its parent) resolves to, selected or not. So
  // this is the one true source for what the label/meta/bare-children Text should render in, computed
  // once so `selected` really does recolor the row's TEXT, not just its fill.
  const labelFace: Prim.TextProps = selected
    ? { color: '$accent-foreground', fontWeight: '$medium' }
    : { color: '$foreground' }
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
            {...labelFace}
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
        // A caller may pass a bare string here, which React Native drops. See `labelled`. Also
        // carries `labelFace`, which `labelled` already knows to spread selectively (never an
        // explicit `undefined`, which would clobber `NativeText`'s own default) — needed because
        // this branch previously passed NO styling at all, so a selected row with bare-string
        // children kept its label at `NativeText`'s default `$foreground`/regular weight too.
        labelled(children, labelFace)
      )}
    </Prim.Box>
  )
}

export { ListItem }
