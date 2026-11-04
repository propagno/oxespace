import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceSettingsModal } from '../../src/components/Workspace/WorkspaceSettingsModal'
import { Toaster } from '../../src/ui'
import type { Workspace, ShellProfile } from '../../shared/types/workspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'comfortable', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
const shells = [{ id: 'sh', name: 'Bash', executable: 'bash', args: [] }] as ShellProfile[]

test('each change applies at once, and navigation keeps what was applied', async () => {
  vi.stubGlobal('oxe', undefined)
  const onSave = vi.fn(async () => {})
  const onClose = vi.fn()
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onSave={onSave} onClose={onClose} />)
  fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ uiDensity: 'compact', workspaceId: 'ws' })))
  fireEvent.click(screen.getByRole('button', { name: /Project memory Shared knowledge/ }))
  expect(screen.getByRole('heading', { name: 'Shared Project Memory' })).toBeVisible()
  expect(screen.queryByRole('radiogroup', { name: 'Density' })).toBeNull()
  expect(screen.getByText('Memory changes use Apply memory settings above.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Terminal Text/ }))
  expect(screen.getByRole('radiogroup', { name: 'Default shell profile' })).toBeVisible()
  expect(screen.getByText('Terminal appearance and the default shell apply right away.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Appearance Mode/ }))
  expect(screen.getByRole('radio', { name: /Compact/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByRole('button', { name: 'Save workspace settings' })).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
})

test('a change that fails comes back, with an actionable error, and the dialog stays', async () => {
  vi.stubGlobal('oxe', undefined)
  const onClose = vi.fn()
  render(<WorkspaceSettingsModal workspace={workspace} shellProfiles={shells} onClose={onClose} onSave={async () => { throw new Error('Could not save. Try again.') }} />)
  fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.'))
  expect(screen.getByRole('radio', { name: /Compact/ })).toHaveAttribute('aria-checked', 'false')
  expect(onClose).not.toHaveBeenCalled()
})

test('the default shell is a risky change: it applies at once and its toast offers Undo', async () => {
  vi.stubGlobal('oxe', undefined)
  const onSave = vi.fn(async () => {})
  const twoShells = [...shells, { id: 'pwsh', name: 'PowerShell', executable: 'pwsh', args: [] }] as ShellProfile[]
  render(<><Toaster /><WorkspaceSettingsModal workspace={workspace} shellProfiles={twoShells} onSave={onSave} onClose={vi.fn()} /></>)
  fireEvent.click(screen.getByRole('button', { name: /Terminal Text/ }))
  fireEvent.click(screen.getByRole('radio', { name: /PowerShell/ }))
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ defaultShellProfileId: 'pwsh' })))
  expect(await screen.findByText('The default shell is now PowerShell')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ defaultShellProfileId: 'sh' })))
  expect(screen.getByRole('radio', { name: /Bash/ })).toBeChecked()
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
