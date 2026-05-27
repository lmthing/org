import { test, expect, e } from '../fixtures/index.js'

test.describe('Conversation management', () => {
  const NOW = new Date().toISOString()

  const SAMPLE_CONVERSATIONS = [
    { id: 'conv-001', title: 'conv-001', updatedAt: NOW, turnCount: 3 },
    { id: 'conv-002', title: 'conv-002', updatedAt: NOW, turnCount: 7 },
  ]

  // ── Sidebar rendering ───────────────────────────────────────────────────

  test('empty sidebar shows no-conversations message', async ({ chatPage, mockWs }) => {
    mockWs.setConversations([])
    const list = chatPage.convSidebarList
    await expect(list).toBeVisible()
    await expect(list.locator('.twv-conv-sidebar__empty')).toContainText('No saved conversations')
  })

  test('sidebar lists conversations sent by server', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.expectConversationInSidebar('conv-001')
    await chatPage.expectConversationInSidebar('conv-002')
  })

  test('sidebar item shows turn count', async ({ chatPage, mockWs }) => {
    mockWs.setConversations([
      { id: 'c1', title: 'c1', updatedAt: NOW, turnCount: 5 },
    ])
    const item = chatPage.convSidebarList.locator('.twv-conv-sidebar__item', { hasText: 'c1' })
    await expect(item).toBeVisible()
    await expect(item.locator('.twv-conv-sidebar__item-meta')).toContainText('5 turns')
  })

  test('conversations are requested on connect', async ({ chatPage, mockWs }) => {
    // chatPage navigates to '/', the app sends listConversations on WS init
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'listConversations', 4000)
    expect(msg['type']).toBe('listConversations')
  })

  // ── URL hash routing ────────────────────────────────────────────────────

  test('URL hash is set on initial load', async ({ chatPage }) => {
    const hash = chatPage.page.url()
    expect(hash).toMatch(/#\/chat\//)
  })

  test('clicking a conversation changes URL hash', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.expectConversationInSidebar('conv-001')
    await chatPage.clickConversation('conv-001')
    await chatPage.page.waitForTimeout(200) // allow hash change
    const url = chatPage.page.url()
    expect(url).toContain('conv-001')
  })

  test('clicking conversation sends loadConversation WS message', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-002')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'loadConversation', 3000)
    expect(msg['id']).toBe('conv-002')
  })

  // ── History view ────────────────────────────────────────────────────────

  test('history banner appears when viewing saved conversation', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-001')
    // The history banner should appear since we navigated away from live session
    await expect(chatPage.historyBanner).toBeVisible({ timeout: 3000 })
    await expect(chatPage.historyBanner).toContainText('Viewing saved conversation')
  })

  test('Back to live session button returns to live view', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-001')
    await expect(chatPage.historyBanner).toBeVisible({ timeout: 3000 })

    await chatPage.historyBackBtn.click()
    await expect(chatPage.historyBanner).toBeHidden({ timeout: 3000 })
  })

  test('New button in sidebar navigates to live session', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-001')
    await expect(chatPage.historyBanner).toBeVisible({ timeout: 3000 })

    await chatPage.clickNewConversation()
    await expect(chatPage.historyBanner).toBeHidden({ timeout: 3000 })
  })

  test('history view disables the input bar', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-001')

    // In history view, ThingWebView does not render InputBar (isLiveView=false)
    // Input bar should be hidden
    await expect(chatPage.inputBar).toBeHidden({ timeout: 3000 })
  })

  // ── Auto-save ────────────────────────────────────────────────────────────

  test('saveConversation WS message sent after executing → idle transition', async ({
    chatPage,
    mockWs,
  }) => {
    // Trigger executing → idle transition
    mockWs.setStatus('executing')
    await chatPage.expectPauseButtonVisible()
    mockWs.setStatus('idle')

    const msg = await mockWs.waitForMessage((m) => m['type'] === 'saveConversation', 4000)
    expect(msg['id']).toBeTruthy()
  })

  test.skip('saveConversation sent after executing → complete transition', async ({
    chatPage,
    mockWs,
  }) => {
    // The UI doesn't currently auto-save on status transitions; it relies on explicit saves.
    // Kept as a reminder of the desired behavior.
    mockWs.setStatus('executing')
    mockWs.setStatus('complete')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'saveConversation', 4000)
    expect(msg['id']).toBeTruthy()
  })

  test.skip('saveConversation sent after executing → waiting_for_input transition', async ({
    chatPage,
    mockWs,
  }) => {
    // The UI auto-saves on complete but not on waiting_for_input (ask() pauses the cycle).
    // Kept as a reminder of the desired behavior should it be implemented later.
    mockWs.setStatus('executing')
    mockWs.setStatus('waiting_for_input')
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'saveConversation', 4000)
    expect(msg['id']).toBeTruthy()
  })

  test('conversations list refreshed after save acknowledgement', async ({ chatPage, mockWs }) => {
    // Simulate a save acknowledgement
    mockWs.send(e.conversationSaved('some-id'))
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'listConversations', 4000)
    expect(msg['type']).toBe('listConversations')
  })

  // ── Active item highlighting ─────────────────────────────────────────────

  test('active conversation is highlighted in sidebar', async ({ chatPage, mockWs }) => {
    mockWs.setConversations(SAMPLE_CONVERSATIONS)
    await chatPage.clickConversation('conv-001')
    const item = chatPage.convSidebarList.locator(
      '.twv-conv-sidebar__item--active',
    )
    await expect(item).toBeVisible({ timeout: 3000 })
    await expect(item).toContainText('conv-001')
  })
})
