/**
 * Scrollable message list: env-not-configured warning, the message bubbles
 * (assistant messages get tool-event parsing via `ToolCallDisplay`), and a
 * "processing" placeholder while the assistant's reply is still empty.
 */
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
    <div className="thing-panel__messages">
      {!hasEnv && (
        <div className="thing-panel__env-warning">
          <strong>Environment not configured.</strong> THING needs API keys to call LLMs.
          Add environment variables (e.g., <code>OPENAI_API_KEY</code>) to enable AI features.
        </div>
      )}

      {messages.map(msg => (
        <div
          key={msg.id}
          className={`thing-msg ${msg.role === 'user' ? 'thing-msg--user' : 'thing-msg--assistant'}`}
        >
          <div className="thing-msg__role">
            {msg.role === 'user' ? 'You' : 'Thing'}
          </div>
          {msg.role === 'assistant' ? (
            <ToolCallDisplay content={msg.content} />
          ) : (
            <div className="thing-msg__text">
              {msg.content}
            </div>
          )}
        </div>
      ))}

      {isWorking && !messages.some(m => m.role === 'assistant' && m.content === '') && (
        <div className="thing-msg__processing">
          Processing...
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  )
}
