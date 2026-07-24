/** thing-message.styled.tsx — P2 conversion of the `.thing-message` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className message. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.thing-message` — max-width 80% bubble wrapper + `--user`/`--assistant` alignment modifiers.
 *  `--user` paints the primary surface with a literal white label (theme-independent, mirrors the
 *  shipped CSS `color: white`). */
export const ThingMessageFrame = styled(View, {
  name: 'ThingMessage',
  maxWidth: '80%',

  variants: {
    role: {
      user: {
        marginLeft: 'auto',
        backgroundColor: '$primary',
        color: 'white', // ds-lint-ok: `.thing-message--user` uses literal `white`, not the theme-flipping $primary-foreground
      },
      assistant: {
        marginRight: 'auto',
      },
    },
  } as const,
})

/** `.thing-message__role` — text-xs label with a `--user` alpha-white modifier
 *  (`rgba` white at 70% → color-mix over the `white` keyword). */
export const ThingMessageRoleFrame = styled(Text, {
  name: 'ThingMessageRole',
  fontSize: '$xs',
  marginBottom: '$1',

  variants: {
    user: {
      true: {
        color: 'color-mix(in srgb, white 70%, transparent)', // ds-lint-ok: literal white at 70% alpha
      },
    },
  } as const,
})

/** `.thing-message__content` — pre-wrapped text-sm body at leading-normal. */
export const ThingMessageContentFrame = styled(Text, {
  name: 'ThingMessageContent',
  whiteSpace: 'pre-wrap',
  fontSize: '$sm',
  lineHeight: '1.5' as unknown as number,
})

export type ThingMessageRole = 'user' | 'assistant'

export interface StyledThingMessageProps extends React.ComponentProps<'div'> {
  role?: ThingMessageRole
}

const Frame = ThingMessageFrame as unknown as React.ComponentType<any>

/** Idiomatic ThingMessage — same public API as the shipped className message (`role`). */
export function StyledThingMessage({ role = 'assistant', ...props }: StyledThingMessageProps) {
  return <Frame role={role} {...props} />
}
