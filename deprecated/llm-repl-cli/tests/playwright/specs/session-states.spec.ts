import { test, expect, e } from '../fixtures/index.js'

test.describe('Session status transitions', () => {
  test('idle state: no pause/resume button, no badge', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('idle')
    await chatPage.expectNoPausedBadge()
    await chatPage.expectNoPauseResumeButton()
  })

  test('executing state: shows pause button', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    await chatPage.expectNoPausedBadge()
  })

  test('paused state: shows resume button and paused badge', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await chatPage.expectResumeButtonVisible()
    await chatPage.expectPausedBadge()
  })

  test('paused badge contains pause symbol', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await expect(chatPage.pausedBadge).toBeVisible()
    // The badge contains ⏸ Paused
    await expect(chatPage.pausedBadge).toContainText('Paused')
  })

  test('waiting_for_input placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('waiting_for_input')
    await chatPage.expectInputPlaceholder('Or type a message instead...')
  })

  test('idle placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('idle')
    await chatPage.expectInputPlaceholder('Send a message...')
  })

  test('executing placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('executing')
    await chatPage.expectInputPlaceholder('Send a message to the agent...')
  })

  test('paused placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await chatPage.expectInputPlaceholder('The agent is paused. Type your message...')
  })

  test('complete placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('complete')
    await chatPage.expectInputPlaceholder('Send a follow-up...')
  })

  test('error placeholder', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('error')
    await chatPage.expectInputPlaceholder('Send a message to retry...')
  })

  test('pause button click sends pause WS message', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    await chatPage.pauseButton.click()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'pause', 3000)
    expect(msg['type']).toBe('pause')
  })

  test('resume button click sends resume WS message', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await chatPage.expectResumeButtonVisible()
    await chatPage.resumeButton.click()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'resume', 3000)
    expect(msg['type']).toBe('resume')
  })

  test('Ctrl+Shift+P pauses during executing', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    await chatPage.pressPauseShortcut()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'pause', 3000)
    expect(msg['type']).toBe('pause')
  })

  test('Ctrl+Shift+P resumes during paused', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await chatPage.expectResumeButtonVisible()
    await chatPage.pressPauseShortcut()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'resume', 3000)
    expect(msg['type']).toBe('resume')
  })

  test('executing → idle transition removes pause button', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    mockWs.setStatus('idle')
    await chatPage.expectNoPauseResumeButton()
  })

  test('idle → executing → idle full cycle updates UI', async ({ chatPage, mockWs }) => {
    // Start idle
    await chatPage.expectNoPauseResumeButton()
    await chatPage.expectInputPlaceholder('Send a message...')

    // Transition to executing
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    await chatPage.expectInputPlaceholder('Send a message to the agent...')

    // Back to idle
    mockWs.setStatus('idle')
    await chatPage.expectNoPauseResumeButton()
    await chatPage.expectInputPlaceholder('Send a message...')
  })
})
