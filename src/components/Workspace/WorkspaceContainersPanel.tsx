import { Box, ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ContainersPanel } from '../Containers/ContainersPanel'
import { DockPanel, IconButton } from '../../ui'

export interface WorkspaceContainersPanelProps {
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onOpenConversation?: (conversationId: string) => void
}

export function WorkspaceContainersPanel({ isExpanded, onCollapse, onToggleExpanded, onOpenConversation }: WorkspaceContainersPanelProps): ReactElement {
  const { t } = useTranslation('code')
  const expandLabel = isExpanded ? t('workspace.panel.restore') : t('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-containers-panel"
      className="workspace-editor-panel"
      icon={<Box size={14} aria-hidden="true" />}
      title={t('panels.containers')}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={t('workspace.panel.collapse')} title={t('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <ContainersPanel onOpenConversation={onOpenConversation} />
      </div>
    </DockPanel>
  )
}
