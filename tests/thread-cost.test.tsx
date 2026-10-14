import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { addTurnCost, readClaudeResultCost } from '../electron/main/services/conversation/thread-cost'
import { ThreadCostChip, formatThreadCost } from '../src/components/Threads/ThreadCostChip'
import type { ThreadEvent } from '../shared/types/thread'

describe('readClaudeResultCost', () => {
  it('reads cost and token usage from a result frame', () => {
    expect(readClaudeResultCost({ total_cost_usd: 0.0421, usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 9000, cache_creation_input_tokens: 50 } }))
      .toEqual({ usd: 0.0421, inputTokens: 1200, outputTokens: 340, cacheReadTokens: 9000, cacheCreationTokens: 50 })
  })

  it('ignores absent, negative, non-finite and absurd values', () => {
    expect(readClaudeResultCost({})).toBeNull()
    expect(readClaudeResultCost({ total_cost_usd: -1, usage: { input_tokens: Number.NaN } })).toBeNull()
    expect(readClaudeResultCost({ total_cost_usd: 1e9 })).toBeNull()
    expect(readClaudeResultCost({ total_cost_usd: '0.5' })).toBeNull()
    expect(readClaudeResultCost({ usage: { output_tokens: 10 } })).toEqual({ outputTokens: 10 })
  })
})

describe('addTurnCost', () => {
  it('accumulates turns, dollars and tokens', () => {
    const first = addTurnCost(undefined, { usd: 0.1, inputTokens: 100, outputTokens: 10 }, 1)
    const second = addTurnCost(first, { usd: 0.25, inputTokens: 50 }, 2)
    expect(second).toMatchObject({ totalUsd: 0.35, turns: 2, lastTurnUsd: 0.25, inputTokens: 150, outputTokens: 10, updatedAt: 2 })
    expect(second.totalUsd).toBeCloseTo(0.35)
  })

  it('counts a turn without a cost and keeps the last known per-turn figure', () => {
    const first = addTurnCost(undefined, { usd: 0.2 }, 1)
    const second = addTurnCost(first, { outputTokens: 5 }, 2)
    expect(second).toMatchObject({ totalUsd: 0.2, turns: 2, lastTurnUsd: 0.2, outputTokens: 5 })
  })
})

describe('Claude adapter reports turn cost', () => {
  it('emits metadata-only turn-cost before completion', async () => {
    const turns: { data: (c: Uint8Array) => void; close: () => void }[] = []
    const adapter = new ClaudeConversationAdapter(() => {
      const turn = { data: (_c: Uint8Array) => {}, close: () => {} }
      turns.push(turn)
      return {
        write: (text: string) => {
          const m = JSON.parse(text) as Record<string, unknown>
          if (m.type === 'control_request' && m.request_id === 'initialize') {
            turn.data(Buffer.from(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response: { commands: [], models: [] } } }) + '\n'))
          }
        },
        onData: (cb: (c: Uint8Array) => void) => { turn.data = cb },
        onClose: (cb: () => void) => { turn.close = cb },
        close: vi.fn(async () => turn.close())
      }
    })
    const events: ThreadEvent[] = []
    await adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, (e) => events.push(e))
    await adapter.send('Do it')
    turns[0].data(Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05, usage: { input_tokens: 10, output_tokens: 20 } }) + '\n'))

    const costIndex = events.findIndex((e) => e.type === 'turn-cost')
    const doneIndex = events.findIndex((e) => e.type === 'completed')
    expect(costIndex).toBeGreaterThanOrEqual(0)
    expect(costIndex).toBeLessThan(doneIndex)
    expect(events[costIndex]).toMatchObject({ type: 'turn-cost', usd: 0.05, inputTokens: 10, outputTokens: 20 })
    await adapter.dispose()
  })
})

describe('ThreadCostChip', () => {
  it('formats small amounts without showing a misleading zero', () => {
    expect(formatThreadCost(0)).toBe('US$ 0.00')
    expect(formatThreadCost(0.004)).toBe('US$ <0.01')
    expect(formatThreadCost(1.234)).toBe('US$ 1.23')
  })

  it('renders nothing without a cost and an estimate label with one', () => {
    const { container, rerender } = render(<ThreadCostChip />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ThreadCostChip cost={{ totalUsd: 0.42, turns: 3, lastTurnUsd: 0.1, updatedAt: 1, source: 'claude-result' }} />)
    const chip = screen.getByLabelText('Estimated cost US$ 0.42')
    expect(chip).toHaveTextContent('≈ US$ 0.42')
    expect(chip.getAttribute('title')).toMatch(/Not a charge/)
    expect(chip.getAttribute('title')).toMatch(/3 turns/)
  })
})
