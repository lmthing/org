/**
 * LLM-as-a-judge test suite.
 *
 * These tests use Claude (via ANTHROPIC_API_KEY) to visually evaluate the UI.
 * They run in the "llm-judge" Playwright project only.
 *
 * Set AUTOFIX=1 to automatically apply any bug fixes the judge suggests.
 */
import { test, expect, e, jsx } from '../fixtures/index.js'
import { judgeAndFix, type AttachFn } from '../fixtures/llm-judge.js'
import type { TestInfo } from '@playwright/test'

const SOURCE_FILES = [
  'ui/src/thing-web-view/index.css',
  'ui/src/thing-web-view/ChatView.tsx',
  'ui/src/thing-web-view/BlockRenderer.tsx',
  'ui/src/thing-web-view/InputBar.tsx',
  'ui/src/thing-web-view/FormBlock.tsx',
  'ui/src/thing-web-view/index.tsx',
]

function attachVerdict(testInfo: TestInfo): AttachFn {
  return (name, options) => testInfo.attach(name, options)
}

// Skip all tests when no API key is configured
test.beforeEach(({}, testInfo) => {
  if (!process.env['ANTHROPIC_API_KEY']) {
    testInfo.skip()
  }
})

// ── Empty state ───────────────────────────────────────────────────────────────

test('empty state visual quality', async ({ chatPage, judge }, testInfo) => {
  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'The empty state shows a message guiding the user to send their first message',
      'The logo or product name is clearly visible',
      'The empty state is centered vertically and horizontally in the chat area',
      'The design looks clean and professional with good spacing',
      'There are no layout overflow or misalignment issues',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo) },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge verdict: ${verdict.summary}\n${verdict.issues.map((i) => `• [${i.severity}] ${i.description}`).join('\n')}`).toBe(true)
})

// ── Connection banner ─────────────────────────────────────────────────────────

test('connection banner visual quality', async ({ page, judge }, testInfo) => {
  // Navigate without WS mock to trigger disconnected state
  await page.goto('/')
  await page.locator('.thing-web-view').waitFor({ state: 'visible' })
  await page.locator('.twv-connection-bar').waitFor({ state: 'visible', timeout: 5000 })

  const verdict = await judgeAndFix(
    judge,
    page,
    [
      'A disconnected warning banner is clearly visible at the top of the chat',
      'The banner text is readable and indicates the server is unavailable',
      'The banner does not obscure or overlap the chat area',
      'The styling conveys urgency (warning color, clear contrast)',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-main-column' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── User message bubble ───────────────────────────────────────────────────────

test('user message bubble visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  await chatPage.sendMessage('Hello! This is a test message to evaluate bubble rendering.')

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'The user message is displayed in a visually distinct bubble',
      'The bubble is right-aligned (standard chat convention)',
      'The text is clearly readable with good contrast',
      'The bubble has rounded corners and appropriate padding',
      'The bubble does not overflow the chat area horizontally',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-chat-area' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Code block ────────────────────────────────────────────────────────────────

test('code block collapsed visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.sendCode('blkJ1', `
const result = await fetch('/api/data')
const json = await result.json()
console.log(json)
  `.trim())

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'A collapsed code block is visible with a clickable header',
      'The header shows a line count',
      'A chevron/arrow indicator shows the block can be expanded',
      'The block is styled to distinguish it from user messages',
      'There is no raw code visible while collapsed',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-chat-area' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

test('code block expanded visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.sendCode('blkJ2', `
// Calculate fibonacci sequence
function fib(n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}
  `.trim())

  const block = chatPage.lastCodeBlock()
  await chatPage.expandBlock(block)

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'The expanded code block shows formatted code with monospace font',
      'Code has adequate padding inside the block',
      'The comment line and code lines are visually distinguishable',
      'The expansion animation or state change is apparent',
      'Code is readable without horizontal scrolling on 1280px viewport',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-code-block' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Error block ───────────────────────────────────────────────────────────────

test('error block visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.send(e.error('blkJE', {
    type: 'TypeError',
    message: 'Cannot read properties of undefined (reading "map")',
    line: 23,
    source: 'const items = data.results.map(transform)',
  }))

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'An error block is visible with a distinct visual treatment (e.g., red accent or warning color)',
      'The error type and message are visible in the summary header',
      'The error block has a collapsible structure',
      'The visual design clearly communicates this is an error state',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-chat-area' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Budget bar ────────────────────────────────────────────────────────────────

test('budget bar visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.send(e.budgetUpdate({
    tokensUsed: 15000,
    tokensRemaining: 49000,
    costUsd: 0.00375,
    cycleCostUsd: 0.00125,
  }))

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'A budget/token usage bar is visible',
      'The bar shows a progress indicator proportional to usage',
      'Token counts are displayed numerically in a readable format',
      'Cost is displayed with appropriate decimal precision',
      'The bar does not take up excessive vertical space',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-budget-block' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Form card ─────────────────────────────────────────────────────────────────

test('form card visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.startAsk('formJ1', jsx.form([
    { name: 'query', label: 'Research query', placeholder: 'What would you like me to research?' },
  ]))

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'A form card is visible in the chat area',
      'The form has clearly labeled input fields',
      'Submit and Cancel buttons are visible and distinguishable',
      'The card has clear visual boundaries (border or background contrast)',
      'The form is interactive-looking with appropriate affordances',
      'Input field placeholder text is visible',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-chat-area' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Full conversation cycle ───────────────────────────────────────────────────

test('full conversation cycle visual regression', async ({ chatPage, mockWs, judge }, testInfo) => {
  // Send a user message
  await chatPage.sendMessage('Please analyze the codebase architecture')

  // Simulate agent executing with code and a display block
  mockWs.setStatus('executing')
  mockWs.sendCode('blk_full1', '// Analyzing directory structure\nconst tree = await fs.readdir(".")')
  mockWs.sendDisplay('disp_full1', jsx.paragraph('Analysis complete. Found 5 packages in the monorepo.'))
  mockWs.send(e.budgetUpdate({ tokensUsed: 2000, cycleCostUsd: 0.00050 }))
  mockWs.setStatus('idle')

  // Wait for all blocks to render
  await expect(chatPage.userBubbles()).toHaveCount(1, { timeout: 5000 })
  await expect(chatPage.codeBlocks()).toHaveCount(1, { timeout: 3000 })
  await expect(chatPage.displayBlocks()).toHaveCount(1, { timeout: 3000 })
  await expect(chatPage.budgetBars()).toHaveCount(1, { timeout: 3000 })

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'The conversation shows a user message bubble at the top',
      'A code block (collapsed by default) is visible below the user message',
      'A display block with text content is visible',
      'A budget bar shows token/cost usage',
      'All blocks have consistent visual style and spacing',
      'The overall layout looks like a professional AI chat interface',
      'There are no obvious visual glitches, overflow, or z-index issues',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo) },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}\n\nIssues:\n${verdict.issues.map((i) => `• [${i.severity}] ${i.description}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n')}`).toBe(true)
})

// ── Input bar visual quality ──────────────────────────────────────────────────

test('input bar visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'A text input area is visible at the bottom of the chat',
      'A Send button is visible and clearly labeled',
      'The placeholder text "Send a message..." is visible',
      'The input bar is visually separated from the chat area',
      'The layout looks clean with proper spacing between input and button',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo), focus: '.twv-input-bar' },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Paused state visual quality ───────────────────────────────────────────────

test('paused state visual quality', async ({ chatPage, mockWs, judge }, testInfo) => {
  mockWs.setStatus('paused')
  await chatPage.expectPausedBadge()

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'A "Paused" indicator or badge is clearly visible in the chat area',
      'A Resume button is visible in the input bar',
      'The paused state is communicated through both visual styling and text',
      'The input placeholder indicates the agent is paused',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo) },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})

// ── Dark mode check (structural, not color) ───────────────────────────────────

test('layout structure is correct at 1280x720', async ({ chatPage, mockWs, judge }, testInfo) => {
  await chatPage.sendMessage('Layout test message')
  mockWs.sendCode('blkLT', 'const x = 1')
  mockWs.sendDisplay('dispLT', jsx.paragraph('Display block content'))

  const verdict = await judgeAndFix(
    judge,
    chatPage.page,
    [
      'The main layout has a sidebar on the left (conversation list)',
      'The chat area takes up the main central/right space',
      'The input bar is anchored to the bottom',
      'No elements are cut off or overflow outside the viewport at 1280x720',
      'The layout is a standard chat application structure',
    ],
    SOURCE_FILES,
    { attach: attachVerdict(testInfo) },
  )

  expect(verdict.passed || verdict.score >= 6, `Judge: ${verdict.summary}`).toBe(true)
})
