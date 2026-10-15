import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThreadEventsPanel from '../src/components/Threads/ThreadEventsPanel'
import type { ThreadDebugPage, ThreadDebugRow } from '../shared/types/thread'

const row = (seq: number, fields: Partial<ThreadDebugRow> = {}): ThreadDebugRow => ({ seq, createdAt: 1_700_000_000_000 + seq * 1000, type: 'tool', label: `Bash step ${seq}`, payload: JSON.stringify({ seq }), ...fields })

afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as { oxe?: unknown }).oxe })

function install(debugEvents: (id: string, options?: { filter?: string; before?: number; limit?: number }) => Promise<ThreadDebugPage>) {
  ;(window as unknown as { oxe: unknown }).oxe = { thread: { debugEvents } }
}

describe('ThreadEventsPanel', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

  it('lists events, shows the detail of one and marks failures', async () => {
    install(async () => ({ rows: [row(1), row(2, { state: 'failed', exitCode: 1, durationMs: 1500, payload: '{\n  "output": "boom"\n}' })], matched: 2, hasMore: false, scanLimited: false }))
    render(<ThreadEventsPanel threadId="t" />)
    await screen.findByText('Bash step 2')
    expect(screen.getByText('2 of 2 matching events shown.')).toBeVisible()
    fireEvent.click(screen.getByText('Bash step 2'))
    expect(screen.getByRole('region', { name: 'Event detail' })).toHaveTextContent('"output": "boom"')
    expect(screen.getByText('failed · exit 1 · 1.5 s')).toBeVisible()
  })

  it('sends what is typed as the filter once it settles', async () => {
    const calls: Array<string | undefined> = []
    install(async (_id, options) => { calls.push(options?.filter); return { rows: [], matched: 0, hasMore: false, scanLimited: false } })
    render(<ThreadEventsPanel threadId="t" />)
    await waitFor(() => expect(calls).toEqual(['']))
    fireEvent.change(screen.getByLabelText('Filter events'), { target: { value: 'tool, !delta' } })
    await waitFor(() => expect(calls.at(-1)).toBe('tool, !delta'))
    expect(await screen.findByText('No event matches this filter.')).toBeVisible()
  })

  it('pages older events in ahead of the ones already shown', async () => {
    const seen: Array<number | undefined> = []
    install(async (_id, options) => {
      seen.push(options?.before)
      return options?.before === undefined
        ? { rows: [row(5), row(6)], matched: 4, hasMore: true, scanLimited: false }
        : { rows: [row(3), row(4)], matched: 2, hasMore: false, scanLimited: false }
    })
    render(<ThreadEventsPanel threadId="t" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load earlier events' }))
    await screen.findByText('Bash step 3')
    expect(seen).toEqual([undefined, 5])
    expect(screen.getAllByRole('button', { pressed: false }).map(button => button.textContent).filter(text => text?.includes('Bash step')).length).toBe(4)
    expect(screen.queryByRole('button', { name: 'Load earlier events' })).toBeNull()
  })

  it('says so when the build has no inspector', () => {
    ;(window as unknown as { oxe: unknown }).oxe = { thread: {} }
    render(<ThreadEventsPanel threadId="t" />)
    expect(screen.getByText('The event inspector is not available in this build.')).toBeVisible()
  })
})
