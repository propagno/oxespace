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
  fireEvent.click(screen.getByRole('radio', { name: 'Nord' }))
  fireEvent.click(screen.getByRole('button', { name: /Project memory Shared knowledge/ }))
  expect(screen.getByRole('heading', { name: 'Shared Project Memory' })).toBeVisible()
  expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
  expect(screen.getByText('Memory changes use Apply memory settings above.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Terminal Text/ }))
  expect(screen.getByRole('radiogroup', { name: 'Default shell profile' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Appearance Theme/ }))
  expect(screen.getByRole('radio', { name: 'Nord' })).toHaveAttribute('aria-checked', 'true')
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save workspace settings' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'nord', workspaceId: 'ws' })))
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
