/**
 * ChatFAB - Floating action button for testing agent in chat.
 * US-208 / C9: Fixed bottom-right, violet accent, icon + label.
 */
import * as Prim from '../../../../elements/primitives/index';
import { MessageCircle } from 'lucide-react'
import { CHAT_FAB_ICON } from '../../props'

export interface ChatFABProps {
  onClick: () => void
}

export function ChatFAB({ onClick }: ChatFABProps) {
  return (
    <Prim.Pressable
      onClick={onClick}
      title="Chat with this agent"
      position="fixed"
      display="inline-flex"
      alignItems="center"
      borderWidth={0}
      cursor="pointer"
      zIndex={50}
      bottom="$6"
      right="$6"
      height="$12"
      paddingLeft="$4"
      paddingRight="$5"
      borderRadius="$radius-full"
      backgroundColor="$agent"
      color="$agent-foreground"
      gap="$2"
      fontSize={15}
      fontWeight="$semibold"
      shadowColor="color-mix(in srgb, var(--agent) 35%, transparent)"
      shadowOffset={{ width: 0, height: 4 }}
      shadowRadius={12}
      // transition: transform / box-shadow awaits the P4 animation driver
      hoverStyle={{
        transform: 'scale(1.05)',
        shadowColor: 'color-mix(in srgb, var(--agent) 45%, transparent)',
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 20,
      }}
    >
      <MessageCircle {...CHAT_FAB_ICON} />
      {/* `Prim.Pressable` is an RN `View` — its `color`/`fontSize`/`fontWeight` above style the
          button fill, not this label, so all three are restated on the wrapped `Prim.Text`. */}
      <Prim.Text color="$agent-foreground" fontSize={15} fontWeight="$semibold">Chat</Prim.Text>
    </Prim.Pressable>
  )
}
