import { Box, Maximize2, Minimize2, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ContainersPanel } from '../Containers/ContainersPanel'
import { Button } from '../../ui'

export interface WorkspaceContainersPanelProps {
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onOpenConversation?: (conversationId: string) => void
}

export function WorkspaceContainersPanel({ isExpanded, onCollapse, onToggleExpanded, onOpenConversation }: WorkspaceContainersPanelProps): ReactElement {
  const { t } = useTranslation('code')
  const { t: tc } = useTranslation()
  const expandLabel = isExpanded ? tc('ui.splitter.restore') : tc('ui.splitter.larger')
  return (
    <aside className="workspace-editor-panel" data-testid="workspace-containers-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Box size={13} aria-hidden="true" />
          <span>{t('panels.containers')}</span>
        </div>
        <div className="workspace-editor-actions">
          <Button
            variant="ghost"
            size="sm"
            square
            className="tile-btn"
            aria-label={expandLabel}
            title={expandLabel}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            square
            className="tile-btn"
            aria-label={tc('ui.close')}
            title={tc('ui.close')}
            onClick={onCollapse}
          >
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <ContainersPanel onOpenConversation={onOpenConversation} />
      </div>
    </aside>
  )
}
