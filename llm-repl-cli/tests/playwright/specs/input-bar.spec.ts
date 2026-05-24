import { test, expect, e } from '../fixtures/index.js'

test.describe('InputBar', () => {
  // ── Slash command dropdown ──────────────────────────────────────────────

  test.describe('slash command picker', () => {
    const ACTIONS = [
      { id: 'deep-research', label: 'Deep Research', description: 'Run deep research' },
      { id: 'debug', label: 'Debug mode', description: 'Run with debug output' },
      { id: 'summary', label: 'Summarize', description: 'Summarize findings' },
    ]

    test('typing / shows dropdown', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.openActionsDropdown('/')
      await chatPage.expectActionsDropdownVisible()
    })

    test('dropdown lists matching actions', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await expect(chatPage.actionsDropdown).toBeVisible()
      await expect(chatPage.actionsDropdown).toContainText('deep-research')
      await expect(chatPage.actionsDropdown).toContainText('debug')
      await expect(chatPage.actionsDropdown).toContainText('summary')
    })

    test('typing /de filters to matching actions only', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/de')
      await expect(chatPage.actionsDropdown).toBeVisible()
      await expect(chatPage.actionsDropdown).toContainText('deep-research')
      await expect(chatPage.actionsDropdown).toContainText('debug')
      await expect(chatPage.actionsDropdown).not.toContainText('summary')
    })

    test('typing /sum filters to summary only', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/sum')
      await expect(chatPage.actionsDropdown).toBeVisible()
      await expect(chatPage.actionsDropdown).toContainText('summary')
      await expect(chatPage.actionsDropdown).not.toContainText('debug')
    })

    test('no matching slash command hides dropdown', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/zzz')
      await chatPage.expectActionsDropdownHidden()
    })

    test('pressing Escape closes dropdown', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownVisible()
      await chatPage.messageInput.press('Escape')
      await chatPage.expectActionsDropdownHidden()
    })

    test('ArrowDown selects next item', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownVisible()
      // First item selected by default
      await chatPage.expectDropdownItemSelected(0)
      await chatPage.messageInput.press('ArrowDown')
      await chatPage.expectDropdownItemSelected(1)
    })

    test('ArrowUp wraps to last item', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.messageInput.press('ArrowUp')
      // Should wrap to last item
      await chatPage.expectDropdownItemSelected(ACTIONS.length - 1)
    })

    test('Enter selects the highlighted action', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownVisible()
      await chatPage.messageInput.press('Enter')
      // Input should now have /<action-id> text
      const inputValue = await chatPage.messageInput.inputValue()
      expect(inputValue).toMatch(/^\//)
      await chatPage.expectActionsDropdownHidden()
    })

    test('Tab selects the highlighted action', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownVisible()
      await chatPage.messageInput.press('Tab')
      const inputValue = await chatPage.messageInput.inputValue()
      expect(inputValue).toMatch(/^\//)
    })

    test('clicking an action sets input text', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownVisible()
      await chatPage.selectActionFromDropdown('deep-research')
      const inputValue = await chatPage.messageInput.inputValue()
      expect(inputValue).toContain('deep-research')
      await chatPage.expectActionsDropdownHidden()
    })

    test('dropdown shows action labels alongside IDs', async ({ chatPage, mockWs }) => {
      mockWs.setActions(ACTIONS)
      await chatPage.messageInput.fill('/')
      await expect(
        chatPage.actionsDropdown.locator('.twv-actions-dropdown__label').first(),
      ).toBeVisible()
    })

    test('no dropdown when no actions configured', async ({ chatPage, mockWs }) => {
      // Don't push any actions
      await chatPage.messageInput.fill('/')
      await chatPage.expectActionsDropdownHidden()
    })
  })

  // ── Agent (@ picker) dropdown ───────────────────────────────────────────

  test.describe('@ agent picker', () => {
    const AGENTS = [
      { slug: 'researcher', title: 'Research Agent', requiredKnowledge: [] },
      { slug: 'reviewer', title: 'Review Agent', requiredKnowledge: [] },
    ]

    test('typing @ shows agent dropdown', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@')
      await expect(chatPage.agentsDropdown).toBeVisible()
    })

    test('dropdown lists agents', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@')
      await expect(chatPage.agentsDropdown).toContainText('researcher')
      await expect(chatPage.agentsDropdown).toContainText('reviewer')
    })

    test('typing @res filters to researcher', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@res')
      await expect(chatPage.agentsDropdown).toBeVisible()
      await expect(chatPage.agentsDropdown).toContainText('researcher')
      await expect(chatPage.agentsDropdown).not.toContainText('reviewer')
    })

    test('Escape closes agent dropdown', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@')
      await expect(chatPage.agentsDropdown).toBeVisible()
      await chatPage.messageInput.press('Escape')
      await expect(chatPage.agentsDropdown).toBeHidden()
    })

    test('selecting agent sends switchAgent WS message', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@researcher')
      await expect(chatPage.agentsDropdown).toBeVisible()
      await chatPage.messageInput.press('Enter')
      const msg = await mockWs.waitForMessage((m) => m['type'] === 'switchAgent', 3000)
      expect(msg['agent']).toBe('researcher')
    })

    test('selecting agent clears input', async ({ chatPage, mockWs }) => {
      mockWs.setAgents(AGENTS)
      await chatPage.messageInput.fill('@researcher')
      await chatPage.messageInput.press('Enter')
      await expect(chatPage.messageInput).toHaveValue('')
    })
  })

  // ── Textarea auto-height ────────────────────────────────────────────────

  test.describe('textarea sizing', () => {
    test('textarea grows with multi-line input', async ({ chatPage, mockWs }) => {
      const before = await chatPage.messageInput.boundingBox()
      await chatPage.messageInput.fill('line 1\nline 2\nline 3\nline 4')
      const after = await chatPage.messageInput.boundingBox()
      expect(after?.height).toBeGreaterThan(before?.height ?? 0)
    })

    test('textarea resets height after send', async ({ chatPage, mockWs }) => {
      const initial = await chatPage.messageInput.boundingBox()
      await chatPage.messageInput.fill('line 1\nline 2\nline 3')
      const expanded = await chatPage.messageInput.boundingBox()
      expect(expanded?.height).toBeGreaterThan(initial?.height ?? 0)

      await chatPage.sendButton.click()
      await expect(chatPage.messageInput).toHaveValue('')
      const reset = await chatPage.messageInput.boundingBox()
      // Should be back to approximately single-line height
      expect(reset?.height).toBeLessThanOrEqual((initial?.height ?? 30) + 10)
    })

    test('textarea does not grow beyond 200px', async ({ chatPage, mockWs }) => {
      const lotsOfLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
      await chatPage.messageInput.fill(lotsOfLines)
      const box = await chatPage.messageInput.boundingBox()
      expect(box?.height).toBeLessThanOrEqual(205)
    })
  })
})
