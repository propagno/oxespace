import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import { i18n } from '../../i18n'
import { AnchoredMenu, type MenuEntry } from '../../ui'

/** The part of xterm's Terminal the menu uses (xterm's Terminal satisfies it). */
export interface TerminalLike {
  hasSelection(): boolean
  getSelection(): string
  selectAll(): void
  clear(): void
  paste(text: string): void
  focus(): void
}

const t = (key: string): string => (i18n.t as unknown as (key: string, options: object) => string)(key, { ns: 'code' })

async function writeClipboard(text: string): Promise<void> {
  // Main's clipboard first (no renderer permission), then the web API, as the terminal's own copy does.
  const ok = await window.oxe?.clipboard?.writeText(text).catch(() => false)
  if (!ok) await navigator.clipboard?.writeText(text).catch(() => undefined)
}

async function readClipboard(): Promise<string> {
  let text = await window.oxe?.clipboard?.readText().catch(() => '') ?? ''
  if (!text) text = await navigator.clipboard?.readText().catch(() => '') ?? ''
  return text
}

function TerminalMenu({ point, items, onClose, returnFocus }: {
  point: { x: number; y: number }; items: MenuEntry[]; onClose(): void; returnFocus(): HTMLElement | null
}): ReactElement {
  return <span style={{ position: 'fixed', left: point.x, top: point.y, width: 0, height: 0 }}>
    <AnchoredMenu open onOpenChange={open => { if (!open) onClose() }} side="bottom" label={t('terminal.menu.label')} returnFocus={returnFocus} items={items} />
  </span>
}

/** The menu's items, in order: Copy (only with a selection), Paste, Select all, Clear. */
export function terminalContextMenu(terminal: TerminalLike, selection: string): MenuEntry[] {
  return [
    { label: t('terminal.menu.copy'), disabled: selection.length === 0, onSelect: () => { if (selection) void writeClipboard(selection) } },
    { label: t('terminal.menu.paste'), onSelect: () => { void readClipboard().then(text => { if (text) terminal.paste(text); terminal.focus() }) } },
    { label: t('terminal.menu.selectAll'), onSelect: () => { terminal.selectAll() } },
    { label: t('terminal.menu.clear'), onSelect: () => { terminal.clear() } }
  ]
}

/**
 * CODE-8 · the terminal's own right-click menu: Copy, Paste, Select all, Clear. A right click, Shift+F10 or the
 * context-menu key all raise `contextmenu`; one the path menu already took (defaultPrevented, propagation stopped) opens
 * nothing here. The listener sits on the document so it runs after every listener on the host, whatever order they
 * were added in (the path menu attaches after a lazy import). On close the keyboard goes back to the terminal.
 */
export function attachTerminalContextMenu(host: HTMLElement, terminal: TerminalLike): { dispose(): void } {
  const doc = host.ownerDocument
  let mount: HTMLDivElement | null = null
  let root: Root | null = null
  const returnFocus = (): HTMLElement | null => {
    terminal.focus()
    return host.querySelector<HTMLElement>('.xterm-helper-textarea')
  }
  const close = (): void => { root?.render(null); terminal.focus() }

  const onContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    if (!(event.target instanceof Node) || !host.contains(event.target)) return
    event.preventDefault()
    const rect = host.getBoundingClientRect()
    const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom }
    const selection = terminal.hasSelection() ? terminal.getSelection() : ''
    const items = terminalContextMenu(terminal, selection)
    if (!root) { mount = doc.createElement('div'); doc.body.append(mount); root = createRoot(mount) }
    // A new key per opening: a menu opened again where it stands starts fresh.
    root.render(<TerminalMenu key={Date.now()} point={point} items={items} onClose={close} returnFocus={returnFocus} />)
  }

  doc.addEventListener('contextmenu', onContextMenu)
  return {
    dispose: () => {
      doc.removeEventListener('contextmenu', onContextMenu)
      const done = root, node = mount
      root = null
      mount = null
      // Unmounting during a render warns: let the current one finish.
      queueMicrotask(() => { done?.unmount(); node?.remove() })
    }
  }
}
