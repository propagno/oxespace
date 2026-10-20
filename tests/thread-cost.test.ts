import { describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { addTurnCost, readClaudeResultCost, stepFromProcessTotal } from '../electron/main/services/conversation/thread-cost'
import { repairLegacyCost } from '../shared/threadCostRepair'
import { formatThreadCost } from '../src/components/Threads/threadCost'
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

describe('Claude adapter reports the cost of each turn, not the process total', () => {
  function fixture() {
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
    return { adapter, turns, events, result: (index: number, total: number) => turns[index].data(Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: total }) + '\n')) }
  }
  const usd = (events: ThreadEvent[]) => events.filter(event => event.type === 'turn-cost').map(event => (event as { usd?: number }).usd)

  it('turns a running process total into per-turn amounts', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, event => f.events.push(event))
    await f.adapter.send('one'); f.result(0, 0.5)
    await f.adapter.send('two'); f.result(0, 1.2)
    await f.adapter.send('three'); f.result(0, 2.0)
    expect(usd(f.events)).toEqual([0.5, 0.7, 0.8])
    await f.adapter.dispose()
  })

  it('counts a total that went down as a new process starting from zero', () => {
    expect(stepFromProcessTotal(2.0, 0.3)).toEqual({ turnUsd: 0.3, total: 0.3 })
    expect(stepFromProcessTotal(0, 0.5)).toEqual({ turnUsd: 0.5, total: 0.5 })
    expect(stepFromProcessTotal(1.2, 2.0).turnUsd).toBeCloseTo(0.8)
  })
})

describe('formatThreadCost', () => {
  it('formats small amounts without showing a misleading zero', () => {
    expect(formatThreadCost(0)).toBe('US$ 0.00')
    expect(formatThreadCost(0.004)).toBe('US$ <0.01')
    expect(formatThreadCost(1.234)).toBe('US$ 1.23')
  })
})

describe('repairLegacyCost', () => {
  it('replaces a sum of running totals by the last total, which is what the process had cost', () => {
    const legacy = { totalUsd: 25935.06, turns: 40, lastTurnUsd: 4.2, updatedAt: 1, source: 'claude-result' as const }
    expect(repairLegacyCost(legacy)).toMatchObject({ totalUsd: 4.2, source: 'claude-result-step', turns: 40 })
  })

  it('leaves reports written by the fixed code and Codex reports alone', () => {
    const fixed = { totalUsd: 3, turns: 3, lastTurnUsd: 1, updatedAt: 1, source: 'claude-result-step' as const }
    expect(repairLegacyCost(fixed)).toBe(fixed)
    expect(repairLegacyCost(undefined)).toBeUndefined()
  })
})
