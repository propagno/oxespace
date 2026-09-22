import type { Workspace } from '../../../shared/types/workspace'
import { useThreadStore } from '../../store/thread.store'
import { ThreadView } from './ThreadView'

export function ThreadGrid({ workspaces, onNewThread, onAccounts, onDelegations }: { workspaces: Workspace[]; onNewThread?: () => void; onAccounts?: () => void; onDelegations?: () => void }) {
  const selectedId = useThreadStore(state => state.selectedId)
  const secondaryId = useThreadStore(state => state.secondaryId)
  const activeCell = useThreadStore(state => state.activeCell)
  const threads = useThreadStore(state => state.threads)
  const primary = threads.find(thread => thread.id === selectedId)
  const secondary = threads.find(thread => thread.id === secondaryId)
  const primaryWorkspace = workspaces.find(workspace => workspace.id === primary?.workspaceId)
  const secondaryWorkspace = workspaces.find(workspace => workspace.id === secondary?.workspaceId)

  return <div className={`thread-grid${secondaryId ? ' is-split' : ''}`} role="group" aria-label={secondaryId ? 'Side-by-side conversations' : 'Conversation'}>
    <div className={`thread-cell${activeCell === 'primary' ? ' is-active' : ''}`}>
      <ThreadView threadId={selectedId} workspace={primaryWorkspace} active={!secondaryId || activeCell === 'primary'} onActivate={() => useThreadStore.getState().setActiveCell('primary')} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>
    {secondaryId && <div className={`thread-cell${activeCell === 'secondary' ? ' is-active' : ''}`}>
      <ThreadView threadId={secondaryId} workspace={secondaryWorkspace} active={activeCell === 'secondary'} onActivate={() => useThreadStore.getState().setActiveCell('secondary')} onCloseCell={() => useThreadStore.getState().closeSecondary()} onNewThread={onNewThread} onAccounts={onAccounts} onDelegations={onDelegations} />
    </div>}
  </div>
}
