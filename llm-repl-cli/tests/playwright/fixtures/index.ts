import { test as base, expect } from '@playwright/test'
import { WsMock } from './ws-mock.js'
import { ChatPage } from './chat-page.js'
import { LLMJudge } from './llm-judge.js'

export type { JudgeVerdict, JudgeIssue, AutoFixResult } from './llm-judge.js'
export { WsMock } from './ws-mock.js'
export { ChatPage } from './chat-page.js'
export { LLMJudge } from './llm-judge.js'
export { e, jsx, EMPTY_SNAPSHOT } from '../helpers/events.js'
export type { SessionStatus, SessionSnapshot, SerializedJSX } from '../helpers/events.js'

export interface Fixtures {
  /** Intercepts ws://localhost:3010 and provides scenario helpers */
  mockWs: WsMock
  /** Page Object Model for the web chat UI */
  chatPage: ChatPage
  /** LLM-as-a-judge for visual/functional evaluation (opt-in, needs ANTHROPIC_API_KEY) */
  judge: LLMJudge
}

export const test = base.extend<Fixtures>({
  mockWs: async ({ page }, use) => {
    const mock = new WsMock()
    // Must be installed before page.goto() so WS interception is active
    await mock.install(page)
    await use(mock)
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  chatPage: async ({ page, mockWs: _mockWs }, use) => {
    // Navigate after WS mock is set up (fixture dependency on mockWs ensures order)
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible', timeout: 10_000 })
    const chatPage = new ChatPage(page)
    // Wait for the initial WS handshake to complete (connection banner disappears)
    await chatPage.waitForConnected(8000)
    await use(chatPage)
  },

  judge: async ({}, use) => {
    await use(new LLMJudge())
  },
})

export { expect } from '@playwright/test'
