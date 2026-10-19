import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileCode2, GitBranch, Loader2, RefreshCw, Upload } from 'lucide-react'
import type { GitControlFile, GitControlStatus } from '../../../shared/types/git'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import './GitControlPanel.css'
import { Button, TextArea, TextField, EmptyState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

type Props = {
  workspaceId: string; rootPath: string; onOpenFile?: (path: string) => void
  /** Commit message and pull request drafted from a conversation, offered for editing. */
  draft?: () => { message: string; prTitle: string; prBody: string }
}

function FileGroup({ title, files, action, onAction, onOpenFile }: {
  title: string; files: GitControlFile[]; action?: string; onAction?: (path: string) => void; onOpenFile?: (path: string) => void
}) {
  if (!files.length) return null
  return <section className="git-control-group"><h3>{title}<span>{files.length}</span></h3>
    {files.map(file => <div className="git-control-file" key={`${title}:${file.path}`}>
      <button type="button" className="git-control-file-name" title={file.path} onClick={() => onOpenFile?.(file.path)}><FileCode2 size={14} /><span>{file.path}</span></button>
      <span className="git-control-file-status" title={file.status}>{file.untracked ? 'U' : file.conflicted ? '!' : file.status.replace(/\./g, '').slice(0, 2)}</span>
      {action && <button type="button" className="git-control-file-action" aria-label={`${action} ${file.path}`} title={`${action} ${file.path}`} onClick={() => onAction?.(file.path)}>{action}</button>}
    </div>)}
  </section>
}

/** Local Git surface: no GitHub CLI, network request or history prefetch on open. */
export function GitControlPanel({ workspaceId, rootPath, onOpenFile, draft }: Props) {
  const [status, setStatus] = useState<GitControlStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [pr, setPr] = useState<{ title: string; body: string; draft: boolean } | null>(null)
  const [notice, setNotice] = useState('')
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
    } catch (cause) { if (generation === request.current) setError(humanizeError(cause, 'Git status is unavailable.')) }
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
    catch (cause) { setError(humanizeError(cause, 'Git action failed.')) }
    finally { setBusy(false) }
  }
  const files = status?.files ?? []
  const staged = files.filter(file => file.staged && !file.conflicted)
  const changed = files.filter(file => file.unstaged && !file.untracked && !file.conflicted)
  const untracked = files.filter(file => file.untracked)
  const conflicts = files.filter(file => file.conflicted)
  return <div className="git-control" aria-busy={refreshing || busy}>
    <header className="git-control-heading"><div><strong><GitBranch size={14} />{status?.branch ?? 'Git control'}</strong><small>{status?.ahead ? `↑ ${status.ahead}` : ''}{status?.behind ? ` ↓ ${status.behind}` : ''}</small></div>
      <button type="button" aria-label="Refresh Git status" title="Refresh Git status" onClick={() => void refresh()} disabled={refreshing || busy}>{refreshing ? <Loader2 className="git-control-spin" size={15} /> : <RefreshCw size={14} />}</button>
    </header>
    {error && <p role="alert" className="git-control-error">{error}</p>}
    {status?.truncated && <p role="status" className="git-control-note">Showing the first 1,000 changed paths. Git status is larger than this view.</p>}
    {!status && !error && <EmptyState compact title="Reading local Git changes…" />}
    {status && !status.error && <>
      <FileGroup title="Conflicts" files={conflicts} onOpenFile={openFile} />
      {conflicts.length > 0 && <p className="git-control-note">Resolve conflicts in the editor, then stage the resolved files before committing.</p>}
      <FileGroup title="Staged" files={staged} action="Unstage" onAction={path => void mutate(() => window.oxe.github.unstageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup title="Changes" files={changed} action="Stage" onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup title="Untracked" files={untracked} action="Stage" onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      {!files.length && <div className="git-control-empty"><Check size={16} />Working tree clean</div>}
      <div className="git-control-actions">{(changed.length > 0 || untracked.length > 0) && <button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.stageAll(input))}>Stage all</button>}
        <details><summary>Remote actions <span className="git-control-upstream">{status.upstream ?? 'Upstream not set'}</span><ChevronDown size={14} /></summary><div><button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.fetch(input))}>Fetch</button><button type="button" disabled={busy || !status.ahead} onClick={() => void mutate(() => window.oxe.github.push(input))}><Upload size={12} /> Push</button></div></details></div>
      {staged.length > 0 && <form className="git-control-commit" onSubmit={event => { event.preventDefault(); if (!message.trim()) return; void mutate(async () => { await window.oxe.github.commit({ ...input, message: message.trim() }); setMessage('') }) }}>
        <label htmlFor={`git-control-message-${workspaceId}`}>Commit message</label><TextArea id={`git-control-message-${workspaceId}`} value={message} rows={2} maxLength={1000} placeholder="Describe your changes" onChange={event => setMessage(event.target.value)} />
        {draft && <button type="button" disabled={busy} onClick={() => setMessage(draft().message)}>Draft from conversation</button>}
        <Button variant="primary" type="submit" className="git-control-submit" disabled={busy || !staged.length || !message.trim()}>Commit {staged.length ? `${staged.length} staged` : ''}</Button>
      </form>}
      {draft && status.upstream && <details className="git-control-pr" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open && !pr) { const value = draft(); setPr({ title: value.prTitle, body: value.prBody, draft: true }) } }}>
        <summary>Pull request<ChevronDown size={14} /></summary>
        {pr && <form onSubmit={event => { event.preventDefault(); if (!pr.title.trim()) return; void mutate(async () => {
          const result = await window.oxe.github.createPullRequest({ ...input, title: pr.title.trim(), body: pr.body, draft: pr.draft })
          if (!result.ok) throw Error(result.message || 'The pull request was not created.')
          setNotice(result.message || 'Pull request created.')
        }) }}>
          <label>Title<TextField value={pr.title} maxLength={200} onChange={event => setPr({ ...pr, title: event.target.value })} /></label>
          <label>Description<TextArea value={pr.body} rows={6} maxLength={20000} onChange={event => setPr({ ...pr, body: event.target.value })} /></label>
          <label className="git-control-check"><input type="checkbox" checked={pr.draft} onChange={event => setPr({ ...pr, draft: event.target.checked })} />Open as draft</label>
          {status.ahead ? <p className="git-control-note">Push your {status.ahead} local commit{status.ahead === 1 ? '' : 's'} first so the pull request includes them.</p> : null}
          <Button variant="primary" type="submit" className="git-control-submit" disabled={busy || !pr.title.trim() || Boolean(status.ahead)}>Create pull request</Button>
        </form>}
      </details>}
      {notice && <p role="status" className="git-control-note">{notice}</p>}
    </>}
  </div>
}
