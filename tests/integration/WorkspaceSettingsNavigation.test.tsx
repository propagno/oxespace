import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceSettingsModal } from '../../src/components/Workspace/WorkspaceSettingsModal'
import type { Workspace, ShellProfile } from '../../shared/types/workspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'comfortable', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
const shells = [{ id: 'sh', name: 'Bash', executable: 'bash', args: [] }] as ShellProfile[]

test('navigation preserves appearance drafts and separates immediate settings from saved settings', async () => {
  vi.stubGlobal('oxe', undefined)
  const onSave = vi.fn(async () => {})
  const onClose = vi.fn()
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onSave={onSave} onClose={onClose} />)
  fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
  fireEvent.click(screen.getByRole('button', { name: /Project memory Shared knowledge/ }))
  expect(screen.getByRole('heading', { name: 'Shared Project Memory' })).toBeVisible()
  expect(screen.queryByRole('radiogroup', { name: 'Density' })).toBeNull()
  expect(screen.getByText('Memory changes use Apply memory settings above.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Terminal Text/ }))
  expect(screen.getByRole('radiogroup', { name: 'Default shell profile' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Appearance Mode/ }))
  expect(screen.getByRole('radio', { name: /Compact/ })).toHaveAttribute('aria-checked', 'true')
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save workspace settings' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ uiDensity: 'compact', workspaceId: 'ws' })))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('save failures keep the dialog and actionable error visible', async () => {
  vi.stubGlobal('oxe', undefined)
  const onClose = vi.fn()
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onClose={onClose} onSave={async () => { throw new Error('Could not save. Try again.') }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save workspace settings' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.'))
  expect(onClose).not.toHaveBeenCalled()
})

const memoryStatus = (featureEnabled?: boolean) => ({ projectId: 'p', sessions: [], settings: { enabled: false, automaticCapture: false, automaticContext: false },
  runtime: { mode: 'managed', executable: '', url: '' }, health: { status: 'disabled' }, ...(featureEnabled === undefined ? {} : { featureEnabled }) })

test('Shared Project Memory has no navigation entry and no page while the build has it off', async () => {
  const status = vi.fn(async () => memoryStatus(false))
  vi.stubGlobal('oxe', { memory: { status } })
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onSave={vi.fn(async () => {})} onClose={vi.fn()} />)
  await waitFor(() => expect(status).toHaveBeenCalledWith('ws'))
  expect(screen.queryByRole('button', { name: /Project memory/ })).toBeNull()
  expect(screen.queryByText('Shared Project Memory')).toBeNull()
  expect(screen.queryByText('Beta')).toBeNull()
  expect(screen.getByRole('button', { name: /Agent delegation/ })).toBeVisible()
})

test('Shared Project Memory shows when the build reports it on', async () => {
  vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => memoryStatus(true)) } })
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onSave={vi.fn(async () => {})} onClose={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Project memory Shared knowledge/ }))
  expect(await screen.findByRole('heading', { name: 'Shared Project Memory' })).toBeVisible()
})

test('a failed feature probe hides the memory page instead of guessing', async () => {
  vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => { throw new Error('boom') }) } })
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onSave={vi.fn(async () => {})} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /Agent delegation/ })).toBeVisible())
  expect(screen.queryByRole('button', { name: /Project memory/ })).toBeNull()
})
