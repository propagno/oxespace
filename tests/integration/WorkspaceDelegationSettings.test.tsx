import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceDelegationSettings } from '../../src/components/Workspace/WorkspaceDelegationSettings'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('delegation is opt-in and exposes explicit recovery without launching on mount', async () => {
  const status = { enabled: false, tasks: [{ id: 'task', objective: 'Fix auth', state: 'failed', branch: 'oxe/auth', error: 'Agent unavailable', handoff: 'JWT HttpOnly' }] }
  const api = { status: vi.fn(async () => status), configure: vi.fn(async () => {}), control: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  vi.stubGlobal('oxe', { delegation: api })
  render(<WorkspaceDelegationSettings workspaceId="ws" />)
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(api.configure).not.toHaveBeenCalled(); expect(api.control).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Agent unavailable')
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('ws', true))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(api.control).toHaveBeenCalledWith('ws', 'task', 'retry'))
})
test('works without the optional preload API', () => {
  vi.stubGlobal('oxe', undefined)
  render(<WorkspaceDelegationSettings workspaceId="ws" />)
  expect(screen.getByRole('checkbox')).toBeDisabled()
})
