import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileCode2, GitBranch, RefreshCw, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitControlFile, GitControlStatus } from '../../../shared/types/git'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import './GitControlPanel.css'
import { Button, TextArea, TextField, EmptyState, ErrorState, LoadingState, Spinner } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import { humanizeError } from '../../utils/humanizeError'

type Props = {
  workspaceId: string; rootPath: string; onOpenFile?: (path: string) => void
  /** Commit message and pull request drafted from a conversation, offered for editing. */
  draft?: () => { message: string; prTitle: string; prBody: string }
}

function FileGroup({ id, title, files, action, onAction, onOpenFile }: {
  id: string; title: string; files: GitControlFile[]; action?: string; onAction?: (path: string) => void; onOpenFile?: (path: string) => void
}) {
  const { t } = useTranslation('code')
  if (!files.length) return null
  return <section className="git-control-group" aria-labelledby={`git-control-${id}`}><h3 id={`git-control-${id}`}>{title}<span>{files.length}</span></h3>
    {files.map(file => <div className="git-control-file" key={`${id}:${file.path}`}>
      <button type="button" className="git-control-file-name" title={t('git.control.open', { path: file.path })} onClick={() => onOpenFile?.(file.path)}><FileCode2 size={14} aria-hidden="true" /><span>{file.path}</span></button>
      <span className="git-control-file-status" title={file.status}>{file.untracked ? 'U' : file.conflicted ? '!' : file.status.replace(/\./g, '').slice(0, 2)}</span>
      {action && <button type="button" className="git-control-file-action" aria-label={`${action} ${file.path}`} title={`${action} ${file.path}`} onClick={() => onAction?.(file.path)}>{action}</button>}
    </div>)}
  </section>
}

/** Local Git surface: no GitHub CLI, network request or history prefetch on open. */
export function GitControlPanel({ workspaceId, rootPath, onOpenFile, draft }: Props) {
  const { t } = useTranslation('code')
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
    } catch (cause) { if (generation === request.current) setError(humanizeError(cause)) }
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
    catch (cause) { setError(humanizeError(cause)) }
    finally { setBusy(false) }
  }
  const files = status?.files ?? []
  const staged = files.filter(file => file.staged && !file.conflicted)
  const changed = files.filter(file => file.unstaged && !file.untracked && !file.conflicted)
  const untracked = files.filter(file => file.untracked)
  const conflicts = files.filter(file => file.conflicted)
  return <div className="git-control" aria-busy={refreshing || busy}>
    <header className="git-control-heading"><div><strong><GitBranch size={14} aria-hidden="true" />{status?.branch ?? t('git.control.title')}</strong><small>{status?.ahead ? `↑ ${status.ahead}` : ''}{status?.behind ? ` ↓ ${status.behind}` : ''}</small></div>
      <button type="button" aria-label={t('git.control.refresh')} title={t('git.control.refresh')} onClick={() => void refresh()} disabled={refreshing || busy}>{refreshing ? <Spinner size="sm" decorative /> : <RefreshCw size={14} aria-hidden="true" />}</button>
    </header>
    {error && <ErrorState compact title={status ? t('git.control.actionFailed') : t('git.control.statusFailed')} message={error} onRetry={status ? undefined : () => void refresh()} />}
    {status?.truncated && <p role="status" className="git-control-note">{t('git.control.truncated', { count: formatNumber(1000) })}</p>}
    {!status && !error && <LoadingState label={t('git.control.reading')} />}
    {status && !status.error && <>
      <FileGroup id="conflicts" title={t('git.control.conflicts')} files={conflicts} onOpenFile={openFile} />
      {conflicts.length > 0 && <p className="git-control-note">{t('git.control.conflictsHint')}</p>}
      <FileGroup id="staged" title={t('git.control.staged')} files={staged} action={t('git.control.unstage')} onAction={path => void mutate(() => window.oxe.github.unstageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup id="changed" title={t('git.control.changes')} files={changed} action={t('git.control.stage')} onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      <FileGroup id="untracked" title={t('git.control.untracked')} files={untracked} action={t('git.control.stage')} onAction={path => void mutate(() => window.oxe.github.stageFile({ ...input, path }))} onOpenFile={openFile} />
      {!files.length && <EmptyState compact icon={<Check size={16} />} title={t('git.control.clean')} />}
      <div className="git-control-actions">{(changed.length > 0 || untracked.length > 0) && <button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.stageAll(input))}>{t('git.control.stageAll')}</button>}
        <details><summary>{t('git.control.remote')} <span className="git-control-upstream">{status.upstream ?? t('git.control.noUpstream')}</span><ChevronDown size={14} aria-hidden="true" /></summary><div>
          <button type="button" disabled={busy} onClick={() => void mutate(() => window.oxe.github.fetch(input))}>{t('git.control.fetch')}</button>
          <button type="button" disabled={busy || !status.ahead || !status.upstream} title={!status.upstream ? t('git.control.pushNoUpstream') : !status.ahead ? t('git.control.pushNothing') : undefined} onClick={() => void mutate(() => window.oxe.github.push(input))}><Upload size={12} aria-hidden="true" /> {t('git.control.push')}</button>
        </div></details></div>
      {staged.length > 0 && <form className="git-control-commit" onSubmit={event => { event.preventDefault(); if (!message.trim()) return; void mutate(async () => { await window.oxe.github.commit({ ...input, message: message.trim() }); setMessage('') }) }}>
        <label htmlFor={`git-control-message-${workspaceId}`}>{t('git.control.message')}</label><TextArea id={`git-control-message-${workspaceId}`} value={message} rows={2} maxLength={1000} placeholder={t('git.control.messagePlaceholder')} onChange={event => setMessage(event.target.value)} />
        {draft && <button type="button" disabled={busy} onClick={() => setMessage(draft().message)}>{t('git.control.draft')}</button>}
        <Button variant="primary" type="submit" className="git-control-submit" disabled={busy || !staged.length || !message.trim()}>{t('git.control.commit', { count: staged.length })}</Button>
      </form>}
      {draft && status.upstream && <details className="git-control-pr" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open && !pr) { const value = draft(); setPr({ title: value.prTitle, body: value.prBody, draft: true }) } }}>
        <summary>{t('git.control.pr')}<ChevronDown size={14} aria-hidden="true" /></summary>
        {pr && <form onSubmit={event => { event.preventDefault(); if (!pr.title.trim()) return; void mutate(async () => {
          const result = await window.oxe.github.createPullRequest({ ...input, title: pr.title.trim(), body: pr.body, draft: pr.draft })
          if (!result.ok) throw Error(result.message || t('git.control.prFailed'))
          setNotice(result.message || t('git.control.prCreated'))
        }) }}>
          <label>{t('git.control.prTitle')}<TextField value={pr.title} maxLength={200} onChange={event => setPr({ ...pr, title: event.target.value })} /></label>
          <label>{t('git.control.prBody')}<TextArea value={pr.body} rows={6} maxLength={20000} onChange={event => setPr({ ...pr, body: event.target.value })} /></label>
          <label className="git-control-check"><input type="checkbox" checked={pr.draft} onChange={event => setPr({ ...pr, draft: event.target.checked })} />{t('git.control.prDraft')}</label>
          {status.ahead ? <p className="git-control-note">{t('git.control.pushFirst', { count: status.ahead })}</p> : null}
          <Button variant="primary" type="submit" className="git-control-submit" disabled={busy || !pr.title.trim() || Boolean(status.ahead)}>{t('git.control.prCreate')}</Button>
        </form>}
      </details>}
      {notice && <p role="status" className="git-control-note">{notice}</p>}
    </>}
  </div>
}
