import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Skeleton } from '../src/ui'

/** motion.md rule 3, inner placeholders included (DESIGN on #363): a delayed skeleton never shows before its time. */
describe('Skeleton delay', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('shows nothing until the delay, then the placeholder', () => {
    render(<Skeleton lines={4} label="Loading requests" delay={300} />)
    expect(screen.queryByRole('status', { name: 'Loading requests' })).toBeNull()
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.queryByRole('status', { name: 'Loading requests' })).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('status', { name: 'Loading requests' })).toBeInTheDocument()
  })

  it('content that arrives before the delay never shows a placeholder', () => {
    const { rerender } = render(<div>{<Skeleton label="Loading requests" delay={300} />}</div>)
    act(() => { vi.advanceTimersByTime(120) })
    rerender(<div>Requests</div>)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('status', { name: 'Loading requests' })).toBeNull()
    expect(screen.getByText('Requests')).toBeVisible()
  })

  it('without a delay it shows at once, as before', () => {
    render(<Skeleton label="Loading requests" />)
    expect(screen.getByRole('status', { name: 'Loading requests' })).toBeInTheDocument()
  })
})
