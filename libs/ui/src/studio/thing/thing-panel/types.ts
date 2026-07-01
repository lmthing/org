/**
 * Shared types for the THING chat/REPL panel.
 */

export type ThingMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ThingConversation = {
  id: string
  title: string
  messages: ThingMessage[]
  createdAt: string
  updatedAt: string
}

export type ThingModelId = string
