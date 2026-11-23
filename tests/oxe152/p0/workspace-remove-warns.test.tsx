// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A8). Written by the planner; the executor must not edit it.
// Remove workspace says how many of ITS agents and terminals are running and will be stopped (a role=alert inside the
// confirmation, plural by count); with none running the confirmation is as before.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceGroup } from '../../../src/components/Sidebar/WorkspaceGroup'
import { useTerminalStore } from '../../../src/store/terminal.store'

const pane = (id: string, agentName: string | null) => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'sh', status: 'idle', agentProfileId: null, agentName, displayName: null, rootPath: null })
const workspace = { id: 'ws-1', name: 'api', rootPath: '/work/api', color: null, panes: [pane('p1', 'Claude'), pane('p2', null), pane('p3', null)] } as never
const entry = (status: string) => ({ status, error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false })

afterEach(() => { cleanup(); useTerminalStore.setState({ panes: {} } as never) })

const confirmation = (): Promise<HTMLElement> => vi.waitFor(() => {
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')
  expect(dialog, 'the confirmation is open').not.toBeNull()
  return dialog!
})

async function removeDialog(onClose = vi.fn()): Promise<HTMLElement> {
  render(<WorkspaceGroup workspace={workspace} isActive={false} onSelect={vi.fn()} onClose={onClose} />)
  fireEvent.click(screen.getByTestId('ws-group-settings-btn'))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove workspace' }))
  return confirmation()
}

describe('OXE-367 · removing a workspace that is working', () => {
  test('the confirmation warns that the two running agents or terminals will stop, and nothing is removed before confirming', async () => {
    useTerminalStore.setState({ panes: { p1: entry('running'), p2: entry('starting'), p3: entry('idle'), other: entry('running') } } as never)
    const onClose = vi.fn()
    const dialog = await removeDialog(onClose)
    expect(within(dialog).queryByRole('alert'), 'an explicit warning').not.toBeNull()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/\b2\b/)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('with nothing running there is no warning', async () => {
    useTerminalStore.setState({ panes: { p1: entry('idle'), other: entry('running') } } as never)
    expect(within(await removeDialog()).queryByRole('alert')).toBeNull()
  })
})
