import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceDelegationSettings } from '../../src/components/Workspace/WorkspaceDelegationSettings'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('delegation is opt-in and exposes explicit recovery without launching on mount', async () => {
  const status = { enabled: false, tasks: [{ id: 'task', workspaceId: 'ws', objective: 'Fix auth', state: 'failed', branch: 'oxe/auth', error: 'Agent unavailable', handoff: 'JWT HttpOnly' }] }
  const api = { status: vi.fn(async () => status), configure: vi.fn(async () => {}), control: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  vi.stubGlobal('oxe', { delegation: api })
  render(<WorkspaceDelegationSettings workspaceId="ws" />)
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Allow agents to delegate/ })).toBeEnabled())
  expect(screen.getByRole('checkbox', { name: /Allow agents to delegate/ })).not.toBeChecked()
  expect(api.configure).not.toHaveBeenCalled(); expect(api.control).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Agent unavailable')
  fireEvent.click(screen.getByRole('checkbox', { name: /Allow agents to delegate/ }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('ws', true))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry provisioning' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Retry provisioning' }))
  await waitFor(() => expect(api.control).toHaveBeenCalledWith('ws', 'task', 'retry'))
})
test('works without the optional preload API', () => {
  vi.stubGlobal('oxe', undefined)
  render(<WorkspaceDelegationSettings workspaceId="ws" />)
  expect(screen.getByRole('checkbox', { name: /Allow agents to delegate/ })).toBeDisabled()
})

test('terminal and diagnostics use the settings host navigation callbacks', async () => {
  const onOpenTerminal = vi.fn(), onOpenDiagnostics = vi.fn()
  vi.stubGlobal('oxe', {delegation: {status:vi.fn(async () => ({enabled:true,tasks:[{id:'task',workspaceId:'ws',paneId:'child',objective:'Fix auth',state:'failed',branch:'oxe/auth',error:'Launch failed'}]})),onChanged:vi.fn(() => () => {})}})
  render(<WorkspaceDelegationSettings workspaceId="ws" onOpenTerminal={onOpenTerminal} onOpenDiagnostics={onOpenDiagnostics} />)
  fireEvent.click(await screen.findByRole('button', {name:'Open terminal'}))
  expect(onOpenTerminal).toHaveBeenCalledWith('child')
  fireEvent.click(screen.getByRole('button', {name:'Open diagnostics and logs'}))
  expect(onOpenDiagnostics).toHaveBeenCalledOnce()
})

test('approving a delegated result is confirmed in a dialog, never one click', async () => {
  const api = { status: vi.fn(async () => ({ enabled: true, tasks: [{ id: 'task', workspaceId: 'ws', objective: 'Fix auth', state: 'review', branch: 'oxe/auth', handoff: 'h' }] })), control: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  vi.stubGlobal('oxe', { delegation: api })
  render(<WorkspaceDelegationSettings workspaceId="ws" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Approve result…' }))
  expect(api.control).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('dialog', { name: 'Approve this result?' })
  expect(dialog).toHaveTextContent('Fix auth')
  fireEvent.click(screen.getByRole('button', { name: 'Approve result' }))
  await waitFor(() => expect(api.control).toHaveBeenCalledWith('ws', 'task', 'approve'))
})
