import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sun } from 'lucide-react'
import { SidebarCollapseButton } from './SidebarCollapseButton'

import { workspaceColorAttrs } from '../../../shared/workspace-color'

export interface CodeRailWorkspace {
  id: string
  name: string
  rootPath?: string
  color?: string | number | null
}

export interface CodeRailProps {
  workspaces: CodeRailWorkspace[]
  activeWorkspaceId: string | null
  needsYou: ReadonlySet<string>
  onSelect: (id: string) => void
  onNewWorkspace: () => void
}

const RAIL_BUTTON_STYLE: CSSProperties = { width: 36, height: 36, minWidth: 36, minHeight: 36 }

export function CodeRail({
  workspaces,
  activeWorkspaceId,
  needsYou,
  onSelect,
  onNewWorkspace
}: CodeRailProps): ReactElement {
  const { t } = useTranslation('code')
  const newWorkspaceLabel = t('sidebar.newWorkspace')
  return (
    <div className="nav-rail" data-collapsed data-mode="code">
      <SidebarCollapseButton mode="code" collapsed />
      <nav className="sidebar-rail-list" aria-label={t('sidebar.collapsed')}>
        {workspaces.map((ws) => {
          const attention = needsYou.has(ws.id)
          const label = attention ? t('sidebar.railNeedsDecision', { name: ws.name }) : ws.name
          const active = ws.id === activeWorkspaceId
          return (
            <button
              key={ws.id}
              type="button"
              className={`sidebar-rail-workspace-btn${active ? ' active' : ''}`}
              {...(typeof ws.color === 'number' ? workspaceColorAttrs({ id: ws.id, color: ws.color }) : undefined)}
              style={{ ...RAIL_BUTTON_STYLE, ...(typeof ws.color === 'string' && ws.color ? { borderColor: ws.color } : undefined) }}
              aria-label={label}
              title={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(ws.id)}
            >
              <span aria-hidden="true">{ws.name.slice(0, 2).toUpperCase()}</span>
              {attention ? <Sun size={12} aria-hidden="true" /> : null}
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        className="nav-rail-btn"
        style={RAIL_BUTTON_STYLE}
        aria-label={newWorkspaceLabel}
        title={newWorkspaceLabel}
        data-testid="btn-new-workspace"
        onClick={onNewWorkspace}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
