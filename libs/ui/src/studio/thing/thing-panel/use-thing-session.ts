/**
 * Top-level THING session hook: wires together conversation storage
 * (`useThingConversations`), workspace tools (`useThingToolExecutors`), API
 * config (`useThingApiConfig`), and the streaming chat-completion + tool-call
 * loop that talks to the configured LLM provider. Returns everything
 * `ThingPanel` needs to render.
 */
import { useCallback, useEffect, useRef, type FormEvent } from 'react'
import { useApp, useUIState, useToggle } from '@lmthing/state'
import { HELP_MESSAGE } from './constants'
import { resolveApiConfig, stringifyJson } from './utils'
import { toToolEventBlock } from './use-tool-events'
import { useThingApiConfig } from './use-thing-api-config'
import { useThingConversations } from './use-thing-conversations'
import { TOOL_DEFS, useThingToolExecutors } from './use-thing-tool-executors'
import type { ThingMessage } from './types'

export interface ThingSessionOpts {
  onStatusChange?: (status: { isStreaming: boolean; hasError: boolean }) => void
}

export function useThingSession({ onStatusChange }: ThingSessionOpts) {
  const { projects, appFS, createProject, deleteProject } = useApp()

  const [input, setInput] = useUIState<string>('thing-panel.input', '')
  const [isWorking, , setIsWorking] = useToggle('thing-panel.isWorking', false)
  const [hasError, , setHasError] = useToggle('thing-panel.hasError', false)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const { hasEnv, model } = useThingApiConfig()

  const {
    conversations,
    setConversations,
    currentId,
    setCurrentId,
    currentConversation,
    messages,
    updateMessages,
    createNewChat: createNewConversation,
  } = useThingConversations()

  const toolExecutors = useThingToolExecutors({ projects, appFS, createProject, deleteProject })

  // Status callback
  useEffect(() => {
    onStatusChange?.({ isStreaming: isWorking, hasError: hasError })
  }, [isWorking, hasError, onStatusChange])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const createNewChat = useCallback(() => {
    createNewConversation()
    setInput('')
  }, [createNewConversation])

  // ── Core message handler ──────────────────────────────────────────

  const handleMessage = useCallback(async (
    conversation: ThingMessage[],
    onTextDelta?: (delta: string) => void,
    onToolEvent?: (message: string) => void,
  ): Promise<string> => {
    const lastUser = [...conversation].reverse().find(m => m.role === 'user')
    const normalized = lastUser?.content.trim() || ''

    if (!normalized) return 'Please enter a message.'
    if (normalized.toLowerCase() === 'help' || normalized === '/help') return HELP_MESSAGE
    if (normalized.toLowerCase() === 'status' || normalized === '/status') {
      return [
        `Projects: ${projects.length}`,
        ...projects.map(s => `  - ${s.name} (${s.id})`),
        `Total files in FS: ${Object.keys(appFS.getSnapshot()).length}`,
      ].join('\n')
    }

    const apiConfig = resolveApiConfig(model)
    if (!apiConfig) {
      return 'Error: No API configuration found. Make sure environment variables with API keys are set.'
    }

    const systemPrompt = [
      'You are THING, the built-in AI agent for lmthing — a platform for building and managing AI agent projects.',
      '',
      'lmthing organizes work into: Projects → Spaces.',
      'Each space contains: agents, workflows, knowledge fields, and configuration.',
      '',
      'You can create projects, manage files, and help users navigate their data.',
      'Be concise, precise, and helpful.',
      '',
      'CURRENT STATE:',
      stringifyJson({ projects: projects.map(s => ({ id: s.id, name: s.name })) }),
    ].join('\n')

    const tools = TOOL_DEFS

    type OAIMessage = { role: string; content: string; tool_call_id?: string; name?: string }
    type OAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

    const messages: OAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversation.map(m => ({ role: m.role, content: m.content })),
    ]

    try {
      let finalText = ''
      // Tool-call loop (max 5 steps)
      for (let step = 0; step < 5; step++) {
        const isLastStep = step === 4

        const res = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: apiConfig.model,
            messages,
            tools: isLastStep ? undefined : tools.map(t => ({ type: 'function', function: t })),
            tool_choice: isLastStep ? undefined : 'auto',
            temperature: 0.1,
            max_tokens: 600,
            stream: true,
          }),
        })

        if (!res.ok || !res.body) {
          const errorText = await res.text().catch(() => res.statusText)
          throw new Error(`API error ${res.status}: ${errorText}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let assistantText = ''
        const toolCallMap: Map<number, { id: string; name: string; args: string }> = new Map()
        let finishReason: string | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') break
            try {
              const chunk = JSON.parse(data)
              const choice = chunk.choices?.[0]
              if (!choice) continue
              if (choice.finish_reason) finishReason = choice.finish_reason
              const delta = choice.delta
              if (delta?.content) {
                assistantText += delta.content
                onTextDelta?.(delta.content)
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (!toolCallMap.has(tc.index)) {
                    toolCallMap.set(tc.index, { id: tc.id || '', name: tc.function?.name || '', args: '' })
                  }
                  const entry = toolCallMap.get(tc.index)!
                  if (tc.id) entry.id = tc.id
                  if (tc.function?.name) entry.name += tc.function.name
                  if (tc.function?.arguments) entry.args += tc.function.arguments
                }
              }
            } catch { /* skip malformed */ }
          }
        }

        finalText = assistantText

        if (finishReason !== 'tool_calls' || toolCallMap.size === 0) break

        // Execute tool calls
        const toolCalls: OAIToolCall[] = Array.from(toolCallMap.values()).map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args },
        }))

        const toolNames = toolCalls.map(tc => tc.function.name)
        onToolEvent?.(toToolEventBlock(`🔧 Running tool${toolNames.length > 1 ? 's' : ''}: ${toolNames.join(', ')}`))

        messages.push({ role: 'assistant', content: assistantText || '', ...toolCalls.length ? { tool_calls: toolCalls } : {} } as unknown as OAIMessage)

        for (const tc of toolCalls) {
          const name = tc.function.name as keyof typeof toolExecutors
          let result: unknown
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            result = await (toolExecutors[name] as (a: unknown) => Promise<unknown>)?.(args) ?? { ok: false, message: `Unknown tool: ${name}` }
          } catch (e) {
            result = { ok: false, message: e instanceof Error ? e.message : 'Tool error' }
          }
          onToolEvent?.(toToolEventBlock(`🔧 ${name}\n⤷ result: ${stringifyJson(result)}`))
          messages.push({ role: 'tool', content: stringifyJson(result), tool_call_id: tc.id, name } as OAIMessage)
        }
      }

      return finalText.trim() || 'Done.'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return `Error: ${message}\n\nMake sure environment variables with API keys are configured.`
    }
  }, [projects, appFS, model, toolExecutors])

  // ── Run conversation ──────────────────────────────────────────────

  const runConversation = useCallback((conversationId: string, conversation: ThingMessage[]) => {
    const responseId = `thing-response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    updateMessages(conversationId, [
      ...conversation,
      { id: responseId, role: 'assistant', content: '' },
    ])

    setIsWorking(true)
    setHasError(false)

    void (async () => {
      const appendText = (text: string) => {
        if (!text) return
        setConversations(prev => prev.map(c => {
          if (c.id !== conversationId) return c
          return {
            ...c,
            updatedAt: new Date().toISOString(),
            messages: c.messages.map(m =>
              m.id === responseId ? { ...m, content: (m.content || '') + text } : m
            ),
          }
        }))
      }

      let response: string
      try {
        response = await handleMessage(
          conversation,
          delta => appendText(delta),
          event => appendText(`\n\n${event}\n`),
        )
      } catch (error) {
        setHasError(true)
        response = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }

      setConversations(prev => prev.map(c => {
        if (c.id !== conversationId) return c
        return {
          ...c,
          updatedAt: new Date().toISOString(),
          messages: c.messages.map(m =>
            m.id === responseId
              ? { ...m, content: m.content?.trim() ? m.content : response }
              : m
          ),
        }
      }))

      setIsWorking(false)
    })()
  }, [handleMessage, updateMessages])

  // ── Submit ────────────────────────────────────────────────────────

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isWorking) return

    const userMessage: ThingMessage = {
      id: `thing-user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }

    const nextMessages = [...messages, userMessage]
    setInput('')

    if (!currentConversation) return

    if (currentConversation.title === 'New chat' || currentConversation.title.startsWith('Chat ')) {
      setConversations(prev => prev.map(c =>
        c.id === currentConversation.id
          ? { ...c, title: trimmed.slice(0, 48), updatedAt: new Date().toISOString() }
          : c
      ))
    }

    runConversation(currentConversation.id, nextMessages)
  }, [input, messages, isWorking, runConversation, currentConversation])

  return {
    input,
    setInput,
    conversations,
    currentId,
    setCurrentId,
    currentConversation,
    messages,
    isWorking,
    hasError,
    hasEnv,
    messagesEndRef,
    createNewChat,
    handleSubmit,
  }
}
