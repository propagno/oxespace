import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActivityCenter } from '../src/components/Activity/ActivityCenter'

// Chunks that cannot load (an update replaced them on disk, a network drive went away): their imports reject.
vi.mock('../src/components/Activity/ActivityPanel', () => { throw new Error('chunk failed') })

describe('a lazy part that cannot load', () => {
  it('the activity panel says so inside the popover, with Try again, and the bell stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<ActivityCenter onSelectView={vi.fn()} />)
    await user.click(screen.getByTestId('activity-bell'))
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByTestId('activity-bell')).toBeInTheDocument()
  })
})
