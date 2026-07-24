import * as Prim from '../../../elements/primitives/index.js';
import { cn } from '@lmthing/ui/lib/utils'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import '@lmthing/css/components/thing/thing-message/index.css'
import '@lmthing/css/elements/content/card/index.css'

interface ThingMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export function ThingMessage({ role, content }: ThingMessageProps) {
  const isUser = role === 'user'

  return (
    <Prim.Box
      className="card"
      maxWidth="80%"
      {...(isUser
        ? {
            marginLeft: 'auto',
            backgroundColor: '$primary',
            color: 'white', // ds-lint-ok: `.thing-message--user` uses literal `white`, not the theme-flipping $primary-foreground
          }
        : { marginRight: 'auto' })}
    >
      <Prim.Box className="card__body">
        <Caption
          muted={!isUser}
          className={cn('thing-message__role', isUser && 'thing-message__role--user')}
        >
          {isUser ? 'You' : 'Agent'}
        </Caption>
        <Prim.Text whiteSpace="pre-wrap" fontSize="$sm" lineHeight={'1.5' as unknown as number}>
          {content}
        </Prim.Text>
      </Prim.Box>
    </Prim.Box>
  )
}
