import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { ReasoningStream, REASONING_MAX_CHARS } from '../electron/main/services/conversation/reasoning-stream'
import { reasoningLabel, ThreadReasoning } from '../src/components/Threads/ThreadReasoning'

afterEach(cleanup)

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

describe('reasoning stream', () => {
  it('re-emits the whole text at most every 500 ms and once more on completion', () => {
    let now = 1_000
    const events: Reasoning[] = []
    const stream = new ReasoningStream(event => events.push(event), () => now)
    stream.begin('r')
    stream.append('r', 'a')
    now += 100; stream.append('r', 'b')
    now += 500; stream.append('r', 'c')
    expect(events.map(event => event.text)).toEqual(['a', 'abc'])
    now += 2_000; stream.complete('r')
    expect(events.at(-1)).toEqual({ type: 'reasoning', id: 'r', text: 'abc', startedAt: 1_000, completedAt: 3_600 })
  })

  it('keeps the latest text within the cap, drops empty blocks and closes everything left open', () => {
    const events: Reasoning[] = []
    const stream = new ReasoningStream(event => events.push(event))
    stream.append('long', 'x'.repeat(REASONING_MAX_CHARS) + 'end')
    expect(events[0].text).toHaveLength(REASONING_MAX_CHARS)
    expect(events[0].text.endsWith('end')).toBe(true)
    stream.begin('empty')
    stream.completeAll()
    expect(events.filter(event => event.completedAt !== undefined).map(event => event.id)).toEqual(['long'])
    expect(stream.has('empty')).toBe(false)
  })
})

describe('reasoning block', () => {
  const event = (completedAt?: number): Reasoning => ({ type: 'reasoning', id: 'r', text: 'Checking the config.', startedAt: 0, ...(completedAt !== undefined ? { completedAt } : {}) })

  it('labels the time spent thinking', () => {
    expect(reasoningLabel(event(), true)).toBe('Thinking…')
    expect(reasoningLabel(event(12_400), false)).toBe('Thought for 12s')
    expect(reasoningLabel(event(83_000), false)).toBe('Thought for 1m 23s')
    expect(reasoningLabel(event(200), false)).toBe('Thought for 1s')
    expect(reasoningLabel(event(), false)).toBe('Thought')
  })

  it('is open while streaming, collapses when done, and keeps what the person chose', () => {
    const { rerender } = render(<ThreadReasoning event={event()} running />)
    const details = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    expect(details.open).toBe(true)
    rerender(<ThreadReasoning event={event(5_000)} running />)
    expect(details.open).toBe(false)
    expect(screen.getByText('Thought for 5s')).toBeInTheDocument()
    details.open = true
    fireEvent(details, new Event('toggle'))
    rerender(<ThreadReasoning event={{ ...event(5_000), text: 'More' }} running={false} />)
    expect(details.open).toBe(true)
  })
})
