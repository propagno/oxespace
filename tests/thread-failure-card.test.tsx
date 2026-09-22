import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThreadFailureCard, ThreadUsageDetails, usageTime } from '../src/components/Threads/ThreadFailureCard'
import type { ThreadFailure } from '../shared/types/thread'

afterEach(cleanup)
const failure: ThreadFailure = { id: 'failure-A', occurredAt: 1790000000000, code: 'usage', message: 'Your session usage is exhausted.', detail: 'You have hit the session usage limit. Try again later.', providerCode: 'usageLimitExceeded', usage: { checkedAt: 1790000010000, windows: [{ label: 'Codex · Session · 5 hours', usedPercent: 100, resetsAt: 1790000500000 }, { label: 'Codex · Weekly', usedPercent: 62, resetsAt: 1790000600000 }] } }

describe('Thread failure card', () => {
  it('opens the latest failure with actual provider diagnostic and local reset times for each usage window', () => {
    const { container } = render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest />)
    expect(screen.getByText('Usage allowance exhausted').closest('details')).toHaveAttribute('open')
    expect(screen.getByLabelText('Provider diagnostic')).toHaveTextContent(failure.detail!)
    expect(screen.getByText('usageLimitExceeded')).toBeVisible()
    expect(screen.getByText('100% used')).toBeVisible()
    expect(screen.getByText('62% used')).toBeVisible()
    expect(screen.getByText(usageTime(1790000500000))).toHaveAttribute('datetime', new Date(1790000500000).toISOString())
    expect(container.querySelectorAll('progress')).toHaveLength(2)
    fireEvent.click(screen.getByText('Usage allowance exhausted'))
    expect(screen.getByText('Usage allowance exhausted').closest('details')).not.toHaveAttribute('open')
  })
  it('refreshes current usage through an integrated callback while retaining the original failure timestamp', async () => {
    const refresh = vi.fn(async () => ({ checkedAt: 1790000700000, windows: [{ label: 'Codex · Weekly', usedPercent: 80, resetsAt: 1790000900000 }] }))
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest refreshUsage={refresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    await waitFor(() => expect(screen.getByText('80% used')).toBeVisible())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(usageTime(failure.occurredAt))).toBeVisible()
    expect(screen.queryByText('100% used')).not.toBeInTheDocument()
  })
  it('explicitly reports unavailable resets and retains the diagnostic when refresh fails', async () => {
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure: { ...failure, usage: undefined, usageUnavailable: true } }} latest refreshUsage={vi.fn(async () => { throw Error('Offline') })} />)
    expect(screen.getByText(/Current usage could not be retrieved/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('provider has not confirmed a reset time')
    expect(screen.getByLabelText('Provider diagnostic')).toHaveTextContent(failure.detail!)
    expect(screen.queryByLabelText('Provider usage')).not.toBeInTheDocument()
  })
  it('supports old saved failures and missing reset fields without inventing information', () => {
    render(<><ThreadFailureCard event={{ type: 'completed', status: 'failed', error: 'Old failure' }} latest /><ThreadUsageDetails usage={{ checkedAt: 1790000000000, windows: [{ label: 'Primary window', usedPercent: 30 }] }} /></>)
    expect(screen.getByText('Old failure')).toBeVisible()
    expect(screen.getByText('Usage and reset time were not recorded for this failure.')).toBeVisible()
    expect(screen.getByText('Reset time not provided by the provider.')).toBeVisible()
  })
  it('offers retry only when the caller can replay the failed turn', () => {
    const retry = vi.fn()
    const { rerender } = render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry turn' }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest onRetry={retry} disabled />)
    expect(screen.getByRole('button', { name: 'Retry turn' })).toBeDisabled()
  })
})
