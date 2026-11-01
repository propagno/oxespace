import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCodeCommands } from '../src/commands/code.commands'
import { AppMenuBar } from '../src/components/Navigation/AppMenuBar'
import type { CommandPaletteAction } from '../src/utils/commandRegistry'
import { useToasts } from '../src/ui/Toast'

const reason = 'Open a workspace to open its team'
const actions = (): CommandPaletteAction[] => buildCodeCommands({
  applicationView: 'code', activeWorkspace: null, activePane: null, hasTeamTarget: false, teamUnavailable: reason, toolHandlers: {},
  openNewWorkspace: vi.fn(), splitActivePane: vi.fn(), toggleActivePaneMaximize: vi.fn(), toggleActivePaneVoice: vi.fn(), openDesignSystem: vi.fn()
}).map(command => ({ id: command.id, title: command.label, subtitle: command.detail, disabled: command.disabled, shortcut: command.shortcut, run: command.run }))

beforeEach(() => { useToasts.setState({ items: [] }) })
afterEach(() => { cleanup() })

describe('Tools › Project team… where Team cannot open', () => {
  it('is reached by the keyboard, read with its reason, and says the reason again when chosen', async () => {
    const user = userEvent.setup()
    render(<AppMenuBar context={{ actions: actions(), applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn(), version: '1.4.0' }} />)
    screen.getByRole('button', { name: 'Application menu' }).focus()
    await user.keyboard('{Enter}')
    const tools = await screen.findByRole('menuitem', { name: 'Tools' })
    tools.focus()
    await user.keyboard('{ArrowRight}')
    const item = await screen.findByRole('menuitem', { name: /^Project team…/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).not.toHaveAttribute('data-disabled')
    expect(item).toHaveAttribute('aria-description', reason)
    expect(item).toHaveTextContent(reason)
    // Arrow keys stop on it: it is not skipped like a disabled item.
    while (document.activeElement !== item) {
      const before = document.activeElement
      await user.keyboard('{ArrowDown}')
      if (document.activeElement === before) break
    }
    expect(item).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(useToasts.getState().items).toEqual([expect.objectContaining({ title: 'Project team', description: reason, intent: 'info' })]))
  })
})
