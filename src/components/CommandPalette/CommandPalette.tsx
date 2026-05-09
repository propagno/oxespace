import { Search, X } from 'lucide-react'
import { useMemo, useState, type ReactElement } from 'react'

export interface CommandPaletteAction {
  id: string
  title: string
  subtitle?: string
  disabled?: boolean
  run: () => void
}

interface CommandPaletteProps {
  actions: CommandPaletteAction[]
  onClose: () => void
}

export function CommandPalette({ actions, onClose }: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('')
  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((action) => `${action.title} ${action.subtitle ?? ''}`.toLowerCase().includes(needle))
  }, [actions, query])

  const runAction = (action: CommandPaletteAction): void => {
    if (action.disabled) return
    action.run()
    onClose()
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <header className="command-palette-search">
          <Search size={15} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Type a command" />
          <button type="button" className="icon-button" aria-label="Close command palette" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="command-palette-list">
          {filteredActions.map((action) => (
            <button key={action.id} type="button" className="command-palette-item" disabled={action.disabled} onClick={() => runAction(action)}>
              <strong>{action.title}</strong>
              {action.subtitle ? <span>{action.subtitle}</span> : null}
            </button>
          ))}
          {filteredActions.length === 0 ? <div className="command-palette-empty">No commands</div> : null}
        </div>
      </section>
    </div>
  )
}
