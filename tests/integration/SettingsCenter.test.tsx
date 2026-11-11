import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SettingsCenter } from '../../src/components/Settings/SettingsCenter'
import type { Workspace } from '../../shared/types/workspace'
import { useUIStore } from '../../src/store/ui.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'comfortable', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
async function setup(onSave = vi.fn(async () => {})) {
  const onClose = vi.fn()
  render(<SettingsCenter workspaces={[workspace]} initialWorkspaceId="ws" shellProfiles={[]} onSave={onSave} onClose={onClose}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  // The pages are a lazy chunk; its first import, on a busy machine, can take longer than findBy's default second.
  await screen.findByRole('radio', { name: /Compact/ }, { timeout: 10_000 })
  return { onSave, onClose }
}
// U2 (S-01): workspace settings apply at once, so there is no draft to protect and no "Save your changes?" guard.
test('a workspace change applies at once and leaving needs no confirmation', async () => {
  const { onSave, onClose } = await setup()
  fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', uiDensity: 'compact', applyShellToIdlePanes: false })))
  expect(await screen.findByText('Workspace settings saved')).toHaveAttribute('role', 'status')
  // Only what changed: an unchanged layout sent along can rebuild the panes and their terminals.
  expect(onSave.mock.calls[0][0]).not.toHaveProperty('layoutPreset')
  expect(screen.queryByRole('button', { name: 'Save workspace settings' })).toBeNull()
  fireEvent.click(screen.getByRole('group', { name: 'Settings scope' }).querySelector('button')!)
  expect(screen.queryByRole('dialog', { name: 'Save your changes?' })).toBeNull()
  expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Back to work' }))
  expect(onClose).toHaveBeenCalled()
})

test('a change that fails to apply comes back and says why, without leaving', async () => {
  const { onClose } = await setup(vi.fn(async () => { throw new Error('Save failed') }))
  fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
  await waitFor(() => expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('Save failed'))
  expect(screen.getByRole('radio', { name: /Compact/ })).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('radio', { name: /Comfortable/ })).toHaveAttribute('aria-checked', 'true')
  expect(onClose).not.toHaveBeenCalled()
})

test('explicit initial page overrides the last visited workspace destination', async () => {
  localStorage.setItem('oxe.settings.destination', JSON.stringify({scope:'workspace',workspaceId:'ws',page:'delegation'}))
  render(<SettingsCenter initialPage="providers" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  expect(screen.getByRole('group', { name: 'Settings scope' }).querySelector('button')).toHaveAttribute('aria-pressed', 'true')
  expect(await screen.findByRole('heading', { name: 'Agents' })).toBeVisible()
  expect(screen.queryByRole('button', {name:/^Agents CLI discovery/})).toBeNull()
})

test('F34: Settings has no Voice page, and a link to it lands on the first page', async () => {
  const props = { workspaces: [workspace], shellProfiles: [], onSave: vi.fn(), onClose: vi.fn(), agentProfiles: [], agentReadiness: [], isDiscoveringAgents: false, onDiscoverAgents: vi.fn(), onConfigureAgent: vi.fn(), onNewCustomAgent: vi.fn() }
  const firstPageCurrent = async () => {
    const nav = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(within(nav).queryByRole('button', { name: /^(Voice|Voz)\b/ })).toBeNull()
    expect(within(nav).getByRole('button', { name: /^General/ })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('heading', { name: 'General' }, { timeout: 10_000 })).toBeVisible()
  }
  // An old deep link (palette entry, activity row) that still names the page.
  render(<SettingsCenter {...props} initialPage={'voice' as never} />)
  await firstPageCurrent()
  cleanup()
  // The destination remembered from a session that had the page.
  localStorage.setItem('oxe.settings.destination', JSON.stringify({ scope: 'application', page: 'voice' }))
  render(<SettingsCenter {...props} />)
  await firstPageCurrent()
})

test('Agents is a page of application settings, not only a first-run shortcut', async () => {
  render(<SettingsCenter initialPage="general" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Settings categories' })).getByRole('button', { name: /^Agents/ }))
  expect(await screen.findByRole('heading', { name: 'Agents' })).toBeVisible()
  expect(screen.getByTestId('btn-new-custom-agent')).toBeVisible()
})

test('workspace settings lists General, Projects and Policy after 1.5 removals', async () => {
  render(<SettingsCenter initialWorkspaceId="ws" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Settings categories' })
  expect(within(nav).getByRole('button', { name: /^General/ })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(within(nav).getByRole('button', { name: /^Projects/ }))
  expect(within(nav).getByRole('button', { name: /^Projects/ })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(within(nav).getByRole('button', { name: /^Policy/ }))
  expect(within(nav).getByRole('button', { name: /^Policy/ })).toHaveAttribute('aria-current', 'page')
})
