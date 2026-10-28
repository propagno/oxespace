import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppearanceSettings } from '../src/components/Settings/AppearanceSettings'
import { useNavigationPrefs } from '../src/store/navigation-prefs.store'
import { useSettingsStore } from '../src/store/settings.store'

afterEach(() => {
  cleanup()
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
    fireEvent.click(screen.getByRole('button', { name: 'Follow app density' }))
    expect(useNavigationPrefs.getState().threadDensity).toBeNull()
    expect(screen.queryByTestId('thread-density-override')).toBeNull()
  })
})
