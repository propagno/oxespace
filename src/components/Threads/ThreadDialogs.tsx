import { Check, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { ThreadProvider } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { Button, Dialog, TextField } from '../../ui'
export function NewThreadDialog({ initialProjectId, initialRootPath, onClose }: { initialProjectId: string | null; initialRootPath?: string; onClose: () => void }) {
  const projects = useThreadStore(state => state.projects)
  const choices = projects.filter(project => !project.hidden).flatMap(project => project.contexts.map(context => ({ ...context, projectId: project.projectId, projectName: project.displayName })))
  const [unique] = useState(() => choices.filter((c, i) => choices.findIndex(other => other.rootPath === c.rootPath) === i))
  const [choice, setChoice] = useState(() => Math.max(0, unique.findIndex(c => initialRootPath ? c.rootPath === initialRootPath : c.projectId === initialProjectId)))
  const [choosingProject, setChoosingProject] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  const [provider, setProvider] = useState<ThreadProvider>('claude')
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  const filteredProjects = unique.map((context, index) => ({ context, index })).filter(({ context }) => `${context.projectName} ${context.rootPath}`.toLowerCase().includes(projectQuery.toLowerCase()))
  return <Dialog className="thread-create-dialog" title="New thread" description="A separate conversation in your project." onClose={() => { if (!pending) onClose() }}
    footer={<>
      <Button disabled={pending} onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="new-thread-form" disabled={!unique[choice] || pending || !window.oxe?.thread}>{pending ? 'Creating…' : 'Create thread'}</Button>
    </>}>
    <form id="new-thread-form" onSubmit={async e => {
      e.preventDefault(); if (pending) return; const context = unique[choice]; if (!context) return
      setPending(true); setError('')
      try { const snapshot = await window.oxe.thread!.create({ projectId: context.projectId, rootPath: context.rootPath, provider }); useThreadStore.getState().adopt(snapshot); onClose() }
      catch { setError('Could not create conversation. Check the project directory and try again.') } finally { setPending(false) }
    }}><div className="thread-create-section thread-project-selection"><strong>Project</strong><span>{unique[choice]?.projectName ?? 'No project available'}</span><code>{unique[choice]?.rootPath}</code>{unique.length > 1 && <Button variant="link" size="sm" className="thread-project-change" aria-expanded={choosingProject} onClick={() => setChoosingProject(value => !value)}>Change project</Button>}{choosingProject && <fieldset className="thread-project-options"><legend>Choose project</legend><TextField aria-label="Filter projects" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} />{filteredProjects.map(({ context, index }) => <label key={context.rootPath}><input type="radio" name="thread-project" checked={choice === index} onChange={() => { setChoice(index); setChoosingProject(false) }} /><span>{context.projectName}<small>{context.rootPath}</small></span></label>)}{!filteredProjects.length && <p role="status">No projects match this search.</p>}</fieldset>}<p>Conversation files and commands use this directory.</p></div>
      <fieldset className="thread-agent-choice"><legend>Agent</legend><div className="thread-agent-options">{(['claude', 'codex'] as const).map(id => <label key={id} className="thread-agent-option" data-selected={provider === id}><input type="radio" name="thread-provider" value={id} checked={provider === id} onChange={() => setProvider(id)} /><span className="thread-agent-option-icon"><AgentProviderIcon provider={id} size={20} /></span><span><strong>{id === 'claude' ? 'Claude Code' : 'Codex'}</strong><small>{id === 'claude' ? 'Claude subscription' : 'ChatGPT subscription'}</small></span>{provider === id && <Check size={14} className="thread-agent-option-check" />}</label>)}</div></fieldset>
      {error && <p className="thread-dialog-error" role="alert">{error}</p>}
    </form>
  </Dialog>
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
  return <Dialog className="thread-create-dialog thread-project-dialog" title="Add project" description="Choose a folder to make it available to your Thread conversations." onClose={() => { if (!pending && !picking) onClose() }}
    footer={<>
      <Button disabled={pending || picking} onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="add-thread-project-form" disabled={pending || picking || !rootPath.trim()}>{pending ? 'Adding…' : 'Add project'}</Button>
    </>}>
    <form id="add-thread-project-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>Project folder
        <span className="thread-project-folder-field">
          <TextField aria-label="Project folder path" value={rootPath} placeholder={'C:\\projects\\my-project'} onChange={event => setRootPath(event.target.value)} autoFocus />
          <Button icon={<FolderOpen size={14} aria-hidden="true" />} disabled={pending || picking} onClick={() => {
            setPicking(true); setError('')
            void onPickFolder().then(path => { if (path) setRootPath(path) }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not open the folder picker.')).finally(() => setPicking(false))
          }}>{picking ? 'Choosing…' : 'Browse'}</Button>
        </span>
      </label>
      <p>The project will appear in the Thread sidebar. You can choose Claude or Codex when creating a conversation.</p>
      {error && <p className="thread-dialog-error" role="alert">{error}</p>}
    </form>
  </Dialog>
}
