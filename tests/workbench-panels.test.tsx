import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchPanelMenu, WorkbenchPanelToggle } from '../src/components/Workbench/WorkbenchPanelMenu'
import { CODE_BAR_PANELS, CODE_MENU_PANELS, THREAD_BAR_PANELS, THREAD_MENU_PANELS, WORKBENCH_PANELS } from '../src/components/Workbench/panelCatalog'
import { shortcutLabel } from '../src/keyboard/keybindings'

describe('Workbench panels shared by Code and Thread', () => {
  it('names each panel once, so both modes say Changes and Browser', () => {
    for (const id of CODE_BAR_PANELS) expect(THREAD_BAR_PANELS).toContain(id)
    expect(WORKBENCH_PANELS.changes.label).toBe('Changes')
    expect(shortcutLabel(WORKBENCH_PANELS.browser.keybinding)).toBe('Ctrl+Shift+B')
    expect(CODE_MENU_PANELS.filter(id => THREAD_MENU_PANELS.includes(id))).toEqual(['git', 'files', 'search', 'scripts'])
  })

  it('shows a bar toggle with its shortcut and pressed state', async () => {
    const onToggle = vi.fn()
    render(<WorkbenchPanelToggle className="toggle" item={{ id: 'changes', active: true, onToggle }} />)
    const button = screen.getByRole('button', { name: 'Changes' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Changes · Ctrl+Shift+D')
    await userEvent.setup().click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('lists the other panels as checkable items, open ones checked', async () => {
    const user = userEvent.setup()
    const onFiles = vi.fn()
    render(<WorkbenchPanelMenu items={[{ id: 'git', active: true, onToggle: vi.fn() }, { id: 'files', active: false, onToggle: onFiles }]} />)
    await user.click(screen.getByRole('button', { name: 'More panels' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Commit & pull request' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Files' }))
    expect(onFiles).toHaveBeenCalledOnce()
  })

  it('does not hide the rest of the app from assistive technology while open', async () => {
    const user = userEvent.setup()
    render(<><button type="button">Changes</button><WorkbenchPanelMenu items={[{ id: 'files', active: false, onToggle: vi.fn() }]} /></>)
    await user.click(screen.getByRole('button', { name: 'More panels' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Files' })).toBeVisible()
    expect(document.querySelector('[aria-hidden="true"] button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Changes' })).toBeVisible()
  })

  it('stays open when the app moves focus elsewhere, and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<><textarea aria-label="Terminal input" /><WorkbenchPanelMenu items={[{ id: 'files', active: false, onToggle: vi.fn() }]} /></>)
    await user.click(screen.getByRole('button', { name: 'More panels' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Files' })).toBeVisible()
    act(() => screen.getByRole('textbox', { name: 'Terminal input' }).focus())
    expect(screen.getByRole('menuitemcheckbox', { name: 'Files' })).toBeVisible()
    screen.getByRole('menuitemcheckbox', { name: 'Files' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Files' })).toBeNull()
  })
})
