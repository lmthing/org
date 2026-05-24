import type { UIBlock, BlockAction, SerializedJSX, ErrorPayload } from './types'

export function blocksReducer(blocks: UIBlock[], action: BlockAction): UIBlock[] {
  if (action.type === 'reset') return []
  if (action.type === 'add_user_message') {
    return [...blocks, { type: 'user', id: action.id, text: action.text }]
  }

  const ev = action.event as Record<string, unknown>
  switch (ev['type']) {
    case 'code': {
      const blockId = ev['blockId'] as string
      const lines = ev['lines'] as string
      const idx = blocks.findIndex((b) => b.id === blockId)
      if (idx >= 0) {
        const block = blocks[idx] as Extract<UIBlock, { type: 'code' }>
        const newCode = block.code + lines
        const newBlocks = [...blocks]
        newBlocks[idx] = { ...block, code: newCode, lineCount: countLines(newCode) }
        return newBlocks
      }
      return [
        ...blocks,
        {
          type: 'code',
          id: blockId,
          code: lines,
          streaming: true,
          lineCount: countLines(lines),
        },
      ]
    }
    case 'code_complete': {
      const blockId = ev['blockId'] as string
      return blocks.map((b) =>
        b.id === blockId && b.type === 'code' ? { ...b, streaming: false } : b,
      )
    }
    case 'read':
      return [
        ...blocks,
        {
          type: 'read',
          id: ev['blockId'] as string,
          payload: (ev['payload'] ?? {}) as Record<string, unknown>,
        },
      ]
    case 'error':
      return [
        ...blocks,
        {
          type: 'error',
          id: ev['blockId'] as string,
          error: ev['error'] as ErrorPayload,
        },
      ]
    case 'hook':
      return [
        ...blocks,
        {
          type: 'hook',
          id: ev['blockId'] as string,
          hookId: ev['hookId'] as string,
          action: ev['action'] as string,
          detail: ev['detail'] as string,
        },
      ]
    case 'display':
      return [
        ...blocks,
        {
          type: 'display',
          id: ev['componentId'] as string,
          jsx: ev['jsx'] as SerializedJSX,
        },
      ]
    case 'ask_start':
      return [
        ...blocks,
        {
          type: 'form',
          id: ev['formId'] as string,
          jsx: ev['jsx'] as SerializedJSX,
          status: 'active' as const,
        },
      ]
    case 'ask_end':
      return blocks.map((b) =>
        b.type === 'form' && b.id === (ev['formId'] as string)
          ? { ...b, status: 'submitted' as const }
          : b,
      )
    case 'tasklist_declared':
      return [
        ...blocks,
        {
          type: 'tasklist_declared',
          id: `tl_plan_${ev['tasklistId'] as string}_${Date.now()}`,
          tasklistId: ev['tasklistId'] as string,
          plan: ev['plan'] as import('./types').Tasklist,
        },
      ]
    case 'task_complete':
      return [
        ...blocks,
        {
          type: 'task_complete',
          id: `tl_${ev['tasklistId'] as string}_${ev['id'] as string}`,
          tasklistId: ev['tasklistId'] as string,
          taskId: ev['id'] as string,
          output: (ev['output'] ?? {}) as Record<string, unknown>,
        },
      ]

    // ── New llm-repl-cli events ──

    case 'budget_update':
      return [
        ...blocks,
        {
          type: 'budget_update',
          id: `budget_${Date.now()}`,
          tokensUsed: (ev['tokensUsed'] as number) ?? 0,
          tokensRemaining: (ev['tokensRemaining'] as number) ?? 0,
          costUsd: (ev['costUsd'] as number) ?? 0,
          cycleCostUsd: (ev['cycleCostUsd'] as number) ?? 0,
          forksActive: (ev['forksActive'] as number) ?? 0,
          forksCompleted: (ev['forksCompleted'] as number) ?? 0,
          nearingLimit: (ev['nearingLimit'] as boolean) ?? false,
        },
      ]

    case 'fork_spawn':
      return [
        ...blocks,
        {
          type: 'fork_spawn',
          id: `fork_${ev['forkId'] as string}`,
          forkId: ev['forkId'] as string,
          instruction: (ev['instruction'] as string) ?? '',
          tokenCap: (ev['tokenCap'] as number) ?? 0,
          resolved: false,
        },
      ]

    case 'fork_resolve': {
      const forkId = ev['forkId'] as string
      const updated = blocks.map((b) =>
        b.type === 'fork_spawn' && b.forkId === forkId
          ? { ...b, resolved: true, tokensUsed: (ev['tokensUsed'] as number) ?? 0 }
          : b,
      )
      return updated
    }

    case 'checkpoint':
      return [
        ...blocks,
        {
          type: 'checkpoint',
          id: `cp_${Date.now()}`,
          label: (ev['label'] as string) ?? '',
        },
      ]

    case 'space_info':
      // Only add if not already present (first one wins)
      if (blocks.some((b) => b.type === 'space_info')) return blocks
      return [
        {
          type: 'space_info',
          id: 'space_info',
          agentSlug: (ev['agentSlug'] as string) ?? '',
          flowSlug: (ev['flowSlug'] as string) ?? '',
          spaceDir: (ev['spaceDir'] as string) ?? '',
        },
        ...blocks,
      ]

    default:
      return blocks
  }
}

function countLines(code: string): number {
  return code.split('\n').filter((l) => l.trim().length > 0).length
}
