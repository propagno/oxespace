import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'
import { ThreadView } from './ThreadView'

/** View context for reusable file/Git panels; never persisted as a Code workspace. */
function projectView(thread: ConversationThread | undefined, name: string | undefined): Workspace | undefined {
  if (!thread) return undefined
  return { id: `thread:${thread.projectId}`, name: name ?? thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? i18n.t('thread:common.project'), rootPath: thread.rootPath,
    layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: '', autoStart: false, isActive: false, panes: [] }
}

export function ThreadGrid({ onNewThread, onAccounts, onDelegations }: { onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  { const w = window as unknown as { __renders?: Record<string, number> }; (w.__renders ??= {})['ThreadGrid'] = ((w.__renders ??= {})['ThreadGrid'] ?? 0) + 1 }
  const { t } = useTranslation('thread')
  const selectedId = useThreadStore(state => state.selectedId)
  const secondaryId = useThreadStore(state => state.secondaryId)
  const activeCell = useThreadStore(state => state.activeCell)
  const threads = useThreadStore(state => state.threads)
  const projects = useThreadStore(state => state.projects)
  const primary = threads.find(thread => thread.id === selectedId)
  const secondary = threads.find(thread => thread.id === secondaryId)
  const primaryWorkspace = projectView(primary, projects.find(project => project.projectId === primary?.projectId)?.displayName)
  const secondaryWorkspace = projectView(secondary, projects.find(project => project.projectId === secondary?.projectId)?.displayName)

  return <div className={`thread-grid${secondaryId ? ' is-split' : ''}`} role="group" aria-label={secondaryId ? t('grid.split') : t('grid.single')}>
    <div className={`thread-cell${activeCell === 'primary' ? ' is-active' : ''}`}>
      <ThreadView key={selectedId ?? 'empty-primary'} threadId={selectedId} workspace={primaryWorkspace} active={!secondaryId || activeCell === 'primary'} onActivate={() => useThreadStore.getState().setActiveCell('primary')} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>
    {secondaryId && <div className={`thread-cell${activeCell === 'secondary' ? ' is-active' : ''}`}>
      <ThreadView key={secondaryId} threadId={secondaryId} workspace={secondaryWorkspace} active={activeCell === 'secondary'} onActivate={() => useThreadStore.getState().setActiveCell('secondary')} onCloseCell={() => useThreadStore.getState().closeSecondary()} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>}
  </div>
}
