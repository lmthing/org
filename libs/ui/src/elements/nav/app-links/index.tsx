import '@lmthing/css/elements/nav/app-links/index.css'
import { cn } from '../../../lib/utils'
import { otherAppLinks, type LmthingApp } from '../../../lib/app-urls'

export interface AppLinksProps {
  /** The current surface — its own link is omitted from the row. */
  current: LmthingApp
  className?: string
}

/**
 * Horizontal pill row linking to the *other* lmthing surfaces, used in the
 * chat + studio sidebar footers. Uses {@link otherAppLinks} so local vs
 * production origins are resolved consistently.
 */
export function AppLinks({ current, className }: AppLinksProps) {
  return (
    <div className={cn('app-links', className)}>
      {otherAppLinks(current).map((link) => (
        <a
          key={link.app}
          href={link.url}
          title={`Open lmthing.${link.app}`}
          className="app-links__link"
        >
          <span aria-hidden="true">{link.emoji}</span>
          {link.label}
        </a>
      ))}
    </div>
  )
}
