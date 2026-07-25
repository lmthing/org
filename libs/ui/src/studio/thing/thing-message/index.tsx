import * as Prim from '../../../elements/primitives/index.js';
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { CARD_BASE, CARD_BODY } from '../../../elements/content/card/index.js'

interface ThingMessageProps {
  role: 'user' | 'assistant'
  content: string
}

export function ThingMessage({ role, content }: ThingMessageProps) {
  const isUser = role === 'user'

  return (
    <Prim.Box
      {...CARD_BASE}
      maxWidth="80%"
      {...(isUser
        ? {
            marginLeft: 'auto',
            backgroundColor: '$primary',
            color: 'white', // ds-lint-ok: `.thing-message--user` uses literal `white`, not the theme-flipping $primary-foreground
          }
        : { marginRight: 'auto' })}
    >
      <Prim.Box {...CARD_BODY}>
        <Caption
          muted={!isUser}
          marginBottom="0.25rem"
          {...(isUser
            ? { color: 'rgba(255, 255, 255, 0.7)' } // ds-lint-ok: literal white/70 on the primary bubble
            : {})}
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
