import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Page Object Model for the web chat UI.
 * All selectors are based on the .twv-* CSS classes and aria labels
 * defined in the React components.
 */
export class ChatPage {
  readonly page: Page

  // ── Root regions ────────────────────────────────────────────────────────
  readonly root: Locator
  readonly mainColumn: Locator
  readonly chatArea: Locator
  readonly inputBar: Locator

  // ── Connection ────────────────────────────────────────────────────────
  readonly connectionBanner: Locator
  readonly historyBanner: Locator
  readonly historyBackBtn: Locator

  // ── Empty state ───────────────────────────────────────────────────────
  readonly emptyState: Locator
  readonly emptyStateLogo: Locator

  // ── InputBar controls ─────────────────────────────────────────────────
  readonly messageInput: Locator
  readonly sendButton: Locator
  readonly pauseButton: Locator
  readonly resumeButton: Locator
  readonly actionsDropdown: Locator
  readonly agentsDropdown: Locator

  // ── Sidebar ───────────────────────────────────────────────────────────
  readonly convSidebar: Locator
  readonly convSidebarNewBtn: Locator
  readonly convSidebarList: Locator

  // ── Activity indicator ────────────────────────────────────────────────
  readonly activityIndicator: Locator
  readonly pausedBadge: Locator

  constructor(page: Page) {
    this.page = page

    this.root = page.locator('.thing-web-view')
    this.mainColumn = page.locator('.twv-main-column')
    this.chatArea = page.locator('.twv-chat-area')
    this.inputBar = page.locator('.twv-input-bar')

    this.connectionBanner = page.locator('.twv-connection-bar')
    this.historyBanner = page.locator('.twv-history-banner')
    this.historyBackBtn = page.locator('.twv-history-banner__back')

    this.emptyState = page.locator('.twv-empty-state')
    this.emptyStateLogo = page.locator('.twv-empty-state__logo')

    this.messageInput = page.getByLabel('Message input')
    this.sendButton = page.getByLabel('Send message')
    this.pauseButton = page.getByLabel('Pause agent execution')
    this.resumeButton = page.getByLabel('Resume agent execution')
    this.actionsDropdown = page.locator('.twv-actions-dropdown')
    this.agentsDropdown = page.locator('.twv-actions-dropdown') // same class, context differs

    this.convSidebar = page.locator('.twv-conv-sidebar')
    this.convSidebarNewBtn = page.locator('.twv-conv-sidebar__new-btn')
    this.convSidebarList = page.locator('.twv-conv-sidebar__list')

    this.activityIndicator = page.locator('.twv-activity-indicator, [class*="activity"]')
    this.pausedBadge = page.locator('.twv-paused-badge')
  }

  // ── Navigation ────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.root.waitFor({ state: 'visible' })
  }

  // ── Connection helpers ────────────────────────────────────────────────

  async waitForConnected(timeout = 8000): Promise<void> {
    await expect(this.connectionBanner).toBeHidden({ timeout })
  }

  async expectConnected(): Promise<void> {
    await expect(this.connectionBanner).toBeHidden()
  }

  async expectDisconnected(): Promise<void> {
    await expect(this.connectionBanner).toBeVisible()
  }

  // ── Messaging helpers ─────────────────────────────────────────────────

  async typeMessage(text: string): Promise<void> {
    await this.messageInput.fill(text)
  }

  async sendMessage(text: string): Promise<void> {
    await this.typeMessage(text)
    await this.sendButton.click()
  }

  async sendMessageWithEnter(text: string): Promise<void> {
    await this.typeMessage(text)
    await this.messageInput.press('Enter')
  }

  async sendMessageWithShiftEnter(text: string): Promise<void> {
    await this.typeMessage(text)
    // Shift+Enter should NOT send — it adds a newline
    await this.messageInput.press('Shift+Enter')
  }

  // ── Block accessors ───────────────────────────────────────────────────

  /** All blocks in the chat area */
  blocks(): Locator {
    return this.chatArea.locator('.twv-user-bubble, .twv-agent-block, .twv-agent-comment')
  }

  /** User message bubbles */
  userBubbles(): Locator {
    return this.chatArea.locator('.twv-user-bubble')
  }

  /** Most recent user bubble */
  lastUserBubble(): Locator {
    return this.userBubbles().last()
  }

  /** Code blocks (collapsible) */
  codeBlocks(): Locator {
    return this.chatArea.locator('.twv-code-block')
  }

  lastCodeBlock(): Locator {
    return this.codeBlocks().last()
  }

  /** Error blocks */
  errorBlocks(): Locator {
    return this.chatArea.locator('.twv-error-block')
  }

  lastErrorBlock(): Locator {
    return this.errorBlocks().last()
  }

  /** Display blocks (display()) */
  displayBlocks(): Locator {
    return this.chatArea.locator('.twv-display-block')
  }

  /** Form blocks (ask()) */
  formCards(): Locator {
    return this.chatArea.locator('.twv-form-card')
  }

  lastFormCard(): Locator {
    return this.formCards().last()
  }

  /** Budget bars */
  budgetBars(): Locator {
    return this.chatArea.locator('.twv-budget-block')
  }

  /** Fork blocks */
  forkBlocks(): Locator {
    return this.chatArea.locator('.twv-fork-block')
  }

  /** Checkpoint blocks */
  checkpointBlocks(): Locator {
    return this.chatArea.locator('.twv-checkpoint-block')
  }

  /** Space info blocks */
  spaceInfoBlocks(): Locator {
    return this.chatArea.locator('.twv-space-info-block')
  }

  /** Knowledge form blocks */
  knowledgeForms(): Locator {
    return this.chatArea.locator('.twv-knowledge-form-block')
  }

  /** Hook blocks */
  hookBlocks(): Locator {
    return this.chatArea.locator('.twv-hook-block')
  }

  /** Tasklist blocks */
  tasklistBlocks(): Locator {
    return this.chatArea.locator('.twv-tasklist')
  }

  /** Agent comment blocks */
  agentComments(): Locator {
    return this.chatArea.locator('.twv-agent-comment')
  }

  // ── Collapsible helpers ───────────────────────────────────────────────

  async expandBlock(block: Locator): Promise<void> {
    const header = block.locator('.twv-collapsible__header')
    const chevron = block.locator('.twv-collapsible__chevron')
    const isOpen = await chevron.evaluate((el) =>
      el.classList.contains('twv-collapsible__chevron--open'),
    )
    if (!isOpen) {
      await header.click()
      await expect(block.locator('.twv-collapsible__body')).toBeVisible()
    }
  }

  async collapseBlock(block: Locator): Promise<void> {
    const chevron = block.locator('.twv-collapsible__chevron')
    const isOpen = await chevron.evaluate((el) =>
      el.classList.contains('twv-collapsible__chevron--open'),
    )
    if (isOpen) {
      await block.locator('.twv-collapsible__header').click()
    }
  }

  async getCollapsibleSummary(block: Locator): Promise<string> {
    return block.locator('.twv-collapsible__summary').innerText()
  }

  async getCollapsibleBody(block: Locator): Promise<string> {
    await expect(block.locator('.twv-collapsible__body')).toBeVisible()
    return block.locator('.twv-collapsible__body').innerText()
  }

  // ── Assertions ────────────────────────────────────────────────────────

  async expectEmptyState(): Promise<void> {
    await expect(this.emptyState).toBeVisible()
    await expect(this.emptyStateLogo).toContainText('@lmthing/repl')
  }

  async expectNoEmptyState(): Promise<void> {
    await expect(this.emptyState).toBeHidden()
  }

  async expectUserBubble(text: string): Promise<void> {
    await expect(
      this.chatArea.locator('.twv-user-bubble__inner', { hasText: text }),
    ).toBeVisible()
  }

  async expectCodeBlock(): Promise<void> {
    await expect(this.codeBlocks().first()).toBeVisible()
  }

  async expectStreamingCodeBlock(): Promise<void> {
    await expect(
      this.chatArea.locator('.twv-code-block .twv-streaming-icon'),
    ).toBeVisible()
  }

  async expectNoStreamingCodeBlock(): Promise<void> {
    await expect(
      this.chatArea.locator('.twv-code-block .twv-streaming-icon'),
    ).toBeHidden()
  }

  async expectErrorBlock(message?: string): Promise<void> {
    const errorBlock = this.errorBlocks().first()
    await expect(errorBlock).toBeVisible()
    if (message) {
      await this.expandBlock(errorBlock)
      await expect(errorBlock).toContainText(message)
    }
  }

  async expectDisplayBlock(): Promise<void> {
    await expect(this.displayBlocks().first()).toBeVisible()
  }

  async expectFormCard(): Promise<void> {
    await expect(this.formCards().first()).toBeVisible()
  }

  async expectFormSubmitted(): Promise<void> {
    await expect(
      this.chatArea.locator('.twv-form-card--submitted'),
    ).toBeVisible()
  }

  async expectBudgetBar(): Promise<void> {
    await expect(this.budgetBars().first()).toBeVisible()
  }

  async expectForkBlock(forkId?: string): Promise<void> {
    const block = forkId
      ? this.chatArea.locator(`.twv-fork-block`, { hasText: forkId })
      : this.forkBlocks().first()
    await expect(block).toBeVisible()
  }

  async expectResolvedFork(): Promise<void> {
    await expect(this.chatArea.locator('.twv-fork-block--resolved')).toBeVisible()
  }

  async expectCheckpointBlock(label?: string): Promise<void> {
    const block = this.checkpointBlocks().first()
    await expect(block).toBeVisible()
    if (label) await expect(block).toContainText(label)
  }

  async expectSpaceInfoBlock(): Promise<void> {
    await expect(this.spaceInfoBlocks().first()).toBeVisible()
  }

  async expectKnowledgeForm(agentSlug?: string): Promise<void> {
    const form = this.knowledgeForms().first()
    await expect(form).toBeVisible()
    if (agentSlug) await expect(form).toContainText(agentSlug)
  }

  async expectPausedBadge(): Promise<void> {
    await expect(this.pausedBadge).toBeVisible()
  }

  async expectNoPausedBadge(): Promise<void> {
    await expect(this.pausedBadge).toBeHidden()
  }

  // ── InputBar state assertions ─────────────────────────────────────────

  async expectInputPlaceholder(placeholder: string): Promise<void> {
    await expect(this.messageInput).toHaveAttribute('placeholder', placeholder)
  }

  async expectInputEnabled(): Promise<void> {
    await expect(this.messageInput).toBeEnabled()
  }

  async expectInputDisabled(): Promise<void> {
    await expect(this.messageInput).toBeDisabled()
  }

  async expectSendButtonDisabled(): Promise<void> {
    await expect(this.sendButton).toBeDisabled()
  }

  async expectSendButtonEnabled(): Promise<void> {
    await expect(this.sendButton).toBeEnabled()
  }

  async expectPauseButtonVisible(): Promise<void> {
    await expect(this.pauseButton).toBeVisible()
  }

  async expectResumeButtonVisible(): Promise<void> {
    await expect(this.resumeButton).toBeVisible()
  }

  async expectNoPauseResumeButton(): Promise<void> {
    await expect(this.pauseButton).toBeHidden()
    await expect(this.resumeButton).toBeHidden()
  }

  // ── Actions (slash command) dropdown ──────────────────────────────────

  async openActionsDropdown(query = '/'): Promise<void> {
    await this.messageInput.fill(query)
    await expect(this.actionsDropdown).toBeVisible()
  }

  async expectActionsDropdownVisible(): Promise<void> {
    await expect(this.actionsDropdown).toBeVisible()
  }

  async expectActionsDropdownHidden(): Promise<void> {
    await expect(this.actionsDropdown).toBeHidden()
  }

  async selectActionFromDropdown(actionId: string): Promise<void> {
    await this.actionsDropdown
      .locator('.twv-actions-dropdown__item', { hasText: actionId })
      .click()
  }

  async expectDropdownItemSelected(index: number): Promise<void> {
    const items = this.actionsDropdown.locator('.twv-actions-dropdown__item')
    await expect(items.nth(index)).toHaveClass(/twv-actions-dropdown__item--selected/)
  }

  // ── Agent (@ picker) dropdown ─────────────────────────────────────────

  async openAgentsDropdown(query = '@'): Promise<void> {
    await this.messageInput.fill(query)
    await expect(this.agentsDropdown).toBeVisible()
  }

  // ── Form submission ───────────────────────────────────────────────────

  async submitForm(formLocator: Locator): Promise<void> {
    await formLocator.locator('button[type="submit"]').click()
  }

  async cancelForm(formLocator: Locator): Promise<void> {
    await formLocator.locator('button[type="button"]', { hasText: 'Cancel' }).click()
  }

  // ── Conversation sidebar ──────────────────────────────────────────────

  async expectConversationInSidebar(title: string): Promise<void> {
    await expect(
      this.convSidebarList.locator('.twv-conv-sidebar__item', { hasText: title }),
    ).toBeVisible()
  }

  async clickConversation(title: string): Promise<void> {
    await this.convSidebarList
      .locator('.twv-conv-sidebar__item', { hasText: title })
      .click()
  }

  async clickNewConversation(): Promise<void> {
    await this.convSidebarNewBtn.click()
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  async pressPauseShortcut(): Promise<void> {
    await this.page.keyboard.press('Control+Shift+P')
  }

  // ── Scroll helpers ────────────────────────────────────────────────────

  async isScrolledToBottom(): Promise<boolean> {
    return this.chatArea.evaluate((el) => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 80
    })
  }

  async scrollToTop(): Promise<void> {
    await this.chatArea.evaluate((el) => {
      el.scrollTop = 0
    })
  }

  // ── Snapshot helpers ──────────────────────────────────────────────────

  async getPageSnapshot(): Promise<{ html: string; screenshot: Buffer }> {
    const html = await this.page.content()
    const screenshot = await this.page.screenshot({ fullPage: false })
    return { html, screenshot }
  }
}
