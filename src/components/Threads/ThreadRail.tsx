import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Sun } from 'lucide-react'
import { SidebarCollapseButton } from '../Sidebar/SidebarCollapseButton'

export interface ThreadRailConversation {
  id: string
  title: string
  needsYou?: boolean
  current?: boolean
}

export interface ThreadRailProps {
  conversations: ThreadRailConversation[]
  onSelect: (id: string) => void
  onArchived: () => void
}

const RAIL_BUTTON_STYLE: CSSProperties = { width: 36, height: 36, minWidth: 36, minHeight: 36 }

export function ThreadRail({ conversations, onSelect, onArchived }: ThreadRailProps): ReactElement {
  const { t } = useTranslation('thread')
  const archivedLabel = t('sidebar.archived')
  return (
    <div className="nav-rail" data-collapsed data-mode="thread">
      <SidebarCollapseButton mode="thread" collapsed />
      <nav aria-label={t('sidebar.conversations')} data-rail-items="">
        {conversations.map((conv) => {
          const label = conv.needsYou ? t('sidebar.railNeedsDecision', { name: conv.title }) : conv.title
          return (
            <button
              key={conv.id}
              type="button"
              className="nav-rail-btn"
              style={RAIL_BUTTON_STYLE}
              aria-label={label}
              title={label}
              aria-current={conv.current ? 'page' : undefined}
              onClick={() => onSelect(conv.id)}
            >
              <span aria-hidden="true">{[...conv.title.trim()][0]?.toUpperCase() ?? '·'}</span>
              {conv.needsYou ? <Sun size={12} aria-hidden="true" /> : null}
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        className="nav-rail-btn"
        style={RAIL_BUTTON_STYLE}
        aria-label={archivedLabel}
        title={archivedLabel}
        onClick={onArchived}
      >
        <Archive size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
