import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '../src/components/Settings/AppearanceSettings'
import { useNavigationPrefs } from '../src/store/navigation-prefs.store'
import { useSettingsStore } from '../src/store/settings.store'
import { useWorkspaceStore } from '../src/store/workspace.store'
import type { Workspace } from '../shared/types/workspace'

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ workspaces: [] })
  delete (window as { oxe?: unknown }).oxe
  act(() => { useSettingsStore.getState().setUiScale(1); useSettingsStore.getState().setDensity('compact'); useNavigationPrefs.getState().setThreadDensity('comfortable') })
})

describe('AppearanceSettings', () => {
  it('shows only the mode inside workspace settings', () => {
    render(<AppearanceSettings />)
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible()
    expect(screen.queryByRole('radiogroup', { name: 'Interface scale' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Density' })).toBeNull()
  })

  it('sets the interface scale and the app-wide density', () => {
    render(<AppearanceSettings global />)
    expect(screen.getByRole('radio', { name: '100%' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: '125%' }))
    expect(useSettingsStore.getState().uiScale).toBe(1.25)
    expect(screen.getByText(/Currently 125%/)).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }))
    expect(useSettingsStore.getState().density).toBe('comfortable')
  })

  it('lets the Thread list go back to the app density', () => {
    render(<AppearanceSettings global />)
    expect(screen.getByTestId('thread-density-override')).toHaveTextContent('The Thread list uses its own density: Comfortable.')
    fireEvent.click(screen.getByRole('button', { name: 'Use app density in the Thread list' }))
    expect(useNavigationPrefs.getState().threadDensity).toBeNull()
    expect(screen.queryByTestId('thread-density-override')).toBeNull()
  })

  it('lets workspaces that kept their own density follow the app', async () => {
    const workspace = (id: string, uiDensity: Workspace['uiDensity']) => ({ id, name: id, uiDensity }) as Workspace
    useWorkspaceStore.setState({ workspaces: [workspace('a', 'compact'), workspace('b', 'comfortable'), workspace('c', 'default')] })
    const updateSettings = vi.fn(async (input: { workspaceId: string; uiDensity: string }) => ({ ...workspace(input.workspaceId, 'default') }))
    ;(window as unknown as { oxe: unknown }).oxe = { workspace: { updateSettings } }
    render(<AppearanceSettings global />)
    expect(screen.getByTestId('workspace-density-override')).toHaveTextContent('2 workspaces use their own density.')
    fireEvent.click(screen.getByRole('button', { name: 'Use app density in all workspaces' }))
    expect(updateSettings.mock.calls.map(([input]) => input)).toEqual([{ workspaceId: 'a', uiDensity: 'default' }, { workspaceId: 'b', uiDensity: 'default' }])
    expect(await screen.findByText('The Thread list uses its own density: Comfortable.')).toBeVisible()
    expect(screen.queryByTestId('workspace-density-override')).toBeNull()
  })
})
