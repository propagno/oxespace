import { i18n } from '../../i18n'
import type { EditCommand } from '../../../shared/types/ipc'

/**
 * The Edit menu acts on the place the person was in before the menu took the focus. A menu item has the focus while it
 * is chosen, so a command run from there reached nothing: Paste did nothing anywhere (the window has no permission for
 * the page's own paste command) and Select all selected the page around a field.
 *
 * The last focused element outside the menus is remembered; when the menu closes the focus goes back to it and the
 * command runs there: natively through main for a field, with the editor's and the terminal's own commands for those.
 */
type Place = 'field' | 'editor' | 'terminal' | 'page'

/** Asks a terminal to select everything it shows; it listens on its own host element. */
export const TERMINAL_SELECT_ALL_EVENT = 'oxe:terminal-select-all'

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])
let target: HTMLElement | null = null
let pending: EditCommand | null = null

const inMenu = (element: Element): boolean => Boolean(element.closest('.app-menubar-wrap, .app-menu-content'))
const current = (): HTMLElement | null => target?.isConnected ? target : null

function place(element: HTMLElement | null): Place {
  if (!element) return 'page'
  if (element.closest('.xterm')) return 'terminal'
  if (element.closest('.monaco-editor')) return 'editor'
  if (element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && TEXT_INPUTS.has(element.type))) return element.readOnly || element.disabled ? 'page' : 'field'
  return element.isContentEditable ? 'field' : 'page'
}

/** Remembers the last place with focus outside the menus. Returns the function that stops it. */
export function watchEditTarget(): () => void {
  const remember = (element: Element | null): void => { if (element instanceof HTMLElement && element !== document.body && !inMenu(element)) target = element }
  const onFocus = (event: FocusEvent): void => remember(event.target instanceof Element ? event.target : null)
  remember(document.activeElement)
  document.addEventListener('focusin', onFocus)
  return () => document.removeEventListener('focusin', onFocus)
}

/** Why a command cannot act where the person was, or undefined when it can. Copy and Select all always can. */
export function editUnavailable(command: EditCommand): string | undefined {
  const where = place(current())
  if (where === 'field' || where === 'editor' || command === 'copy' || command === 'selectAll') return undefined
  if (where === 'terminal') return command === 'paste' ? undefined : i18n.t('menu.notInTerminal')
  return i18n.t('menu.needsTextField')
}

/** Chosen in the menu; it runs once the menu closed and gave the focus back (runPendingEdit). */
export function requestEdit(command: EditCommand): void { pending = command }

/** The editor runs these from its own key bindings, which also keep its undo history. */
function editorKey(element: HTMLElement, command: 'undo' | 'redo' | 'selectAll'): void {
  const mac = navigator.platform.toLowerCase().includes('mac')
  const letter = command === 'selectAll' ? 'a' : 'z'
  element.dispatchEvent(new KeyboardEvent('keydown', {
    key: letter, code: `Key${letter.toUpperCase()}`, keyCode: letter.toUpperCase().charCodeAt(0), ctrlKey: !mac, metaKey: mac, shiftKey: command === 'redo', bubbles: true, cancelable: true
  } as KeyboardEventInit))
}

/**
 * Runs the command waiting for the menu to close. True when the focus went back to where the person was, so the menu
 * must not take it to its own button.
 */
export function runPendingEdit(): boolean {
  const command = pending
  pending = null
  if (!command) return false
  const element = current()
  if (editUnavailable(command)) return false
  element?.focus()
  const where = place(element)
  if (element && where === 'terminal' && command === 'selectAll') element.dispatchEvent(new CustomEvent(TERMINAL_SELECT_ALL_EVENT, { bubbles: true }))
  else if (element && where === 'editor' && (command === 'undo' || command === 'redo' || command === 'selectAll')) editorKey(element, command)
  else {
    const native = window.oxe?.clipboard?.edit
    // The page's own command is what is left without main: it cannot paste, the rest works in a focused field.
    if (native) void native(command).then(done => { if (!done) document.execCommand(command) }, () => { document.execCommand(command) })
    else document.execCommand(command)
  }
  return element !== null
}
