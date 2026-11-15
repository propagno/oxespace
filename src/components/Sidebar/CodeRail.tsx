import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sun } from 'lucide-react'
import { IconButton } from '../../ui'
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

/** The collapsed OxeCode sidebar: src/ui IconButtons at lg, like its collapse button (BRD-03, OXE-63). */
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
            <IconButton
              key={ws.id}
              size="lg"
              variant="ghost"
              className={`sidebar-rail-workspace-btn${active ? ' active' : ''}`}
              {...(typeof ws.color !== 'string' ? workspaceColorAttrs({ id: ws.id, color: ws.color ?? null }) : undefined)}
              style={typeof ws.color === 'string' && ws.color ? { borderColor: ws.color } : undefined}
              label={label}
              title={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(ws.id)}
              icon={<>
                <span aria-hidden="true">{ws.name.slice(0, 2).toUpperCase()}</span>
                {attention ? <Sun size={11} className="sidebar-rail-attention" aria-hidden="true" /> : null}
              </>}
            />
          )
        })}
      </nav>
      <IconButton
        size="lg"
        label={newWorkspaceLabel}
        title={newWorkspaceLabel}
        data-testid="btn-new-workspace"
        onClick={onNewWorkspace}
        icon={<Plus size={16} aria-hidden="true" />}
      />
    </div>
  )
}
