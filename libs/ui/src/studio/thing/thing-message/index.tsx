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
      className={cn(
        'card',
        'thing-message',
        isUser ? 'thing-message--user' : 'thing-message--assistant',
      )}
    >
      <Prim.Box className="card__body">
        <Caption
          muted={!isUser}
          className={cn('thing-message__role', isUser && 'thing-message__role--user')}
        >
          {isUser ? 'You' : 'Agent'}
        </Caption>
        <Prim.Box className="thing-message__content">
          {content}
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}
