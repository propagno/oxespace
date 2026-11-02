import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActivityCenter } from '../src/components/Activity/ActivityCenter'
import { VoiceHudSlot } from '../src/components/Voice/VoiceHudSlot'

// Chunks that cannot load (an update replaced them on disk, a network drive went away): their imports reject.
vi.mock('../src/components/Activity/ActivityPanel', () => { throw new Error('chunk failed') })
vi.mock('../src/components/Voice/VoiceHud', () => { throw new Error('chunk failed') })

describe('a lazy part that cannot load', () => {
  it('the activity panel says so inside the popover, with Try again, and the bell stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<ActivityCenter onSelectView={vi.fn()} />)
    await user.click(screen.getByTestId('activity-bell'))
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByTestId('activity-bell')).toBeInTheDocument()
  })

  it('the voice HUD shows nothing and the pane stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<div data-testid="pane"><VoiceHudSlot status="listening" error={null} level={0} modelProgress={null} onDismiss={vi.fn()} /></div>)
    await waitFor(() => expect(screen.getByTestId('pane')).toBeEmptyDOMElement())
  })
})
