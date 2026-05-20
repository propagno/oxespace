import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PaneType } from '../../../shared/types/workspace'

const PANE_TYPES: PaneType[] = ['terminal', 'tasks', 'editor', 'review']

interface PaneTypeSwitcherProps {
  activePaneType: PaneType | null
  onChangePaneType: (type: PaneType) => void
}

export function PaneTypeSwitcher({ activePaneType, onChangePaneType }: PaneTypeSwitcherProps): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="pane-type-switcher">
      <button
        type="button"
        className={`workspace-toolbar-button workspace-toolbar-button-compact${open ? ' active' : ''}`}
        disabled={activePaneType === null}
        onClick={() => setOpen(v => !v)}
        title="Change pane type"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pane-type-switcher-label">{activePaneType ?? '—'}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open && (
        <div className="pane-type-popover" role="listbox" aria-label="Pane types">
          {PANE_TYPES.map(type => (
            <button
              key={type}
              type="button"
              role="option"
              aria-selected={type === activePaneType}
              className={`pane-type-popover-item${type === activePaneType ? ' active' : ''}`}
              onClick={() => { onChangePaneType(type); setOpen(false) }}
            >
              <span className="pane-type-popover-check">
                {type === activePaneType && <Check size={10} aria-hidden="true" />}
              </span>
              {type}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
