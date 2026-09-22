import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadProvider } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { DesktopDialog } from '../Navigation/DesktopDialog'
export function NewThreadDialog({ workspaces, initialWorkspaceId, initialRootPath, onClose }: { workspaces: Workspace[]; initialWorkspaceId: string | null; initialRootPath?: string; onClose: () => void }) {
  const projects = useThreadStore(state => state.projects)
  const contexts = projects.flatMap(project => project.contexts.map(context => ({ ...context, projectName: project.displayName })))
  const choices = contexts.length ? contexts : workspaces.map(w => ({ workspaceId: w.id, paneId: undefined as string | undefined, rootPath: w.rootPath, label: w.name, projectName: w.name }))
  const [unique] = useState(() => choices.filter((c, i) => choices.findIndex(other => other.rootPath === c.rootPath) === i))
  const [choice, setChoice] = useState(() => Math.max(0, unique.findIndex(c => initialRootPath ? c.rootPath === initialRootPath : c.workspaceId === initialWorkspaceId)))
  const [provider, setProvider] = useState<ThreadProvider>('claude')
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  return <DesktopDialog className="thread-create-dialog" title="New thread" description="A separate conversation in your project." onClose={onClose}><form onSubmit={async e => {
    e.preventDefault(); const context = unique[choice]; if (!context) return
    setPending(true); setError('')
    try { const snapshot = await window.oxe.thread!.create({ workspaceId: context.workspaceId, provider, ...(context.paneId ? { paneId: context.paneId } : {}) }); useThreadStore.getState().adopt(snapshot); onClose() }
    catch { setError('Could not create conversation. Check the project directory and try again.') } finally { setPending(false) }
  }}><label>Project and directory<select value={choice} onChange={e => setChoice(Number(e.target.value))}>{unique.map((c, i) => <option key={`${c.workspaceId}:${c.paneId}`} value={i}>{c.projectName} · {c.rootPath}</option>)}</select></label>
    <label>Agent<select value={provider} onChange={e => setProvider(e.target.value as ThreadProvider)}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
    {error && <p role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="thread-primary" disabled={!unique[choice] || pending || !window.oxe?.thread}>Create thread</button></footer></form></DesktopDialog>
}

export function AddThreadProjectDialog({ onPickFolder, onAdd, onClose }: {
  onPickFolder: () => Promise<string | null>
  onAdd: (rootPath: string) => Promise<void>
  onClose: () => void
}) {
  const [rootPath, setRootPath] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [picking, setPicking] = useState(false)
  const submit = async () => {
    const normalized = rootPath.trim()
    if (!normalized) { setError('Choose a project folder.'); return }
    setPending(true); setError('')
    try { await onAdd(normalized); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this project.') }
    finally { setPending(false) }
  }
  return <DesktopDialog className="thread-create-dialog thread-project-dialog" title="Add project" description="Choose a folder to make it available to your Thread conversations." onClose={() => { if (!pending && !picking) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>Project folder
        <span className="thread-project-folder-field">
          <input aria-label="Project folder path" value={rootPath} placeholder="C:\\projects\\my-project" onChange={event => setRootPath(event.target.value)} autoFocus />
          <button type="button" disabled={pending || picking} onClick={() => {
            setPicking(true); setError('')
            void onPickFolder().then(path => { if (path) setRootPath(path) }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not open the folder picker.')).finally(() => setPicking(false))
          }}><FolderOpen size={14} aria-hidden="true" />{picking ? 'Choosing…' : 'Browse'}</button>
        </span>
      </label>
      <p>The project will appear in the Thread sidebar. You can choose Claude or Codex when creating a conversation.</p>
      {error && <p className="thread-dialog-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={pending || picking} onClick={onClose}>Cancel</button><button type="submit" className="thread-primary" disabled={pending || picking || !rootPath.trim()}>{pending ? 'Adding…' : 'Add project'}</button></footer>
    </form>
  </DesktopDialog>
}
