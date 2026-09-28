import { ChevronsLeft, ChevronsRight, Settings2, type LucideIcon } from 'lucide-react'
import { OxeLogo } from '../Brand/OxeLogo'
import { useUIStore } from '../../store/ui.store'
import './NavigationChrome.css'

export function NavigationFooter({ className, collapsed, context, onToggle }: {
  className: string; collapsed: boolean; onToggle: () => void
  context: { label: string; ariaLabel: string; icon: LucideIcon; onClick?: () => void; testId?: string }
}) {
  const Icon = context.icon
  const openSettings = useUIStore(state => state.toggleSettings)
  return <footer className={`${className} desktop-nav-footer`} data-collapsed={collapsed}>
    <button type="button" aria-label={context.ariaLabel} title={context.label} data-testid={context.testId} onClick={context.onClick}><Icon size={16} aria-hidden="true" />{!collapsed && <span>{context.label}</span>}</button>
    <button type="button" aria-label="Open settings" title="Settings" onClick={openSettings}><Settings2 size={16} aria-hidden="true" />{!collapsed && <span>Settings</span>}</button>
    <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>{collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}{!collapsed && <span>Collapse</span>}</button>
  </footer>
}

export function NavigationBrand({ collapsed, mode, onModeChange, version }: {
  collapsed: boolean; mode: 'code' | 'thread'; onModeChange?: () => void; version?: string
}) {
  return <>
    <div className="desktop-nav-brand" title={version ? `OXESpace v${version}` : 'OXESpace'}>{collapsed && <OxeLogo size={18} />}{!collapsed && <strong>{mode === 'code' ? 'Workspaces' : 'Sessions'}</strong>}
      {!collapsed && onModeChange && <nav className="desktop-mode-select" aria-label="Application view">
        <button type="button" aria-pressed={mode === 'code'} onClick={mode === 'thread' ? onModeChange : undefined}>Code</button>
        <button type="button" aria-pressed={mode === 'thread'} onClick={mode === 'code' ? onModeChange : undefined}>Thread</button>
      </nav>}
    </div>
  </>
}
