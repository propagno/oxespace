import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CommandPalette } from '../../src/components/CommandPalette/CommandPalette'

describe('CommandPalette', () => {
  test('filters and runs commands', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()

    render(
      <CommandPalette
        onClose={onClose}
        actions={[
          { id: 'theme', title: 'Theme: Nord', run },
          { id: 'layout', title: 'Layout: 6 panes', run: vi.fn() }
        ]}
      />
    )

    await user.type(screen.getByPlaceholderText('Type a command'), 'nord')
    await user.click(screen.getByRole('button', { name: /Theme: Nord/i }))

    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
