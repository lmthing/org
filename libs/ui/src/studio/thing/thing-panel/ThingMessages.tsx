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
    <Prim.Box className="thing-panel__messages">
      {!hasEnv && (
        <Prim.Box className="thing-panel__env-warning">
          <Prim.Text as="strong">Environment not configured.</Prim.Text> THING needs API keys to call LLMs.
          Add environment variables (e.g., <Prim.Text as="code">OPENAI_API_KEY</Prim.Text>) to enable AI features.
        </Prim.Box>
      )}

      {messages.map(msg => (
        <Prim.Box
          key={msg.id}
          className={`thing-msg ${msg.role === 'user' ? 'thing-msg--user' : 'thing-msg--assistant'}`}
        >
          <Prim.Box className="thing-msg__role">
            {msg.role === 'user' ? 'You' : 'Thing'}
          </Prim.Box>
          {msg.role === 'assistant' ? (
            <ToolCallDisplay content={msg.content} />
          ) : (
            <Prim.Box className="thing-msg__text">
              {msg.content}
            </Prim.Box>
          )}
        </Prim.Box>
      ))}

      {isWorking && !messages.some(m => m.role === 'assistant' && m.content === '') && (
        <Prim.Box className="thing-msg__processing">
          Processing...
        </Prim.Box>
      )}

      <Prim.Box ref={messagesEndRef} />
    </Prim.Box>
  )
}
