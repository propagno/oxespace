import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsCenter } from '../../src/components/Settings/SettingsCenter'
import type { Workspace } from '../../shared/types/workspace'

afterEach(() => { cleanup(); localStorage.clear() })
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'comfortable', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
function setup(onSave = vi.fn(async () => {})) {
  const onClose = vi.fn()
  render(<SettingsCenter workspaces={[workspace]} initialWorkspaceId="ws" shellProfiles={[]} onSave={onSave} onClose={onClose}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  return { onSave, onClose }
}
test('scope navigation protects drafts and supports discard without saving', async () => {
  const { onSave } = setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Nord' }))
  fireEvent.change(screen.getByLabelText('Settings scope'), { target: { value: 'application' } })
  expect(screen.getByRole('dialog', { name: 'Save your changes?' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Stay', exact: true }))
  expect(screen.getByRole('radio', { name: 'Nord' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.change(screen.getByLabelText('Settings scope'), { target: { value: 'application' } })
  fireEvent.click(screen.getByRole('button', { name: 'Discard', exact: true }))
  expect(screen.getByRole('heading', { name: 'General' })).toBeVisible()
  expect(onSave).not.toHaveBeenCalled()
})
test('failed save does not leave the workspace or dismiss the guard', async () => {
  const { onClose } = setup(vi.fn(async () => { throw new Error('Save failed') }))
  fireEvent.click(screen.getByRole('radio', { name: 'Nord' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to work' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
  await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('Save failed'))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Save your changes?' })).toBeVisible()
})
