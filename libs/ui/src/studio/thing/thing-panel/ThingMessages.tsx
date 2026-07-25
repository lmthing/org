/**
 * Scrollable message list: env-not-configured warning, the message bubbles
 * (assistant messages get tool-event parsing via `ToolCallDisplay`), and a
 * "processing" placeholder while the assistant's reply is still empty.
 */
import * as Prim from '../../../elements/primitives/index.js';
import type { Ref } from 'react'
import { ToolCallDisplay } from './ToolCallDisplay'
import type { ThingMessage } from './types'

export interface ThingMessagesProps {
  hasEnv: boolean
  messages: ThingMessage[]
  isWorking: boolean
  messagesEndRef: Ref<HTMLDivElement>
}

export function ThingMessages({ hasEnv, messages, isWorking, messagesEndRef }: ThingMessagesProps) {
  return (
    <Prim.Box
      flexGrow={1}
      flexShrink={1}
      flexBasis="0%"
      overflowY="auto"
      padding="$4"
      display="flex"
      flexDirection="column"
      gap="$3"
    >
      {!hasEnv && (
        <Prim.Box
          paddingVertical="$3"
          paddingHorizontal="$4"
          borderRadius="$radius-lg"
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$muted"
          fontSize={13}
        >
          <Prim.Text as="strong">Environment not configured.</Prim.Text> THING needs API keys to call LLMs.
          Add environment variables (e.g., <Prim.Text as="code">OPENAI_API_KEY</Prim.Text>) to enable AI features.
        </Prim.Box>
      )}

      {messages.map(msg => (
        <Prim.Box
          key={msg.id}
          maxWidth="80%"
          paddingVertical="$2.5"
          paddingHorizontal="$3.5"
          borderRadius="$radius-xl"
          fontSize="$sm"
          lineHeight={'1.5' as unknown as number}
          borderWidth={1}
          borderColor="$border"
          {...(msg.role === 'user'
            ? { alignSelf: 'flex-end', backgroundColor: '$primary', color: '$primary-foreground' }
            : { alignSelf: 'flex-start', backgroundColor: '$card' })}
        >
          <Prim.Text
            fontSize={11}
            fontWeight="$semibold"
            textTransform="uppercase"
            letterSpacing="$wider"
            opacity={0.6}
            marginBottom="$1"
          >
            {msg.role === 'user' ? 'You' : 'Thing'}
          </Prim.Text>
          {msg.role === 'assistant' ? (
            <ToolCallDisplay content={msg.content} />
          ) : (
            <Prim.Text whiteSpace="pre-wrap" style={{ wordBreak: 'break-word' }}>
              {msg.content}
            </Prim.Text>
          )}
        </Prim.Box>
      ))}

      {isWorking && !messages.some(m => m.role === 'assistant' && m.content === '') && (
        <Prim.Box
          alignSelf="flex-start"
          paddingVertical="$2.5"
          paddingHorizontal="$3.5"
          borderRadius="$radius-xl"
          borderWidth={1}
          borderColor="$border"
          fontSize={13}
          opacity={0.7}
        >
          Processing...
        </Prim.Box>
      )}

      <Prim.Box ref={messagesEndRef} />
    </Prim.Box>
  )
}
