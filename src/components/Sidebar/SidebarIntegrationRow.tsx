import { ChevronDown, GitBranch, Zap } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { IntegrationGroup } from '../../../shared/types/integration'
import { EmptyState } from '../../ui'

interface SidebarIntegrationRowProps {
  group: IntegrationGroup
  isActive: boolean
  activeMemberId: string | null
  defaultExpanded: boolean
  onSelectMember: (groupId: string, memberId: string, workspaceId: string) => void
}

/**
 * Sidebar row for one integration group. Modeled on `WorkspaceGroup` so the
 * Integration section reads with the same rhythm as the Workspaces section:
 * a chevron-led header that expands into indented member rows, instead of
 * the previous flat list that read as a separate visual paradigm.
 *
 * Active members get the brand left edge so the user knows which sibling
 * they're currently inspecting from the panel.
 */
export function SidebarIntegrationRow({ group, isActive, activeMemberId, defaultExpanded, onSelectMember }: SidebarIntegrationRowProps): ReactElement {
  const { t } = useTranslation('code')
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div className={`sidebar-integration-row${isActive ? ' active' : ''}${expanded ? ' open' : ''}`}>
      <button
        type="button"
        className="sidebar-integration-row-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={group.goal || group.name}
      >
        <ChevronDown size={12} className={`sidebar-integration-row-chevron${expanded ? ' open' : ''}`} aria-hidden="true" />
        <Zap size={12} className="sidebar-integration-row-icon" aria-hidden="true" />
        <span className="sidebar-integration-row-name">{group.name}</span>
        <span className={`sidebar-integration-row-status status-${group.status}`}>{group.status}</span>
      </button>
      {expanded ? (
        <ul className="sidebar-integration-row-members" aria-label={t('sidebar.members', { name: group.name })}>
          {group.members.length === 0 ? (
            <li><EmptyState compact title={t('sidebar.noMembers')} /></li>
          ) : (
            group.members.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  className={`sidebar-integration-row-member${member.id === activeMemberId ? ' active' : ''}`}
                  onClick={() => onSelectMember(group.id, member.id, member.workspaceId)}
                  title={`${member.role.toUpperCase()} · ${member.alias}`}
                >
                  <span className="sidebar-integration-row-role">{member.role}</span>
                  <span className="sidebar-integration-row-alias">{member.alias}</span>
                  <span className="sidebar-integration-row-branch">
                    <GitBranch size={12} aria-hidden="true" />
                    {member.branch ?? t('github.noBranch')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
