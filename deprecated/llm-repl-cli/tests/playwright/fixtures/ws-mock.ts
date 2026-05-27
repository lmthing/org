import type { Page } from '@playwright/test'
import { e, EMPTY_SNAPSHOT, type SessionSnapshot, type SessionStatus, type SerializedJSX } from '../helpers/events.js'

type MessageHandler = (msg: Record<string, unknown>) => void | Promise<void>

/**
 * Controls the mock WebSocket server from the test side.
 * Install before page.goto() — wraps page.routeWebSocket for ws://localhost:3010.
 */
export class WsMock {
  private sendFn: ((data: string) => void) | null = null
  private messageHandlers: MessageHandler[] = []
  private receivedMessages: Record<string, unknown>[] = []
  private connectResolvers: Array<() => void> = []
  private connected = false

  async install(page: Page): Promise<void> {
    await page.routeWebSocket('ws://localhost:3010', (ws) => {
      this.connected = true
      this.sendFn = (data) => ws.send(data)
      this.connectResolvers.forEach((r) => r())
      this.connectResolvers = []

      // Send initial handshake
      ws.send(JSON.stringify(e.snapshot()))
      ws.send(JSON.stringify(e.spaceMetadata()))

      ws.onMessage((raw) => {
        const msg = JSON.parse(raw as string) as Record<string, unknown>
        this.receivedMessages.push(msg)

        // Auto-respond to housekeeping requests
        if (msg['type'] === 'getSnapshot') {
          ws.send(JSON.stringify(e.snapshot()))
        } else if (msg['type'] === 'listConversations') {
          ws.send(JSON.stringify(e.conversations()))
        }

        for (const handler of this.messageHandlers) {
          void handler(msg)
        }
      })
    })
  }

  /** Wait until the browser has opened the WebSocket */
  async waitForConnect(timeout = 5000): Promise<void> {
    if (this.connected) return
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WsMock: connect timeout')), timeout)
      this.connectResolvers.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Push any JSON event to the browser */
  send(event: Record<string, unknown>): void {
    if (!this.sendFn) throw new Error('WsMock.send called before WebSocket opened')
    this.sendFn(JSON.stringify(event))
  }

  /** Register a handler for messages sent FROM the browser */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  /** Return all messages received from the browser */
  getReceived(): Record<string, unknown>[] {
    return [...this.receivedMessages]
  }

  /** Return the last N messages from the browser */
  lastReceived(n = 1): Record<string, unknown>[] {
    return this.receivedMessages.slice(-n)
  }

  /** Wait for the browser to send a message matching a predicate */
  async waitForMessage(
    predicate: (msg: Record<string, unknown>) => boolean,
    timeout = 5000,
  ): Promise<Record<string, unknown>> {
    // Check already-received messages first
    const found = this.receivedMessages.find(predicate)
    if (found) return found

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('WsMock.waitForMessage: timeout')),
        timeout,
      )
      const handler: MessageHandler = (msg) => {
        if (predicate(msg)) {
          clearTimeout(timer)
          this.messageHandlers = this.messageHandlers.filter((h) => h !== handler)
          resolve(msg)
        }
      }
      this.messageHandlers.push(handler)
    })
  }

  // ── Scenario helpers ────────────────────────────────────────────────────

  /** Transition session status */
  setStatus(status: SessionStatus): void {
    this.send(e.status(status))
  }

  /** Replace the full snapshot */
  setSnapshot(snapshot: Partial<SessionSnapshot>): void {
    this.send(e.snapshot(snapshot))
  }

  /** Stream a code block, then mark it complete */
  async streamCode(blockId: string, code: string, chunkSize = 40): Promise<void> {
    for (let i = 0; i < code.length; i += chunkSize) {
      this.send(e.code(blockId, code.slice(i, i + chunkSize)))
      await new Promise((r) => setTimeout(r, 10))
    }
    this.send(e.codeComplete(blockId))
  }

  /** Send a full code block at once (no streaming) */
  sendCode(blockId: string, code: string): void {
    this.send(e.code(blockId, code))
    this.send(e.codeComplete(blockId))
  }

  /** Emit a display() block */
  sendDisplay(componentId: string, jsx: SerializedJSX): void {
    this.send(e.display(componentId, jsx))
  }

  /** Start an ask() form */
  startAsk(formId: string, jsx: SerializedJSX): void {
    this.send(e.askStart(formId, jsx))
    this.send(e.snapshot({ activeFormId: formId, status: 'waiting_for_input' }))
  }

  /** Complete an ask() (simulate user submission) */
  endAsk(formId: string): void {
    this.send(e.askEnd(formId))
    this.send(e.snapshot({ activeFormId: null, status: 'idle' }))
  }

  /** Simulate a full agent execution cycle */
  async simulateCycle(opts: {
    code?: string
    display?: SerializedJSX
    error?: { type: string; message: string; line: number; source: string }
    finalStatus?: SessionStatus
  } = {}): Promise<void> {
    const blockId = `blk_${Date.now()}`
    this.setStatus('executing')
    await new Promise((r) => setTimeout(r, 20))

    if (opts.code) {
      await this.streamCode(blockId, opts.code)
    }
    if (opts.display) {
      this.sendDisplay(`disp_${blockId}`, opts.display)
    }
    if (opts.error) {
      this.send(e.error(blockId, opts.error))
    }

    this.send(e.budgetUpdate({ tokensUsed: 500, cycleCostUsd: 0.000125 }))
    this.setStatus(opts.finalStatus ?? 'idle')
  }

  /** Provide a list of conversations */
  setConversations(
    list: Array<{ id: string; title: string; updatedAt: string; turnCount: number }>,
  ): void {
    this.send(e.conversations(list))
  }

  /** Push space agent info (for @ picker) */
  setAgents(agents: Array<{ slug: string; title: string; requiredKnowledge: unknown[] }>): void {
    this.send(e.spaceMetadata(agents))
  }

  /** Push available slash commands */
  setActions(actions: Array<{ id: string; label: string; description: string }>): void {
    this.send(e.actions(actions))
  }

  /** Emit fork spawn + resolve */
  async simulateFork(forkId: string, instruction: string): Promise<void> {
    this.send(e.forkSpawn(forkId, instruction, 4000))
    await new Promise((r) => setTimeout(r, 30))
    this.send(e.forkResolve(forkId, 820))
  }
}
