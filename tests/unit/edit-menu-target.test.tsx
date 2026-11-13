import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppMenuBar } from '../../src/components/Navigation/AppMenuBar'
import { editUnavailable, requestEdit, runPendingEdit, TERMINAL_SELECT_ALL_EVENT, watchEditTarget } from '../../src/components/Navigation/editTarget'

const edit = vi.fn(async () => true)
let stop: () => void

/** Focus on an element of the page, then on the menu bar's button, as opening a menu does. */
function focusThenMenu(element: HTMLElement): void {
  element.focus()
  const wrap = document.createElement('div')
  wrap.className = 'app-menubar-wrap'
  const button = document.createElement('button')
  wrap.append(button)
  document.body.append(wrap)
  button.focus()
}

function inBody<T extends HTMLElement>(element: T, parentClass?: string): T {
  const parent = document.createElement('div')
  if (parentClass) parent.className = parentClass
  parent.append(element)
  document.body.append(parent)
  return element
}

beforeEach(() => {
  document.body.innerHTML = ''
  edit.mockClear()
  ;(window as unknown as { oxe: unknown }).oxe = { clipboard: { edit } }
  stop = watchEditTarget()
})
afterEach(() => { stop(); delete (window as unknown as { oxe?: unknown }).oxe })

describe('the Edit menu acts where the person was before the menu took the focus', () => {
  it('pastes into the field: the focus goes back to it and the window runs the command natively', () => {
    const field = inBody(document.createElement('textarea'))
    focusThenMenu(field)
    expect(editUnavailable('paste')).toBeUndefined()
    requestEdit('paste')
    expect(runPendingEdit()).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(edit).toHaveBeenCalledWith('paste')
    // Nothing waits after it ran: a menu that closes later does not repeat it.
    expect(runPendingEdit()).toBe(false)
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('in a terminal: Paste and Copy run, Select all is the terminal\'s own, Undo says it cannot', () => {
    const helper = inBody(document.createElement('textarea'), 'xterm')
    const selectAll = vi.fn()
    helper.parentElement!.addEventListener(TERMINAL_SELECT_ALL_EVENT, selectAll)
    focusThenMenu(helper)
    expect(editUnavailable('undo')).toBe('Not available in a terminal')
    expect(editUnavailable('cut')).toBe('Not available in a terminal')
    expect(editUnavailable('paste')).toBeUndefined()
    requestEdit('selectAll')
    expect(runPendingEdit()).toBe(true)
    expect(selectAll).toHaveBeenCalledTimes(1)
    expect(edit).not.toHaveBeenCalled()
    requestEdit('paste')
    runPendingEdit()
    expect(edit).toHaveBeenCalledWith('paste')
  })

  it('in the code editor: Undo, Redo and Select all go through the editor\'s own keys', () => {
    const input = inBody(document.createElement('textarea'), 'monaco-editor')
    const keys: string[] = []
    input.parentElement!.addEventListener('keydown', event => keys.push(`${event.ctrlKey || event.metaKey ? 'Mod+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.key}`))
    focusThenMenu(input)
    for (const command of ['undo', 'redo', 'selectAll'] as const) { requestEdit(command); runPendingEdit() }
    expect(keys).toEqual(['Mod+z', 'Mod+Shift+z', 'Mod+a'])
    expect(edit).not.toHaveBeenCalled()
    requestEdit('copy')
    runPendingEdit()
    expect(edit).toHaveBeenCalledWith('copy')
  })

  it('in a read-only editor (the file viewer, a diff): Copy and Select all run, the rest say it is read only', () => {
    const host = document.createElement('div')
    host.setAttribute('data-read-only-editor', '')
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const input = document.createElement('textarea')
    editor.append(input); host.append(editor); document.body.append(host)
    const keys: string[] = []
    editor.addEventListener('keydown', event => keys.push(event.key))
    focusThenMenu(input)
    for (const command of ['undo', 'redo', 'cut', 'paste'] as const) {
      expect(editUnavailable(command)).toBe('This view is read only')
      requestEdit(command)
      expect(runPendingEdit()).toBe(false)
    }
    expect(edit).not.toHaveBeenCalled()
    expect(keys).toEqual([])
    requestEdit('selectAll'); runPendingEdit()
    expect(keys).toEqual(['a'])
    requestEdit('copy'); runPendingEdit()
    expect(edit).toHaveBeenCalledWith('copy')
  })

  it('with no text field: Copy still runs; Select all and the rest say what is missing and do nothing', () => {
    const button = inBody(document.createElement('button'))
    focusThenMenu(button)
    expect(editUnavailable('paste')).toBe('Place the cursor in a text field first')
    expect(editUnavailable('copy')).toBeUndefined()
    // It selected every text of the window (MENU-R2).
    expect(editUnavailable('selectAll')).toBe('Place the cursor in a text field first')
    requestEdit('selectAll')
    expect(runPendingEdit()).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    requestEdit('paste')
    expect(runPendingEdit()).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    requestEdit('copy')
    expect(runPendingEdit()).toBe(true)
    expect(edit).toHaveBeenCalledWith('copy')
  })

  it('from the menu bar: Edit > Paste lands in the field the person left, and the focus is back in it', async () => {
    const user = userEvent.setup()
    render(<><textarea aria-label="Message" /><AppMenuBar context={{ actions: [], applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn() }} /></>)
    const field = screen.getByLabelText('Message')
    await user.click(field)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(await screen.findByRole('menuitem', { name: /Paste/ }))
    await vi.waitFor(() => expect(edit).toHaveBeenCalledWith('paste'))
    expect(document.activeElement).toBe(field)
  })
})
