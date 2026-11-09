// Frozen acceptance test for 1.5.0 A70 (CR-33, from HML-F2-1, packaged pass run 42497300980; OXE program, phase F2, task
// FE-G7). Written by the planner; the executor must not edit it.
// The title bar's application menu (src/components/Navigation/AppMenuBar.tsx) set aria-hidden on <main> while <main> kept
// focusable controls: axe aria-hidden-focus, serious. Either fix holds here (a non-modal menu, or inert on the hidden
// siblings): what is checked is what axe and a keyboard user meet with the menu open, and how it closes.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppMenuBar } from '../../../src/components/Navigation/AppMenuBar'
import { MENU_ACTION_IDS } from '../../../src/components/Navigation/appMenus'

function renderShell() {
  const run = vi.fn()
  const actions = [...MENU_ACTION_IDS.map(id => ({ id, title: id, action: id, category: 'Test', run })),
    ...['system', 'light', 'dark'].map(mode => ({ id: `appearance-${mode}`, title: `Appearance: ${mode}`, action: mode, category: 'Appearance', run }))]
  const context = { actions, applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn(), version: '1.5.0' }
  render(<>
    <header><AppMenuBar context={context as never} /></header>
    <main><button type="button">Run the tests</button><a href="#changes">Changes</a><input aria-label="Find in files" /></main>
  </>)
  return { run }
}
const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Application menu' })
async function openMenu(): Promise<HTMLElement> {
  trigger().focus()
  await userEvent.keyboard('{Enter}')
  return screen.findByRole('menu')
}
const ariaHiddenFocus = async (): Promise<string[]> => {
  const results = await axe.run(document.body, { runOnly: { type: 'rule', values: ['aria-hidden-focus'] } })
  return results.violations.flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(' ')}`))
}

afterEach(() => { cleanup() })

describe('G7 · the application menu never hides focusable content from assistive tech', () => {
  test('with the menu open, axe finds no aria-hidden element that holds focusable controls', async () => {
    renderShell()
    await openMenu()
    expect(await ariaHiddenFocus()).toEqual([])
    // The page behind stays usable by assistive tech or is truly out of reach, never hidden-but-focusable.
    const main = document.querySelector('main') as HTMLElement
    expect(main.closest('[aria-hidden="true"]') === null || main.closest('[inert]') !== null).toBe(true)
  })

  test('Escape closes the menu and gives focus back to the menu button', async () => {
    renderShell()
    await openMenu()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger()).toHaveFocus()
    expect(document.querySelector('main')?.closest('[aria-hidden="true"], [inert]')).toBeNull()
  })

  test('a click outside closes the menu and leaves the page usable', async () => {
    renderShell()
    await openMenu()
    // A pointer press outside the menu, dispatched directly so either fix (non-modal, or inert siblings) is judged the
    // same: the menu listens for pointerdown outside itself.
    const outside = document.querySelector('main button') as HTMLElement
    fireEvent.pointerDown(outside, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(outside, { button: 0, pointerType: 'mouse' })
    fireEvent.click(outside)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.querySelector('main')?.closest('[aria-hidden="true"], [inert]')).toBeNull()
    expect(await ariaHiddenFocus()).toEqual([])
  })

  test('the arrow keys move through the menu items and Enter runs the highlighted one', async () => {
    const { run } = renderShell()
    const menu = await openMenu()
    await userEvent.keyboard('{ArrowDown}')
    const first = document.activeElement as HTMLElement
    expect(menu.contains(first)).toBe(true)
    expect(first.getAttribute('role')).toMatch(/^menuitem/)
    await userEvent.keyboard('{ArrowDown}')
    const second = document.activeElement as HTMLElement
    expect(second).not.toBe(first)
    expect(menu.contains(second)).toBe(true)
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(first)
    // Enter on a plain item runs it, or opens its submenu; either way the menu reacted to the keyboard.
    const before = run.mock.calls.length
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(run.mock.calls.length > before || screen.queryAllByRole('menu').length > 1 || screen.queryByRole('menu') === null).toBe(true))
  })
})
