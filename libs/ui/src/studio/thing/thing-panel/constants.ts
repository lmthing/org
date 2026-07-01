/**
 * Static config for the THING chat/REPL panel: provider URL maps, storage
 * keys, and canned copy (welcome/help messages).
 */

// ── Provider URL map (OpenAI-compatible) ────────────────────────────────

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
}

export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

// ── Constants ──────────────────────────────────────────────────────────

export const CONVERSATIONS_KEY = 'lmthing-thing-conversations-v2'

export const WELCOME_MESSAGE =
  'I am THING. I can help you manage your projects, spaces, agents, workflows, and knowledge. Ask me anything or type help.'

export const HELP_MESSAGE = [
  'Available commands:',
  '  help    — Show this help message',
  '  status  — Show current projects and data summary',
  '',
  'You can also ask naturally, e.g.:',
  '  "Create a new project called my-project"',
  '  "List all my projects"',
  '  "What agents are in this space?"',
].join('\n')

export const ACTION_NAMES = [
  'listProjects',
  'createProject',
  'deleteProject',
  'listFiles',
  'readFile',
  'writeFile',
  'deleteFile',
] as const
