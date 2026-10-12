import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { ThreadView } from './ThreadView'

/** View context for reusable file/Git panels; never persisted as a Code workspace. */
function projectView(thread: ConversationThread | undefined, name: string | undefined): Workspace | undefined {
  if (!thread) return undefined
  return { id: `thread:${thread.projectId}`, name: name ?? thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Project', rootPath: thread.rootPath,
    layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: '', autoStart: false, isActive: false, panes: [] }
}

export function ThreadGrid({ onNewThread, onAccounts, onDelegations }: { onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  const selectedId = useThreadStore(state => state.selectedId)
  const secondaryId = useThreadStore(state => state.secondaryId)
  const activeCell = useThreadStore(state => state.activeCell)
  const threads = useThreadStore(state => state.threads)
  const projects = useThreadStore(state => state.projects)
  const primary = threads.find(thread => thread.id === selectedId)
  const secondary = threads.find(thread => thread.id === secondaryId)
  const primaryWorkspace = projectView(primary, projects.find(project => project.projectId === primary?.projectId)?.displayName)
  const secondaryWorkspace = projectView(secondary, projects.find(project => project.projectId === secondary?.projectId)?.displayName)

  return <div className={`thread-grid${secondaryId ? ' is-split' : ''}`} role="group" aria-label={secondaryId ? 'Side-by-side conversations' : 'Conversation'}>
    <div className={`thread-cell${activeCell === 'primary' ? ' is-active' : ''}`}>
      <ThreadView key={selectedId ?? 'empty-primary'} threadId={selectedId} workspace={primaryWorkspace} active={!secondaryId || activeCell === 'primary'} onActivate={() => useThreadStore.getState().setActiveCell('primary')} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>
    {secondaryId && <div className={`thread-cell${activeCell === 'secondary' ? ' is-active' : ''}`}>
      <ThreadView key={secondaryId} threadId={secondaryId} workspace={secondaryWorkspace} active={activeCell === 'secondary'} onActivate={() => useThreadStore.getState().setActiveCell('secondary')} onCloseCell={() => useThreadStore.getState().closeSecondary()} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>}
  </div>
}
