import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, DatabaseZap, MessagesSquare, Settings2, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import './NavigationChrome.css'

export interface RailAction {
  id: string
  label: string
  /** Accessible name when it differs from the visible tooltip. */
  ariaLabel?: string
  icon: LucideIcon
  onClick?: () => void
  testId?: string
  disabled?: boolean
}

/**
 * Icon rail shared by the Code and Thread sidebars. It owns the controls that
 * used to be split between the header, quick-nav and footer so each destination
 * exists exactly once (names and test ids are unchanged).
 */
export type NavigationMode = 'code' | 'thread' | 'data'

export function NavigationRail({ mode, collapsed, onModeChange, onSelectMode, primary, context, onToggle, children }: {
  mode: NavigationMode; collapsed: boolean; onModeChange?: () => void
  /** When present it handles every mode button; `onModeChange` keeps the older two-way Code/Thread switch. */
  onSelectMode?: (mode: NavigationMode) => void
  primary: RailAction[]; context: RailAction; onToggle: () => void; children?: ReactNode
}) {
  const openSettings = useUIStore(state => state.toggleSettings)
  const ContextIcon = context.icon
  const select = (target: NavigationMode): void => {
    if (target === mode) return
    if (onSelectMode) onSelectMode(target)
    else if (target !== 'data') onModeChange?.()
  }
  return <div className="nav-rail" data-collapsed={collapsed}>
    <nav className="nav-rail-group" aria-label="Application view">
      <button type="button" className="nav-rail-btn" aria-label="Code" title="Code" aria-pressed={mode === 'code'} onClick={() => select('code')}><SquareTerminal size={17} aria-hidden="true" /></button>
      <button type="button" className="nav-rail-btn" aria-label="Thread" title="Thread" aria-pressed={mode === 'thread'} onClick={() => select('thread')}><MessagesSquare size={17} aria-hidden="true" /></button>
      {(onSelectMode || mode === 'data') && <button type="button" className="nav-rail-btn" aria-label="OxeQuery" title="OxeQuery: containers and databases" aria-pressed={mode === 'data'} onClick={() => select('data')}><DatabaseZap size={17} aria-hidden="true" /></button>}
    </nav>
    <span className="nav-rail-separator" aria-hidden="true" />
    <nav className="nav-rail-group" aria-label="Primary navigation">
      {primary.map(({ id, label, ariaLabel, icon: Icon, onClick, testId, disabled }) =>
        <button key={id} type="button" className="nav-rail-btn" aria-label={ariaLabel ?? label} title={label} data-testid={testId} disabled={disabled} onClick={onClick}><Icon size={17} aria-hidden="true" /></button>)}
    </nav>
    {children}
    <span className="nav-rail-spacer" />
    <footer className="nav-rail-group nav-rail-footer">
      <button type="button" className="nav-rail-btn" aria-label={context.ariaLabel ?? context.label} title={context.label} data-testid={context.testId} onClick={context.onClick}><ContextIcon size={17} aria-hidden="true" /></button>
      <button type="button" className="nav-rail-btn" aria-label="Open settings" title="Settings" onClick={openSettings}><Settings2 size={17} aria-hidden="true" /></button>
      <button type="button" className="nav-rail-btn" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>{collapsed ? <ChevronsRight size={17} aria-hidden="true" /> : <ChevronsLeft size={17} aria-hidden="true" />}</button>
    </footer>
  </div>
}
