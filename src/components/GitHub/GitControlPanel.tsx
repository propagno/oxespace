import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileCode2, GitBranch, Loader2, RefreshCw, Upload } from 'lucide-react'
import type { GitControlFile, GitControlStatus } from '../../../shared/types/git'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import './GitControlPanel.css'

type Props = { workspaceId: string; rootPath: string; onOpenFile?: (path: string) => void }

function FileGroup({ title, files, action, onAction, onOpenFile }: {
  title: string; files: GitControlFile[]; action?: string; onAction?: (path: string) => void; onOpenFile?: (path: string) => void
}) {
  if (!files.length) return null
  return <section className="git-control-group"><h3>{title}<span>{files.length}</span></h3>
    {files.map(file => <div className="git-control-file" key={`${title}:${file.path}`}>
      <button type="button" className="git-control-file-name" title={file.path} onClick={() => onOpenFile?.(file.path)}><FileCode2 size={13} /><span>{file.path}</span></button>
      <span className="git-control-file-status" title={file.status}>{file.untracked ? 'U' : file.conflicted ? '!' : file.status.replace(/\./g, '').slice(0, 2)}</span>
      {action && <button type="button" className="git-control-file-action" aria-label={`${action} ${file.path}`} title={`${action} ${file.path}`} onClick={() => onAction?.(file.path)}>{action}</button>}
    </div>)}
  </section>
}

/** Local Git surface: no GitHub CLI, network request or history prefetch on open. */
export function GitControlPanel({ workspaceId, rootPath, onOpenFile }: Props) {
  const [status, setStatus] = useState<GitControlStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const request = useRef(0)
  const cancelPending = useCallback(() => { request.current++ }, [])
  const input = { workspaceId, rootPath }
  const openFile = (path: string) => {
    if (onOpenFile) { onOpenFile(path); return }
    const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === workspaceId)
    if (!workspace) return
    void useWorkspaceStore.getState().updateEditorState({ workspaceId, editorVisible: true, editorExpanded: false, editorWidthPercent: workspace.editorWidthPercent ?? 48 })
    void useEditorStore.getState().openFile({ workspaceId, rootPath, relativePath: path })
  }
  const refresh = useCallback(async () => {
    if (document.visibilityState === 'hidden') return
    const generation = ++request.current
    setRefreshing(true)
    try {
      const next = await window.oxe.git.getStatus({ workspaceId, rootPath })
      if (generation !== request.current) return
      setStatus(next); setError(next.error ?? '')
    } catch (cause) { if (generation === request.current) setError(cause instanceof Error ? cause.message : 'Git status is unavailable.') }
    finally { if (generation === request.current) setRefreshing(false) }
  }, [workspaceId, rootPath])
  useEffect(() => {
    setStatus(null); setError('')
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    const wake = () => void refresh()
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake)
    return () => { cancelPending(); clearInterval(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake) }
  }, [refresh, cancelPending])
  const mutate = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Git action failed.') }
    finally { setBusy(false) }
  }
  const files = status?.files ?? []
  const staged = files.filter(file => file.staged && !file.conflicted)
  const changed = files.filter(file => file.unstaged && !file.untracked && !file.conflicted)
  const untracked = files.filter(file => file.untracked)
  const conflicts = files.filter(file => file.conflicted)
  return <div className="git-control" aria-busy={refreshing || busy}>
    <header className="git-control-heading"><div><strong><GitBranch size={15} />{status?.branch ?? 'Git control'}</strong><small>{status?.ahead ? `↑ ${status.ahead}` : ''}{status?.behind ? ` ↓ ${status.behind}` : ''}</small></div>
      <button type="button" aria-label="Refresh Git status" title="Refresh Git status" onClick={() => void refresh()} disabled={refreshing || busy}>{refreshing ? <Loader2 className="git-control-spin" size={15} /> : <RefreshCw size={15} />}</button>
    </header>
    {error && <p role="alert" className="git-control-error">{error}</p>}
    {status?.truncated && <p role="status" className="git-control-note">Showing the first 1,000 changed paths. Git status is larger than this view.</p>}
    {!status && !error && <p className="git-control-empty">Reading local Git changes…</p>}
    {status && !status.error && <>
      <FileGroup title="Conflicts" files={conflicts} onOpenFile={openFile} />
      {conflicts.length > 0 && <p className="git-control-note">Resolve conflicts in the editor, then stage the resolved files before committing.</p>}
      <FileGroup title="Staged" files={staged} action="Unstage" onAction={path => void mutate(() => window.oxe.github.unstageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup title="Changes" files={changed} action="Stage" onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup title="Untracked" files={untracked} action="Stage" onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      {!files.length && <div className="git-control-empty"><Check size={16} />Working tree clean</div>}
      <div className="git-control-actions">{(changed.length > 0 || untracked.length > 0) && <button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.stageAll(input))}>Stage all</button>}
        <details><summary>Remote actions <span className="git-control-upstream">{status.upstream ?? 'Upstream not set'}</span><ChevronDown size={13} /></summary><div><button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.fetch(input))}>Fetch</button><button type="button" disabled={busy || !status.ahead} onClick={() => void mutate(() => window.oxe.github.push(input))}><Upload size={12} /> Push</button></div></details></div>
      {staged.length > 0 && <form className="git-control-commit" onSubmit={event => { event.preventDefault(); if (!message.trim()) return; void mutate(async () => { await window.oxe.github.commit({ ...input, message: message.trim() }); setMessage('') }) }}>
        <label htmlFor={`git-control-message-${workspaceId}`}>Commit message</label><textarea id={`git-control-message-${workspaceId}`} value={message} rows={2} maxLength={1000} placeholder="Describe your changes" onChange={event => setMessage(event.target.value)} />
        <button type="submit" disabled={busy || !staged.length || !message.trim()}>Commit {staged.length ? `${staged.length} staged` : ''}</button>
      </form>}
    </>}
  </div>
}
