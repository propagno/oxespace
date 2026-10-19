import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { adjacentPrompt, promptRowIndexes } from '../src/components/Threads/ThreadPromptNavigator'

const row = (event: Partial<ThreadEvent> & { type: ThreadEvent['type'] }) => ({ event: event as ThreadEvent })

describe('moving between prompts', () => {
  const rows = [
    row({ type: 'message', id: 'p1', role: 'user', text: 'one' }),
    row({ type: 'message', id: 'a1', role: 'assistant', text: 'x' }),
    row({ type: 'message', id: 'p2', role: 'user', text: 'two' }),
    row({ type: 'plan', id: 'plan', steps: [] }),
    row({ type: 'message', id: 'p3', role: 'user', text: 'three' })
  ]

  it('finds the rows that hold a prompt', () => {
    expect(promptRowIndexes(rows)).toEqual([0, 2, 4])
  })

  it('moves to the previous or next prompt from the one in view', () => {
    const prompts = promptRowIndexes(rows)
    expect(adjacentPrompt(prompts, 2, -1)).toBe(0)
    expect(adjacentPrompt(prompts, 2, 1)).toBe(4)
    expect(adjacentPrompt(prompts, 4, 1)).toBeUndefined()
    expect(adjacentPrompt(prompts, 0, -1)).toBeUndefined()
  })

  it('starts from the ends when no prompt is in view, and from the nearest one otherwise', () => {
    const prompts = promptRowIndexes(rows)
    expect(adjacentPrompt(prompts, undefined, -1)).toBe(4)
    expect(adjacentPrompt(prompts, undefined, 1)).toBe(0)
    expect(adjacentPrompt(prompts, 3, -1)).toBe(2)
    expect(adjacentPrompt(prompts, 3, 1)).toBe(4)
    expect(adjacentPrompt([], 0, 1)).toBeUndefined()
  })
})
