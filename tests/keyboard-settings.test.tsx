import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { KeyboardSettings } from '../src/components/Settings/KeyboardSettings'
import { ShortcutGuide } from '../src/components/Keyboard/ShortcutGuide'
import { formatChord } from '../src/keyboard/chords'
import { bindingsForView, chordsFor, type KeybindingId } from '../src/keyboard/keybindings'
import { useSettingsStore } from '../src/store/settings.store'
import { useUIStore } from '../src/store/ui.store'

afterEach(() => { useSettingsStore.setState({ keybindingOverrides: {} }); useUIStore.setState({ isSettingsOpen: false, settingsInitialPage: undefined }) })

const row = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-keybinding="${id}"]`)!

describe('Settings › Keyboard', () => {
  it('captures a new shortcut, persists it and warns about the conflict', async () => {
    render(<KeyboardSettings />)
    await userEvent.click(within(row('code.files')).getByRole('button', { name: 'Change shortcut for Files' }))
    expect(within(row('code.files')).getByText('Press the new shortcut, or Esc to cancel')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true })
    expect(useSettingsStore.getState().keybindingOverrides['code.files']).toEqual(['Mod+Shift+D'])
    expect(within(row('code.files')).getByText(/Also used by Changes \(OxeCode\)/)).toBeInTheDocument()
    expect(within(row('code.changes')).getByText(/Also used by Files \(OxeCode\)/)).toBeInTheDocument()

    await userEvent.click(within(row('code.files')).getByRole('button', { name: 'Reset shortcut for Files' }))
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({})
    expect(within(row('code.files')).queryByText(/Also used by/)).toBeNull()
  })

  it('cancels a capture with Escape and can turn a shortcut off', async () => {
    render(<KeyboardSettings />)
    await userEvent.click(within(row('sidebar.toggle')).getByRole('button', { name: 'Change shortcut for Toggle sidebar' }))
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({})
    await userEvent.click(within(row('sidebar.toggle')).getByRole('button', { name: 'Turn off shortcut for Toggle sidebar' }))
    expect(within(row('sidebar.toggle')).getByText('Not set')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset all shortcuts' }))
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({})
  })

  it('lists F6 as always on and the Tab focus toggle as rebindable (WCAG 2.1.2)', async () => {
    render(<KeyboardSettings />)
    for (const id of ['focus.nextRegion', 'focus.previousRegion']) {
      expect(within(row(id)).getByText('Always on')).toBeInTheDocument()
      expect(within(row(id)).queryByRole('button')).toBeNull()
    }
    await userEvent.click(within(row('terminal.tabMovesFocus')).getByRole('button', { name: 'Change shortcut for Tab moves focus in the terminal' }))
    fireEvent.keyDown(window, { key: 't', code: 'KeyT', ctrlKey: true, altKey: true })
    expect(chordsFor('terminal.tabMovesFocus')).toEqual(['Mod+Alt+T'])
  })
})

describe('shortcut guide', () => {
  it('shows exactly the registry shortcuts of the current view', () => {
    render(<ShortcutGuide view="thread" onClose={() => undefined} />)
    const guide = screen.getByTestId('shortcut-guide')
    const expected = bindingsForView('thread').flatMap(group => group.bindings)
    expect(within(guide).getAllByRole('listitem')).toHaveLength(expected.length)
    for (const binding of expected) {
      const item = within(guide).getByText(binding.label).closest('li')!
      for (const chord of chordsFor(binding.id as KeybindingId)) expect(within(item).getByLabelText(formatChord(chord))).toBeInTheDocument()
    }
    // Code-only shortcuts stay out of the Thread guide.
    expect(within(guide).queryByText('Split pane right')).toBeNull()
  })

  it('opens Settings › Keyboard to customize', async () => {
    render(<ShortcutGuide view="code" onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Customize shortcuts' }))
    expect(useUIStore.getState()).toMatchObject({ isSettingsOpen: true, settingsInitialPage: 'keyboard' })
  })
})
