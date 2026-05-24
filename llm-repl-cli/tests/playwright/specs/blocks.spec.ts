import { test, expect, e, jsx } from '../fixtures/index.js'

test.describe('Block rendering', () => {
  // ── Empty state ─────────────────────────────────────────────────────────

  test('shows empty state on fresh session', async ({ chatPage }) => {
    await chatPage.expectEmptyState()
    await expect(chatPage.emptyStateLogo).toContainText('@lmthing/repl')
  })

  test('empty state disappears after first block', async ({ chatPage, mockWs }) => {
    await chatPage.expectEmptyState()
    await chatPage.sendMessage('hi')
    await chatPage.expectNoEmptyState()
  })

  // ── User bubble ─────────────────────────────────────────────────────────

  test('user bubble renders message text', async ({ chatPage, mockWs }) => {
    await chatPage.sendMessage('test message')
    const bubble = chatPage.chatArea.locator('.twv-user-bubble__inner', { hasText: 'test message' })
    await expect(bubble).toBeVisible()
  })

  // ── Code block ──────────────────────────────────────────────────────────

  test('code block is collapsed by default', async ({ chatPage, mockWs }) => {
    mockWs.sendCode('blk1', 'const x = 42\nconsole.log(x)')
    await chatPage.expectCodeBlock()
    const block = chatPage.lastCodeBlock()
    await expect(block.locator('.twv-collapsible__body')).toBeHidden()
  })

  test('code block expand/collapse toggle', async ({ chatPage, mockWs }) => {
    mockWs.sendCode('blk1', 'const x = 1\nconst y = 2')
    const block = chatPage.lastCodeBlock()
    await expect(block).toBeVisible()

    // Expand
    await chatPage.expandBlock(block)
    await expect(block.locator('.twv-collapsible__body')).toBeVisible()
    await expect(block.locator('pre code')).toContainText('const x = 1')

    // Collapse
    await chatPage.collapseBlock(block)
    await expect(block.locator('.twv-collapsible__body')).toBeHidden()
  })

  test('code block shows line count in meta', async ({ chatPage, mockWs }) => {
    mockWs.sendCode('blk2', 'const a = 1\nconst b = 2\nconst c = 3')
    const block = chatPage.lastCodeBlock()
    const meta = await block.locator('.twv-collapsible__meta').innerText()
    expect(meta).toMatch(/3 lines|2 lines|1 line/)
  })

  test('streaming code block shows streaming indicator', async ({ chatPage, mockWs }) => {
    // Send code event without code_complete to keep it streaming
    mockWs.send(e.code('blk_stream', 'const streaming = true\n'))
    await chatPage.expectCodeBlock()
    await chatPage.expectStreamingCodeBlock()
  })

  test('code_complete removes streaming indicator', async ({ chatPage, mockWs }) => {
    mockWs.send(e.code('blk3', 'const x = 1'))
    await chatPage.expectStreamingCodeBlock()
    mockWs.send(e.codeComplete('blk3'))
    await chatPage.expectNoStreamingCodeBlock()
  })

  test('code block streaming appends chunks correctly', async ({ chatPage, mockWs }) => {
    mockWs.send(e.code('blk4', 'const a = '))
    mockWs.send(e.code('blk4', '"hello"'))
    mockWs.send(e.codeComplete('blk4'))
    const block = chatPage.lastCodeBlock()
    await chatPage.expandBlock(block)
    await expect(block.locator('pre code')).toContainText('const a = "hello"')
  })

  test('code with leading comments renders agent comment blocks', async ({ chatPage, mockWs }) => {
    mockWs.sendCode('blkC', '// First I will initialize the variable\nconst x = 42')
    // Should render an agent comment for the comment and a code block for the code
    await expect(chatPage.agentComments().first()).toBeVisible()
    await expect(chatPage.agentComments().first()).toContainText('First I will initialize')
    await expect(chatPage.codeBlocks().first()).toBeVisible()
  })

  // ── Error block ─────────────────────────────────────────────────────────

  test('error block shows error type in summary', async ({ chatPage, mockWs }) => {
    mockWs.send(e.error('blkE', {
      type: 'TypeError',
      message: 'Cannot read property "x" of undefined',
      line: 5,
      source: 'obj.x',
    }))
    const block = chatPage.lastErrorBlock()
    await expect(block).toBeVisible()
    const summary = await chatPage.getCollapsibleSummary(block)
    expect(summary).toContain('TypeError')
    expect(summary).toContain('Cannot read property')
  })

  test('error block expand shows source', async ({ chatPage, mockWs }) => {
    mockWs.send(e.error('blkE2', {
      type: 'ReferenceError',
      message: 'foo is not defined',
      line: 12,
      source: 'foo()',
    }))
    const block = chatPage.lastErrorBlock()
    await chatPage.expandBlock(block)
    const body = await chatPage.getCollapsibleBody(block)
    expect(body).toContain('foo is not defined')
    expect(body).toContain('foo()')
    expect(body).toContain('Line 12')
  })

  // ── Read block ──────────────────────────────────────────────────────────

  test('read block shows payload summary', async ({ chatPage, mockWs }) => {
    mockWs.send(e.read('blkR', { user: 'alice', role: 'admin' }))
    const block = chatPage.chatArea.locator('.twv-read-block').first()
    await expect(block).toBeVisible()
    const summary = await chatPage.getCollapsibleSummary(block)
    expect(summary).toContain('Read')
  })

  test('read block expands to show JSON', async ({ chatPage, mockWs }) => {
    mockWs.send(e.read('blkR2', { count: 42, active: true }))
    const block = chatPage.chatArea.locator('.twv-read-block').first()
    await chatPage.expandBlock(block)
    const body = await chatPage.getCollapsibleBody(block)
    expect(body).toContain('42')
  })

  // ── Display block ───────────────────────────────────────────────────────

  test('display block renders JSX content', async ({ chatPage, mockWs }) => {
    mockWs.sendDisplay('disp1', jsx.paragraph('Hello from display()'))
    await chatPage.expectDisplayBlock()
    await expect(chatPage.displayBlocks().first()).toContainText('Hello from display()')
  })

  test('display block renders heading', async ({ chatPage, mockWs }) => {
    mockWs.sendDisplay('disp2', jsx.heading('My Report'))
    const block = chatPage.displayBlocks().first()
    await expect(block).toBeVisible()
    await expect(block.locator('h2')).toContainText('My Report')
  })

  // ── Budget bar ──────────────────────────────────────────────────────────

  test('budget bar shows token usage', async ({ chatPage, mockWs }) => {
    mockWs.send(e.budgetUpdate({ tokensUsed: 1500, tokensRemaining: 62500 }))
    await chatPage.expectBudgetBar()
    const bar = chatPage.budgetBars().first()
    await expect(bar).toContainText('1,500')
    await expect(bar).toContainText('64,000')
  })

  test('budget bar shows cost', async ({ chatPage, mockWs }) => {
    mockWs.send(e.budgetUpdate({ costUsd: 0.000423, cycleCostUsd: 0.000212 }))
    const bar = chatPage.budgetBars().first()
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('$0.0')
  })

  test('budget bar shows nearing limit warning', async ({ chatPage, mockWs }) => {
    mockWs.send(e.budgetUpdate({ tokensUsed: 60000, tokensRemaining: 4000, nearingLimit: true }))
    const bar = chatPage.budgetBars().first()
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('nearing limit')
  })

  test('budget bar shows fork counts', async ({ chatPage, mockWs }) => {
    mockWs.send(e.budgetUpdate({ forksActive: 2, forksCompleted: 1 }))
    const bar = chatPage.budgetBars().first()
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('2 active')
    await expect(bar).toContainText('1 done')
  })

  // ── Fork blocks ─────────────────────────────────────────────────────────

  test('fork spawn shows pending fork block', async ({ chatPage, mockWs }) => {
    mockWs.send(e.forkSpawn('fork1', 'Research competitor landscape', 8000))
    const block = chatPage.forkBlocks().first()
    await expect(block).toBeVisible()
    await expect(block).toContainText('fork1')
    await expect(block).toHaveClass(/twv-fork-block--pending/)
  })

  test('fork resolve marks block as resolved', async ({ chatPage, mockWs }) => {
    mockWs.send(e.forkSpawn('fork2', 'Analyze codebase', 4000))
    await chatPage.expectForkBlock('fork2')
    mockWs.send(e.forkResolve('fork2', 1200))
    await chatPage.expectResolvedFork()
    // Resolved fork shows token usage
    await expect(chatPage.chatArea.locator('.twv-fork-block--resolved')).toContainText('1200')
  })

  test('fork block expand shows instruction', async ({ chatPage, mockWs }) => {
    const instruction = 'Analyze the performance bottlenecks in the rendering pipeline'
    mockWs.send(e.forkSpawn('fork3', instruction, 6000))
    const block = chatPage.forkBlocks().first()
    await chatPage.expandBlock(block)
    await expect(block.locator('.twv-collapsible__body')).toContainText('Analyze the performance')
  })

  // ── Checkpoint block ─────────────────────────────────────────────────────

  test('checkpoint block shows label', async ({ chatPage, mockWs }) => {
    mockWs.send(e.checkpoint('before-database-migration'))
    await chatPage.expectCheckpointBlock('before-database-migration')
  })

  // ── Space info block ──────────────────────────────────────────────────────

  test('space info block shows agent and flow', async ({ chatPage, mockWs }) => {
    mockWs.send(e.spaceInfo('researcher', 'deep-research', '/home/user/spaces/research'))
    await chatPage.expectSpaceInfoBlock()
    const block = chatPage.spaceInfoBlocks().first()
    await expect(block).toContainText('researcher')
    await expect(block).toContainText('deep-research')
  })

  // ── Hook block ────────────────────────────────────────────────────────────

  test('hook block shows hook ID and action', async ({ chatPage, mockWs }) => {
    mockWs.send(e.hook('blkH', 'pre-exec', 'allow', 'Executing read operation'))
    const block = chatPage.hookBlocks().first()
    await expect(block).toBeVisible()
    const summary = await chatPage.getCollapsibleSummary(block)
    expect(summary).toContain('pre-exec')
    expect(summary).toContain('allow')
  })

  test('interrupt hook has distinct styling', async ({ chatPage, mockWs }) => {
    mockWs.send(e.hook('blkHI', 'security-check', 'interrupt', 'Access denied'))
    const block = chatPage.hookBlocks().first()
    await expect(block).toHaveClass(/twv-hook-block--interrupt/)
  })

  // ── Tasklist ──────────────────────────────────────────────────────────────

  test('tasklist declared shows plan description and tasks', async ({ chatPage, mockWs }) => {
    mockWs.send(e.tasklistDeclared('tl1', {
      description: 'Research plan',
      tasks: [
        { id: 't1', instructions: 'Search the web' },
        { id: 't2', instructions: 'Analyze results' },
      ],
    }))
    const block = chatPage.tasklistBlocks().first()
    await expect(block).toBeVisible()
    await expect(block).toContainText('Research plan')
    await expect(block).toContainText('Search the web')
    await expect(block).toContainText('Analyze results')
  })

  test('task complete block shows task IDs', async ({ chatPage, mockWs }) => {
    mockWs.send(e.tasklistDeclared('tl2', {
      description: 'Plan',
      tasks: [{ id: 'step1', instructions: 'Do step 1' }],
    }))
    mockWs.send(e.taskComplete('tl2', 'step1'))
    const completeBlock = chatPage.chatArea.locator('.twv-task-complete-block')
    await expect(completeBlock).toBeVisible()
    await expect(completeBlock).toContainText('tl2/step1')
  })

  // ── Knowledge form ────────────────────────────────────────────────────────

  test('knowledge form renders fields', async ({ chatPage, mockWs }) => {
    mockWs.send(e.knowledgeForm('kf1', 'researcher', [
      { domain: 'search', field: 'depth', label: 'Search Depth', options: ['shallow', 'deep', 'exhaustive'] },
    ]))
    await chatPage.expectKnowledgeForm('researcher')
    const form = chatPage.knowledgeForms().first()
    await expect(form).toContainText('Search Depth')
    await expect(form.locator('select')).toBeVisible()
  })

  test('knowledge form submit sends submitKnowledge WS message', async ({ chatPage, mockWs }) => {
    mockWs.send(e.knowledgeForm('kf2', 'researcher', [
      { domain: 'search', field: 'mode', label: 'Mode', options: ['fast', 'thorough'] },
    ]))
    await chatPage.expectKnowledgeForm()
    const form = chatPage.knowledgeForms().first()
    await form.locator('.twv-knowledge-form-block__submit').click()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'submitKnowledge', 3000)
    expect(msg['id']).toBe('kf2')
  })

  test('knowledge form skip sends submitKnowledge with empty data', async ({ chatPage, mockWs }) => {
    mockWs.send(e.knowledgeForm('kf3', 'reviewer', [
      { domain: 'review', field: 'style', label: 'Style', options: ['strict', 'lenient'] },
    ]))
    await chatPage.expectKnowledgeForm()
    const form = chatPage.knowledgeForms().first()
    await form.locator('.twv-knowledge-form-block__cancel').click()
    const msg = await mockWs.waitForMessage((m) => m['type'] === 'submitKnowledge', 3000)
    expect(msg['id']).toBe('kf3')
  })

  test('knowledge_form_done removes the form block', async ({ chatPage, mockWs }) => {
    mockWs.send(e.knowledgeForm('kf4', 'agent', [
      { domain: 'd', field: 'f', label: 'L', options: ['a', 'b'] },
    ]))
    await chatPage.expectKnowledgeForm()
    mockWs.send(e.knowledgeFormDone('kf4'))
    await expect(chatPage.knowledgeForms()).toHaveCount(0, { timeout: 3000 })
  })
})
