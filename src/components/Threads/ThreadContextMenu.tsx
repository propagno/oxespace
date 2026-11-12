import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditCommand } from '../../../shared/types/ipc'
import { AnchoredMenu, type MenuEntry } from '../../ui'

/**
 * The right-click menu of a conversation: in a text field the editing commands, on selected text Copy and Quote, on a
 * message its own Copy and Quote. A right-click that something else already answers (a file path, a conversation row)
 * is left to it, and anywhere else nothing opens.
 */
type Target =
  | { kind: 'field'; field: HTMLElement; hasSelection: boolean; canEdit: boolean }
  | { kind: 'selection'; text: string }
  | { kind: 'message'; text: string; copy: HTMLButtonElement | null; quote: HTMLButtonElement | null }

interface Open { x: number; y: number; target: Target }

const FIELD = 'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]'
/** Where a conversation's messages are; a right-click in the chrome around them opens nothing. */
const MESSAGE = '.thread-timeline [class*="thread-message"]'

function fieldSelection(field: HTMLElement): boolean {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) { try { return (field.selectionEnd ?? 0) > (field.selectionStart ?? 0) } catch { return false } }
  return Boolean(window.getSelection()?.toString())
}

/** Through main, which can paste; the page's own command when main is not there (it cuts, copies and selects in a focused field). */
function runEdit(field: HTMLElement, command: EditCommand): void {
  field.focus()
  const native = window.oxe?.clipboard?.edit
  if (native) void native(command).then(done => { if (!done) document.execCommand(command) }, () => { document.execCommand(command) })
  else document.execCommand(command)
}

export function ThreadContextMenu({ onQuote }: { onQuote: (text: string) => void }): ReactElement {
  const { t } = useTranslation('thread')
  const { t: tc } = useTranslation()
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState<Open | null>(null)
  /** Chosen in the menu; it runs once the menu closed and gave the focus back to the field. */
  const pending = useRef<(() => void) | null>(null)

  useEffect(() => {
    const view = anchor.current?.closest('.thread-view')
    if (!view) return
    const onContextMenu = (event: Event): void => {
      const mouse = event as MouseEvent
      if (mouse.defaultPrevented || !(mouse.target instanceof Element)) return
      const field = mouse.target.closest<HTMLElement>(FIELD)
      const selected = window.getSelection()?.toString().trim() ?? ''
      const message = mouse.target.closest<HTMLElement>(MESSAGE)
      let target: Target | null = null
      if (field) target = { kind: 'field', field, hasSelection: fieldSelection(field), canEdit: !(field as HTMLTextAreaElement).readOnly && !(field as HTMLTextAreaElement).disabled }
      else if (selected && mouse.target.closest('.thread-timeline')) target = { kind: 'selection', text: selected }
      else if (message) {
        const actions = message.querySelectorAll<HTMLButtonElement>('.thread-message-actions button')
        const body = message.querySelector<HTMLElement>('.thread-markdown, .thread-long-prompt-preview') ?? message
        const text = (body.innerText ?? body.textContent ?? '').trim()
        if (text) target = { kind: 'message', text, quote: actions[0] ?? null, copy: actions[1] ?? null }
      }
      if (!target) return
      mouse.preventDefault()
      setOpen({ x: mouse.clientX, y: mouse.clientY, target })
    }
    view.addEventListener('contextmenu', onContextMenu)
    return () => view.removeEventListener('contextmenu', onContextMenu)
  }, [])

  const target = open?.target
  const copyText = (text: string): void => { void window.oxe.clipboard.writeText(text).catch(() => undefined) }
  const edit = (command: EditCommand): (() => void) => () => { if (target?.kind === 'field') { const field = target.field; pending.current = () => runEdit(field, command) } }
  const items: MenuEntry[] = !target ? []
    : target.kind === 'field' ? [
        { label: tc('menu.cut'), shortcut: 'Ctrl+X', disabled: !target.canEdit || !target.hasSelection, onSelect: edit('cut') },
        { label: tc('menu.copy'), shortcut: 'Ctrl+C', disabled: !target.hasSelection, onSelect: edit('copy') },
        { label: tc('menu.paste'), shortcut: 'Ctrl+V', disabled: !target.canEdit, onSelect: edit('paste') },
        { type: 'separator' },
        { label: tc('menu.selectAll'), shortcut: 'Ctrl+A', onSelect: edit('selectAll') }
      ]
    : target.kind === 'selection' ? [
        { label: t('contextMenu.copySelection'), shortcut: 'Ctrl+C', onSelect: () => copyText(target.text) },
        { label: t('contextMenu.quoteSelection'), onSelect: () => onQuote(target.text) }
      ]
    : [
        // The row's own actions when it has them: they copy and quote what the agent wrote, marks included.
        { label: t('contextMenu.copyMessage'), onSelect: () => { if (target.copy) target.copy.click(); else copyText(target.text) } },
        { label: t('contextMenu.quoteMessage'), onSelect: () => { if (target.quote) target.quote.click(); else onQuote(target.text) } }
      ]

  return <span ref={anchor} className="thread-context-menu-anchor" style={{ position: 'fixed', left: open?.x ?? 0, top: open?.y ?? 0, width: 0, height: 0 }}>
    <AnchoredMenu open={open !== null} label={t('contextMenu.label')} items={items}
      returnFocus={() => (target?.kind === 'field' ? target.field : null)}
      onOpenChange={next => {
        if (next) return
        setOpen(null)
        const run = pending.current
        pending.current = null
        // After the menu gave the focus back: the command acts on the field, not on the menu item that was chosen.
        if (run) requestAnimationFrame(run)
      }} />
  </span>
}
