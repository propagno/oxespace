import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ThreadCommandDialog from '../src/components/Threads/ThreadCommandDialog'
import type { ThreadSnapshot } from '../shared/types/thread'
import { threadConfirmation } from '../shared/threadConfirmations'

const snapshot = { thread: { id: 't1', title: 'Old name', provider: 'claude', rootPath: '/repo', workspaceId: 'w1' }, events: [] } as unknown as ThreadSnapshot

function setup(panel: Parameters<typeof ThreadCommandDialog>[0]['panel']) {
  const runCommand = vi.fn(async () => {})
  const onClose = vi.fn()
  const action = vi.fn(async (run: () => Promise<unknown>) => { await run() })
  render(<ThreadCommandDialog panel={panel} snapshot={snapshot} pending={false} error="" onClose={onClose} onError={vi.fn()} action={action} runCommand={runCommand} />)
  return { runCommand, onClose }
}

describe('ThreadCommandDialog', () => {
  it('renames only after the name changes, with a real primary button', async () => {
    const user = userEvent.setup()
    const { runCommand, onClose } = setup({ kind: 'panel', surface: 'rename', title: 'Rename conversation' })
    const submit = screen.getByRole('button', { name: 'Rename conversation' })
    expect(submit).toBeDisabled()
    const field = screen.getByRole('textbox', { name: 'Conversation name' })
    await user.clear(field)
    await user.type(field, '  New name ')
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/rename New name'))
    expect(onClose).toHaveBeenCalled()
  })

  it('asks archive as a question, focused on Cancel, with the same words as the sidebar', async () => {
    const user = userEvent.setup()
    const { runCommand } = setup({ kind: 'confirm', confirm: threadConfirmation('archive') })
    const dialog = screen.getByRole('dialog', { name: 'Archive this conversation?' })
    expect(dialog).toHaveAccessibleDescription(/You can restore it from Archived in the sidebar or with \/resume/)
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Archive conversation' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('/archive confirm'))
  })

  it('marks delete and rewind as destructive', () => {
    setup({ kind: 'confirm', confirm: threadConfirmation('rewind') })
    expect(screen.getByRole('button', { name: 'Rewind one turn' }).className).toMatch(/danger/)
  })

  it('keeps command output copyable', () => {
    setup({ kind: 'panel', title: 'Project directory', text: '/repo' })
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeVisible()
  })
})
