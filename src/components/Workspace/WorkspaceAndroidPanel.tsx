import { ChevronsRight, Maximize2, Minimize2, Smartphone } from 'lucide-react'
import type { ReactElement } from 'react'
import { AndroidPanel } from '../Android/AndroidPanel'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceAndroidPanelProps {
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceAndroidPanel({ isExpanded, onCollapse, onToggleExpanded }: WorkspaceAndroidPanelProps): ReactElement {
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-android-panel"
      className="workspace-editor-panel"
      icon={<Smartphone size={14} aria-hidden="true" />}
      title={tc('panels.android')}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <AndroidPanel />
      </div>
    </DockPanel>
  )
}
