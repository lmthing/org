/**
 * Pure helpers for the THING chat/REPL panel: env/API-config resolution and
 * conversation (de)serialization.
 */
import { PROVIDER_BASE_URLS, PROVIDER_ENV_KEYS } from './constants'
import { WELCOME_MESSAGE, CONVERSATIONS_KEY } from './constants'
import type { ThingConversation, ThingMessage, ThingModelId } from './types'

export function getWindowEnv(): Record<string, string | undefined> {
  return typeof window !== 'undefined'
    ? (window as Window & { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
    : {}
}

export function resolveModelId(): ThingModelId {
  const env = getWindowEnv()
  const configured = env.LMTHING_THING_MODEL || env.LM_MODEL_DEFAULT || env.LM_MODEL_FAST || env.LM_MODEL_LARGE
  if (typeof configured === 'string' && configured.includes(':')) return configured
  return 'openai:gpt-4o-mini'
}

export function resolveApiConfig(modelId: string): { baseUrl: string; apiKey: string; model: string } | null {
  const colonIdx = modelId.indexOf(':')
  if (colonIdx === -1) return null
  const provider = modelId.slice(0, colonIdx)
  const model = modelId.slice(colonIdx + 1)
  const env = getWindowEnv()

  // Check for explicit base URL / key overrides
  const baseUrl = env.LM_API_BASE_URL || env[`${provider.toUpperCase()}_BASE_URL`] || PROVIDER_BASE_URLS[provider]
  const envKey = PROVIDER_ENV_KEYS[provider] || `${provider.toUpperCase()}_API_KEY`
  const apiKey = env[envKey]

  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model }
}

export function checkHasEnv(): boolean {
  const env = getWindowEnv()
  const providerKeys = [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
    'MISTRAL_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  ]
  return providerKeys.some(key => {
    const value = env[key]
    return typeof value === 'string' && value.trim().length > 0 && !value.includes('your-')
  })
}

export function stringifyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function createWelcomeMessage(): ThingMessage {
  return { id: 'thing-welcome', role: 'assistant', content: WELCOME_MESSAGE }
}

export function createConversation(title?: string): ThingConversation {
  const now = new Date().toISOString()
  return {
    id: `thing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || 'New chat',
    messages: [createWelcomeMessage()],
    createdAt: now,
    updatedAt: now,
  }
}

export function loadConversations(): ThingConversation[] {
  if (typeof window === 'undefined') return [createConversation()]
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return [createConversation()]
    const parsed = JSON.parse(raw) as ThingConversation[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [createConversation()]
    return parsed.map(c => ({
      ...c,
      title: c.title || 'Untitled',
      messages: Array.isArray(c.messages) && c.messages.length > 0 ? c.messages : [createWelcomeMessage()],
    }))
  } catch {
    return [createConversation()]
  }
}
