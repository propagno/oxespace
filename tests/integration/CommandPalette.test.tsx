import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CommandPalette } from '../../src/components/CommandPalette/CommandPalette'

describe('CommandPalette', () => {
  beforeEach(() => {
    // Wave 4 added a localStorage-backed "Recents" list; clear it between runs
    // so each test starts from a clean state.
    localStorage.clear()
  })

  test('filters and runs commands', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()

    render(
      <CommandPalette
        onClose={onClose}
        actions={[
          { id: 'theme', title: 'Theme: Nord', category: 'Theme', run },
          { id: 'layout', title: 'Layout: 6 panes', category: 'Layout', run: vi.fn() }
        ]}
      />
    )

    await user.type(screen.getByLabelText('Command palette search'), 'nord')
    await user.click(screen.getByRole('option', { name: /Theme: Nord/i }))

    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('fuzzy match ranks exact > prefix > substring', async () => {
    const user = userEvent.setup()
    render(
      <CommandPalette
        onClose={vi.fn()}
        actions={[
          { id: 'a', title: 'Layout: 6 panes', category: 'Layout', run: vi.fn() },
          { id: 'b', title: 'Theme: Dracula', category: 'Theme', run: vi.fn() },
          { id: 'c', title: 'Open History', category: 'AI', keywords: ['theme'], run: vi.fn() }
        ]}
      />
    )

    await user.type(screen.getByLabelText('Command palette search'), 'theme')
    // First option visually = highest score; "Theme: Dracula" (prefix) outranks
    // the keyword-match "Open History".
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Theme: Dracula')
  })

  test('ArrowDown + Enter runs the highlighted command', async () => {
    const user = userEvent.setup()
    const runSecond = vi.fn()

    render(
      <CommandPalette
        onClose={vi.fn()}
        actions={[
          { id: 'a', title: 'First', category: 'X', run: vi.fn() },
          { id: 'b', title: 'Second', category: 'X', run: runSecond }
        ]}
      />
    )

    const input = screen.getByLabelText('Command palette search')
    input.focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(runSecond).toHaveBeenCalled()
  })

  test('shows Recent group when there are persisted recents and query is empty', () => {
    localStorage.setItem('oxe.commandPalette.recents', JSON.stringify(['b']))
    render(
      <CommandPalette
        onClose={vi.fn()}
        actions={[
          { id: 'a', title: 'First', category: 'X', run: vi.fn() },
          { id: 'b', title: 'Second', category: 'X', run: vi.fn() }
        ]}
      />
    )
    expect(screen.getByText('Recent')).toBeInTheDocument()
    // The first item in flat order should be the recent one ("Second").
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Second')
  })
})
