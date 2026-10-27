import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ThreadWorkPanel, { budgetLabel } from '../src/components/Threads/ThreadWorkPanel'
import ThreadUsagePanel, { usageLabel } from '../src/components/Threads/ThreadUsagePanel'
import type { WorkRun } from '../shared/types/work'
import type { ThreadUsageSummary } from '../shared/types/thread'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

const run = (fields: Partial<WorkRun> = {}): WorkRun => ({
  id: 'r1', supervisorThreadId: 'sup', projectRoot: '/p', title: 'Ship it', status: 'running', depth: 1, budget: { usd: 2 }, spent: { usd: 0.5, turns: 3 }, autoWake: true, createdAt: 1, updatedAt: 1,
  tasks: [
    { id: 't1', runId: 'r1', key: 'api', title: 'Survey the API', prompt: 'p', provider: 'claude', access: 'read-only', status: 'succeeded', dependsOn: [], threadId: 'w1', result: { summary: 'Three endpoints', verdict: 'completed', filesChanged: [], toolCalls: 2, failedToolCalls: 0 } },
    { id: 't2', runId: 'r1', key: 'build', title: 'Build it', prompt: 'p', provider: 'codex', access: 'workspace-write', status: 'blocked', dependsOn: ['api'], threadId: 'w2', reason: 'Waiting for an answer in the worker conversation' }
  ], ...fields
})

describe('ThreadWorkPanel', () => {
  it('labels spending against the budget', () => {
    expect(budgetLabel(run())).toBe('≈ US$ 0.50 of US$ 2.00 · 3 turns')
    expect(budgetLabel(run({ budget: { turns: 10 }, spent: { usd: 0, turns: 1 } }))).toBe('1 turn of 10')
  })

  it('lists tasks, opens a worker and cancels the run', async () => {
    const cancelWork = vi.fn(async () => run({ status: 'cancelled' }))
    const workRuns = vi.fn(async () => [run()])
    ;(window as { oxe?: unknown }).oxe = { thread: { workRuns, cancelWork } }
    const onOpenThread = vi.fn()
    render(<ThreadWorkPanel threadId="sup" onOpenThread={onOpenThread} />)
    expect(await screen.findByRole('region', { name: 'Run Ship it' })).toBeInTheDocument()
    expect(screen.getByText('Needs input')).toBeInTheDocument()
    expect(screen.getByText(/build · codex · can edit · after api/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1])
    expect(onOpenThread).toHaveBeenCalledWith('w2')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    await waitFor(() => expect(cancelWork).toHaveBeenCalledWith('sup', 'r1'))
  })

  it('explains Agent Work when there is none', async () => {
    ;(window as { oxe?: unknown }).oxe = { thread: { workRuns: vi.fn(async () => []) } }
    render(<ThreadWorkPanel threadId="sup" onOpenThread={vi.fn()} />)
    expect(await screen.findByText(/No Agent Work yet/)).toBeInTheDocument()
  })
})

describe('ThreadUsagePanel', () => {
  const bucket = (key: string, fields: Partial<ThreadUsageSummary['total']> = {}) => ({ key, label: key, turns: 2, pricedTurns: 2, usd: 1.5, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, ...fields })

  it('shows cost when priced and tokens otherwise', () => {
    expect(usageLabel(bucket('a'))).toBe('≈ US$ 1.50 · 2 turns · 2k tokens')
    expect(usageLabel(bucket('b', { pricedTurns: 0, usd: 0 }))).toBe('2 turns · 2k tokens')
    expect(usageLabel(bucket('c', { pricedTurns: 1 }))).toBe('≈ US$ 1.50 + unpriced turns · 2 turns · 2k tokens')
  })

  it('opens on this conversation and reloads for another scope', async () => {
    const summary: ThreadUsageSummary = { scope: 'project', since: 0, total: bucket('total'), byDay: [bucket('2026-10-13')], byModel: [bucket('claude · opus')], byThread: [bucket('Fix login')] }
    const usageSummary = vi.fn(async () => summary)
    ;(window as { oxe?: unknown }).oxe = { thread: { usageSummary } }
    render(<ThreadUsagePanel threadId="t" />)
    await waitFor(() => expect(usageSummary).toHaveBeenLastCalledWith('t', { scope: 'thread', days: 30 }))
    fireEvent.click(screen.getByRole('radio', { name: 'All projects' }))
    await waitFor(() => expect(usageSummary).toHaveBeenLastCalledWith('t', { scope: 'all', days: 30 }))
    expect(await screen.findByText('Fix login')).toBeInTheDocument()
  })

  it('lists the latest turns with the context they sent and their steps, and advises compacting a heavy conversation', async () => {
    const summary: ThreadUsageSummary = { scope: 'thread', since: 0, total: bucket('total'), byDay: [], byModel: [], byThread: [], turns: [
      { at: Date.UTC(2026, 9, 27, 12), contextTokens: 1_500_000, outputTokens: 4_000, steps: 9, usd: 2.5 },
      { at: Date.UTC(2026, 9, 27, 11), contextTokens: 40_000, outputTokens: 1_000 }
    ] }
    ;(window as { oxe?: unknown }).oxe = { thread: { usageSummary: vi.fn(async () => summary) } }
    render(<ThreadUsagePanel threadId="t" />)
    const rows = await screen.findAllByRole('row')
    expect(rows.slice(1).map(row => row.textContent)).toEqual([expect.stringContaining('1.5M94k≈ US$ 2.50'), expect.stringContaining('40k—1k—')])
    // 1.5M over 10 requests: 150k per request.
    expect(screen.getByRole('note')).toHaveTextContent('about 150k tokens of context')
  })
})
