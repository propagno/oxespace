import { Pin, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorTab } from '../../store/editor.store'
import { ContextMenu, copyText, type MenuEntry } from '../../ui'

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

/** Editor tab strip: click to activate, middle-click or Delete to close, double-click to pin, right-click for the tab menu, drag to reorder. */
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
        const menu: MenuEntry[] = [
          { label: t('editor.tabs.close'), onSelect: () => onClose(tab.relativePath) },
          { label: t('editor.tabs.closeOthers'), disabled: tabs.length < 2, onSelect: () => onCloseOthers(tab.relativePath) },
          { label: tab.pinned ? t('editor.tabs.unpin') : t('editor.tabs.pin'), onSelect: () => onTogglePin(tab.relativePath) },
          { type: 'separator' },
          { label: t('editor.tabs.copyPath'), onSelect: () => void copyText(tab.relativePath, t('editor.tabs.path')) }
        ]
        return (
          <ContextMenu key={tab.relativePath} items={menu} label={t('editor.tabs.menu', { name: basename(tab.relativePath) })}>
          <div
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
          </ContextMenu>
        )
      })}
    </div>
  )
}

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}
