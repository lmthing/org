import { test, expect, e } from '../fixtures/index.js'

test.describe('WebSocket connection', () => {
  test('shows disconnected banner before WS connects', async ({ page }) => {
    // Navigate without the mockWs fixture so no WS intercept is active → no server listens
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })
    // App tries ws://localhost:3010, gets refused → disconnected banner appears
    await expect(page.locator('.twv-connection-bar')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.twv-connection-bar')).toContainText('Disconnected')
  })

  test('hides connection banner once WS handshake completes', async ({ chatPage }) => {
    await chatPage.expectConnected()
    await expect(chatPage.connectionBanner).toBeHidden()
  })

  test('input is disabled while disconnected', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })
    const input = page.getByLabel('Message input')
    // WS not connected → input disabled (set when connected=false)
    await expect(input).toBeDisabled({ timeout: 4000 })
  })

  test('input becomes enabled after WS connects', async ({ chatPage }) => {
    await chatPage.expectInputEnabled()
  })

  test('receives initial snapshot on connect', async ({ mockWs, chatPage }) => {
    // Confirm the browser sent getSnapshot
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'getSnapshot', 3000)
    expect(msg['type']).toBe('getSnapshot')
  })

  test('applies snapshot status from initial handshake', async ({ page, mockWs }) => {
    // Reinstall with a custom snapshot that says "paused"
    const mock = new (await import('../fixtures/ws-mock.js')).WsMock()
    await mock.install(page)
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })

    // Send a paused snapshot immediately
    mock.send(e.snapshot({ status: 'paused' }))

    await expect(page.locator('.twv-paused-badge')).toBeVisible({ timeout: 4000 })
  })

  test('requests conversation list after connecting', async ({ mockWs }) => {
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'listConversations', 4000)
    expect(msg['type']).toBe('listConversations')
  })

  test('receives and applies space metadata (agents list)', async ({ page }) => {
    const { WsMock } = await import('../fixtures/ws-mock.js')
    const mock = new WsMock()
    await mock.install(page)

    // Send agents in space metadata
    mock.send(e.spaceMetadata([
      { slug: 'researcher', title: 'Research Agent', requiredKnowledge: [] },
    ]))

    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })

    // Type @ in the input to trigger agent picker
    const input = page.getByLabel('Message input')
    // Wait for connection first
    await expect(page.locator('.twv-connection-bar')).toBeHidden({ timeout: 6000 })

    // Send agents after connected
    mock.send(e.spaceMetadata([
      { slug: 'researcher', title: 'Research Agent', requiredKnowledge: [] },
    ]))

    await input.fill('@researcher')
    // Dropdown should show the researcher agent
    await expect(page.locator('.twv-actions-dropdown')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('.twv-actions-dropdown')).toContainText('researcher')
  })

  test('banner shows WS URL when disconnected', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })
    const banner = page.locator('.twv-connection-bar')
    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(banner).toContainText('localhost:3010')
  })

  test('send button stays disabled while disconnected', async ({ page }) => {
    await page.goto('/')
    await page.locator('.thing-web-view').waitFor({ state: 'visible' })
    const sendBtn = page.getByLabel('Send message')
    await expect(sendBtn).toBeDisabled({ timeout: 4000 })
  })
})
