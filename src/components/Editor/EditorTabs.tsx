import { Pin, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
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

/** Editor tab strip: click to activate, middle-click to close, drag to reorder. */
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
    <div ref={stripRef} className="editor-tabs scrollbar-sleek" role="tablist" aria-label="Open files" data-testid="editor-tabs">
      {tabs.map((tab) => {
        const isActive = tab.relativePath === activePath
        const isDirty = dirtyPaths.has(tab.relativePath)
        return (
          <div
            key={tab.relativePath}
            role="tab"
            aria-selected={isActive}
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
              onCloseOthers(tab.relativePath)
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
            {tab.pinned ? <Pin size={10} aria-hidden="true" className="editor-tab-pin" /> : null}
            <span className="editor-tab-label">{basename(tab.relativePath)}</span>
            {isDirty ? <span className="editor-tab-dot" aria-label="Unsaved changes" /> : null}
            <button
              type="button"
              className="editor-tab-close"
              aria-label={`Close ${tab.relativePath}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.relativePath)
              }}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}
