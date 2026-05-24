import { test, expect, e } from '../fixtures/index.js'

test.describe('Message sending', () => {
  test('user bubble appears after clicking Send', async ({ chatPage, mockWs }) => {
    await chatPage.expectEmptyState()
    await chatPage.sendMessage('Hello, world!')
    await chatPage.expectUserBubble('Hello, world!')
    await chatPage.expectNoEmptyState()
  })

  test('user bubble appears after pressing Enter', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessageWithEnter('Enter key message')
    await chatPage.expectUserBubble('Enter key message')
  })

  test('Shift+Enter inserts newline without sending', async ({ chatPage, mockWs }) => {
    await chatPage.typeMessage('first line')
    await chatPage.sendMessageWithShiftEnter('')
    // After Shift+Enter the message should NOT be sent (no user bubble yet)
    await expect(chatPage.chatArea.locator('.twv-user-bubble')).toHaveCount(0)
    // Input should still have content
    await expect(chatPage.messageInput).not.toHaveValue('')
  })

  test('sends sendMessage WS message on send', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessage('test payload')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'sendMessage', 3000)
    expect(msg['text']).toBe('test payload')
  })

  test('input clears after send', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessage('clear me')
    await expect(chatPage.messageInput).toHaveValue('')
  })

  test('empty message is not sent', async ({ chatPage, mockWs }) => {
    await chatPage.typeMessage('   ')
    // Whitespace-only input: send button should remain disabled
    await chatPage.expectSendButtonDisabled()
    // No user bubble, no WS message
    await expect(chatPage.userBubbles()).toHaveCount(0)
    const received = mockWs.getReceived().filter((m) => m['type'] === 'sendMessage')
    expect(received).toHaveLength(0)
  })

  test('send button is disabled with empty input', async ({ chatPage }) => {
    await chatPage.expectSendButtonDisabled()
    await chatPage.typeMessage('x')
    await chatPage.expectSendButtonEnabled()
    await chatPage.typeMessage('')
    await chatPage.expectSendButtonDisabled()
  })

  test('multiple messages create multiple user bubbles', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessage('msg 1')
    await chatPage.sendMessage('msg 2')
    await chatPage.sendMessage('msg 3')
    await expect(chatPage.userBubbles()).toHaveCount(3)
  })

  test('send during executing sends intervene message', async ({ chatPage, mockWs }) => {
    // Transition to executing state first
    mockWs.setStatus('executing')
    await expect(chatPage.pauseButton).toBeVisible({ timeout: 3000 })

    await chatPage.sendMessage('intervene text')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'intervene', 3000)
    expect(msg['text']).toBe('intervene text')
  })

  test('send during paused sends intervene message', async ({ chatPage, mockWs }) => {
    mockWs.setStatus('paused')
    await expect(chatPage.resumeButton).toBeVisible({ timeout: 3000 })

    await chatPage.sendMessage('paused intervene')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'intervene', 3000)
    expect(msg['text']).toBe('paused intervene')
  })

  test('message text is preserved in bubble', async ({ chatPage, mockWs }) => {
    const longMessage = 'This is a fairly long message to ensure text is preserved correctly in the bubble. It has punctuation, numbers 123, and symbols @#$%.'
    await chatPage.sendMessage(longMessage)
    await chatPage.expectUserBubble(longMessage)
  })

  test('user message bubble is right-aligned', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessage('alignment test')
    const bubble = chatPage.chatArea.locator('.twv-user-bubble').first()
    await expect(bubble).toBeVisible()
    // Check it renders on the right side (standard chat pattern)
    const bubbleBox = await bubble.boundingBox()
    const chatBox = await chatPage.chatArea.boundingBox()
    expect(bubbleBox).not.toBeNull()
    expect(chatBox).not.toBeNull()
    if (bubbleBox && chatBox) {
      // Bubble right edge should be close to chat right edge
      expect(bubbleBox.x + bubbleBox.width).toBeGreaterThan(chatBox.x + chatBox.width * 0.5)
    }
  })
})
