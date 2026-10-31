import { ArrowLeft, ArrowRight, Pin, PinOff, X, XSquare } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { EditorTab } from '../../store/editor.store'

interface EditorTabsProps {
  tabs: EditorTab[]
  activePath: string | null
  dirtyPaths: ReadonlySet<string>
  onActivate: (relativePath: string) => void
  onClose: (relativePath: string) => void
  onCloseOthers: (relativePath: string) => void
  onTogglePin: (relativePath: string) => void
  onMove: (fromPath: string, toPath: string) => void
}

/**
 * Editor tab strip: click to activate, middle-click to close, drag to reorder, right-click for tab actions. Reordering
 * never needs a drag (WCAG 2.5.7): the tab's menu moves it left or right.
 */
export function EditorTabs({
  activePath,
  dirtyPaths,
  onActivate,
  onClose,
  onCloseOthers,
  onMove,
  onTogglePin,
  tabs
}: EditorTabsProps): ReactElement | null {
  const { t } = useTranslation('code')
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // The menu closes on any outside press, Escape or a scroll of the strip, and starts with focus on its first item.
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Node && menuRef.current?.contains(event.target) && !(event instanceof KeyboardEvent)) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // The strip scrolls horizontally in a narrow panel, so the active tab has to
  // be pulled into view — otherwise opening a file appears to do nothing.
  useEffect(() => {
    if (!activePath) return
    const selector = `[data-testid="editor-tab-${CSS.escape(activePath)}"]`
    const tab = stripRef.current?.querySelector(selector)
    // jsdom (and older engines) do not implement scrollIntoView.
    if (typeof tab?.scrollIntoView === 'function') tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath, tabs])

  if (tabs.length === 0) return null

  return (
    <div ref={stripRef} className="editor-tabs scrollbar-sleek" role="tablist" aria-label={t('editor.tabs.label')} data-testid="editor-tabs">
      {tabs.map((tab) => {
        const isActive = tab.relativePath === activePath
        const isDirty = dirtyPaths.has(tab.relativePath)
        return (
          <div
            key={tab.relativePath}
            role="tab"
            aria-selected={isActive}
            aria-keyshortcuts="Delete"
            tabIndex={isActive ? 0 : -1}
            title={tab.relativePath}
            draggable
            className={[
              'editor-tab',
              isActive ? 'active' : '',
              tab.pinned ? 'pinned' : '',
              dropPath === tab.relativePath ? 'drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`editor-tab-${tab.relativePath}`}
            onClick={() => onActivate(tab.relativePath)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onActivate(tab.relativePath)
              } else if (event.key === 'Delete') {
                event.preventDefault()
                onClose(tab.relativePath)
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.relativePath)
              }
            }}
            onDoubleClick={() => onTogglePin(tab.relativePath)}
            onContextMenu={(event) => {
              event.preventDefault()
              // A keyboard-opened menu (Shift+F10) has no pointer position: anchor it under the tab.
              const box = event.currentTarget.getBoundingClientRect()
              setMenu({ path: tab.relativePath, x: event.clientX || box.left, y: event.clientY || box.bottom })
            }}
            onDragStart={(event) => {
              setDraggingPath(tab.relativePath)
              event.dataTransfer.effectAllowed = 'move'
              // Keep the existing "drag a file into a terminal" contract working.
              event.dataTransfer.setData('text/plain', tab.relativePath)
            }}
            onDragOver={(event) => {
              if (!draggingPath || draggingPath === tab.relativePath) return
              event.preventDefault()
              setDropPath(tab.relativePath)
            }}
            onDragLeave={() => setDropPath((current) => (current === tab.relativePath ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingPath && draggingPath !== tab.relativePath) onMove(draggingPath, tab.relativePath)
              setDraggingPath(null)
              setDropPath(null)
            }}
            onDragEnd={() => {
              setDraggingPath(null)
              setDropPath(null)
            }}
          >
            {tab.pinned ? <Pin size={12} aria-hidden="true" className="editor-tab-pin" /> : null}
            <span className="editor-tab-label">{basename(tab.relativePath)}</span>
            {isDirty ? <span className="editor-tab-dot" role="img" aria-label={t('editor.unsavedChanges')} /> : null}
            {/* A tab cannot own a control: keyboard and assistive tech close with Delete, the pointer uses this. */}
            <span
              className="editor-tab-close"
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.relativePath)
              }}
            >
              <X size={12} aria-hidden="true" />
            </span>
          </div>
        )
      })}
      {menu ? (() => {
        const tab = tabs.find((item) => item.relativePath === menu.path)
        if (!tab) return null
        const run = (action: () => void) => () => { setMenu(null); action() }
        const index = tabs.indexOf(tab)
        // Pinned tabs stay ahead of the others, so a tab only moves past neighbours of its own kind.
        const neighbour = (offset: number) => { const other = tabs[index + offset]; return other && other.pinned === tab.pinned ? other : undefined }
        const left = neighbour(-1), right = neighbour(1)
        // Outside the tablist, which may only own tabs.
        return createPortal(
          <div ref={menuRef} className="ws-group-context-menu" role="menu" aria-label={t('editor.tabs.menu', { name: basename(tab.relativePath) })} style={{ left: menu.x, top: menu.y }} data-testid="editor-tab-menu">
            <button type="button" role="menuitem" onClick={run(() => onTogglePin(tab.relativePath))}>
              {tab.pinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}{tab.pinned ? t('editor.tabs.unpin') : t('editor.tabs.pin')}
            </button>
            <button type="button" role="menuitem" disabled={!left} onClick={run(() => left && onMove(tab.relativePath, left.relativePath))}>
              <ArrowLeft size={12} aria-hidden="true" />{t('editor.tabs.moveLeft')}
            </button>
            <button type="button" role="menuitem" disabled={!right} onClick={run(() => right && onMove(tab.relativePath, right.relativePath))}>
              <ArrowRight size={12} aria-hidden="true" />{t('editor.tabs.moveRight')}
            </button>
            <button type="button" role="menuitem" disabled={tabs.length < 2} title={t('editor.tabs.closeOthersTitle')} onClick={run(() => onCloseOthers(tab.relativePath))}>
              <XSquare size={12} aria-hidden="true" />{t('editor.tabs.closeOthers')}
            </button>
            <button type="button" role="menuitem" onClick={run(() => onClose(tab.relativePath))}>
              <X size={12} aria-hidden="true" />{t('editor.tabs.close')}
            </button>
          </div>,
          document.body
        )
      })() : null}
    </div>
  )
}

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}
