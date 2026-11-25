import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, CircleAlert, Sun } from 'lucide-react'
import { IconButton } from '../../ui'
import { SidebarCollapseButton } from '../Sidebar/SidebarCollapseButton'

export interface ThreadRailConversation {
  id: string
  title: string
  needsYou?: boolean
  current?: boolean
  status?: 'running' | 'ready' | 'completed' | 'attention' | 'failed' | 'interrupted'
}

export interface ThreadRailProps {
  conversations: ThreadRailConversation[]
  onSelect: (id: string) => void
  onArchived: () => void
}

export function ThreadRail({ conversations, onSelect, onArchived }: ThreadRailProps): ReactElement {
  const { t } = useTranslation('thread')
  const archivedLabel = t('sidebar.archived')
  return (
    <div className="nav-rail" data-collapsed data-mode="thread">
      <SidebarCollapseButton mode="thread" collapsed />
      <nav aria-label={t('sidebar.conversations')} data-rail-items="">
        {conversations.map(conv => {
          const label = conv.needsYou ? t('sidebar.railNeedsDecision', { name: conv.title }) : conv.title
          return (
            <IconButton
              key={conv.id}
              size="lg"
              variant="ghost"
              className="nav-rail-btn"
              label={label}
              title={label}
              aria-current={conv.current ? 'page' : undefined}
              data-needs-you={conv.needsYou ? 'true' : undefined}
              data-status={conv.status}
              onClick={() => onSelect(conv.id)}
              icon={conv.needsYou ? (
                <Sun size={15} aria-hidden="true" />
              ) : conv.status === 'failed' ? (
                <CircleAlert size={14} aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{[...conv.title.trim()][0]?.toUpperCase() ?? '·'}</span>
              )}
            />
          )
        })}
      </nav>
      <IconButton
        size="lg"
        variant="ghost"
        className="nav-rail-btn"
        label={archivedLabel}
        title={archivedLabel}
        onClick={onArchived}
        icon={<Archive size={16} aria-hidden="true" />}
      />
    </div>
  )
}
