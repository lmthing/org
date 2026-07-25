import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import * as Prim from '../../../elements/primitives/index'

/**
 * NavLink — a router link that accepts Tamagui style props.
 *
 * TanStack Router's `<Link>` renders its own `<a>` and accepts only `className` (there is no
 * `asChild`), which is what kept `.sidebar__item` alive as a stylesheet through the rest of the
 * element-layer swap: the item look could not be expressed as props on the thing that needed it.
 * This renders `Prim.Link` — a real `<a>` via `createComponent` — and navigates itself, so the
 * styling is props like everywhere else (docs/tamagui-idiomatic-migration.md §4).
 *
 * It keeps a real `href`, so the status bar, middle-click, ⌘/Ctrl-click, Shift-click and
 * right-click → "Open in new tab" all behave like a normal link; only an unmodified left click is
 * intercepted for client-side navigation.
 *
 * Lives here rather than in `elements/**` on purpose: `@tanstack/react-router` is a surface
 * dependency, and the shared element layer stays router-agnostic.
 */
export interface NavLinkProps extends Omit<Prim.LinkProps, 'href'> {
  /** Absolute path to navigate to. */
  to: string
}

export function NavLink({ to, onClick, ...props }: NavLinkProps) {
  const navigate = useNavigate()
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e)
      if (e.defaultPrevented) return
      // Let the browser own every "open somewhere else" intent.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      void navigate({ to })
    },
    [navigate, to, onClick],
  )
  return <Prim.Link href={to} onClick={handleClick} {...props} />
}
