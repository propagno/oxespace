import { FileCode2, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingState } from '../../ui'
import { parseThreadPatch } from '../../../shared/threadPatch'
import type { ThreadArtifact, ThreadFileHunk, ThreadTurnFileStatus } from '../../../shared/types/thread'
import { ThreadPatch } from './ThreadPatch'
import type { ThreadEvent } from '../../../shared/types/thread'
import { changeSummary, threadChanges, turnChanges, type ThreadChangeEntry } from './threadChanges'
import { ThreadHunkReview } from './ThreadHunkReview'
import { humanizeError } from '../../utils/humanizeError'
import { relativeTurnPath } from '../../../shared/threadFilePath'

/** A changed file's path relative to its checkout, with the checkout named when it is not the conversation's root. */
export function TurnPath({ path, roots }: { path: string; roots: Array<string | null | undefined> }) {
  const { label, checkout } = relativeTurnPath(path, roots)
  return <>{checkout && <span className="thread-file-checkout">{checkout}</span>}<span className="thread-file-path">{label}</span></>
}

/** `root` is the conversation's own checkout; `roots` are others it worked in, such as a worktree. */
export function ThreadFileActivity({ event, root, roots = [], threadId, onOpen }: { event: Extract<ThreadEvent, { type: 'tool' }>; root: string; roots?: Array<string | null | undefined>; threadId: string; onOpen(entry: ThreadChangeEntry): void }) {
  const { t } = useTranslation('thread')
  const [expanded, setExpanded] = useState<string | null>(null)
  const verb = (file: ThreadChangeEntry['file']): string => t(`files.verb.${file.state === 'failed' || file.state === 'running' || file.state === 'unknown' ? file.state
    : file.source === 'tool-input' ? 'toolInput' : file.source === 'working-tree-observation' ? 'observed' : file.kind === 'add' || file.kind === 'delete' || file.kind === 'rename' ? file.kind : 'update'}`)
  return <div className="thread-file-activity">{threadChanges([event]).map(entry => <div key={entry.key}><div className="thread-file-operation"><button type="button" className="thread-file-entry" onClick={() => onOpen(entry)} title={entry.file.path}>
    <FileCode2 size={14} /><span className="thread-file-verb">{verb(entry.file)}</span>
    <TurnPath path={entry.file.path} roots={[root, ...roots]} /><FileStats file={entry.file} />
  </button>{entry.file.artifactId && <button type="button" className="thread-file-expand" aria-label={t('files.expand', { path: relativeTurnPath(entry.file.path, [root, ...roots]).label })} aria-expanded={expanded === entry.key} onClick={() => setExpanded(value => value === entry.key ? null : entry.key)}><ChevronRight size={12} /></button>}</div>
    {expanded === entry.key && <ThreadInlineEvidence threadId={threadId} artifactId={entry.file.artifactId!} />}
  </div>)}{event.state === 'failed' && event.output && <ErrorState compact title={event.output} />}</div>
}

function ThreadInlineEvidence({ threadId, artifactId }: { threadId: string; artifactId: string }) {
  const { t } = useTranslation('thread')
  const [artifact, setArtifact] = useState<ThreadArtifact | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setArtifact(null); setError('')
    const api = window.oxe?.thread
    if (!api?.artifact) { setError(t('files.restartDiff')); return }
    void api.artifact(threadId, artifactId).then(value => { if (active) setArtifact(value) }, () => { if (active) setError(t('files.diffFailed')) })
    return () => { active = false }
  }, [threadId, artifactId, revision, t])
  const parsed = artifact && artifact.source !== 'tool-input' ? parseThreadPatch(artifact.content) : null
  return <div className="thread-inline-evidence">{error ? <ErrorState compact title={error} onRetry={() => setRevision(value => value + 1)} retryLabel={t('files.retry')} /> : !artifact ? <LoadingState label={t('files.loadingEvidence')} /> : <>{artifact.truncated && <p>{t('files.incomplete')}</p>}{artifact.source === 'tool-input' && <p>{t('files.toolInput')}</p>}{artifact.source === 'working-tree-observation' && <p>{t('files.observation')}</p>}{parsed?.hunks.length ? <ThreadPatch hunks={parsed.hunks} /> : <pre>{artifact.content}</pre>}</>}</div>
}
export function FileStats({ file }: { file: ThreadChangeEntry['file'] }) {
  return file.additions !== undefined && file.deletions !== undefined && !file.truncated ? <span className="thread-file-stats"><span>+{file.additions}</span><span>−{file.deletions}</span></span> : null
}
const CHANGE_PREVIEW_FILES = 3

// Matches an event's path to a checkpoint path, which is relative to the checkout the turn changed.
const relativeKey = (path: string, roots: Array<string | null | undefined>): string => {
  const label = relativeTurnPath(path, roots).label
  return roots.some(root => root && /^[a-z]:[\\/]/i.test(root)) ? label.toLowerCase() : label
}

export function ThreadTurnChanges({ events, root, roots = [], onOpen, onViewChanges, onUndo, loadFileStates, onUndoFile, loadHunks, onUndoHunk, onComment }: { events: ThreadEvent[]; root: string; roots?: Array<string | null | undefined>; onOpen(entry: ThreadChangeEntry): void; onViewChanges?(): void; onUndo?(): Promise<void>; loadFileStates?(): Promise<ThreadTurnFileStatus[]>; onUndoFile?(path: string): Promise<void>; loadHunks?(path: string): Promise<ThreadFileHunk[]>; onUndoHunk?(path: string, hunkId: string): Promise<void>; onComment?(text: string): void }) {
  const { t } = useTranslation('thread')
  const [showAll, setShowAll] = useState(false)
  const [undo, setUndo] = useState<'idle' | 'confirm' | 'working'>('idle')
  const [undoError, setUndoError] = useState('')
  // Per-file standing of this turn's checkpoint, keyed by repository-relative path.
  const [fileStates, setFileStates] = useState<Record<string, ThreadTurnFileStatus>>({})
  const [undoingFile, setUndoingFile] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  // The checkouts the checkpoints were taken in, so a file edited in a worktree still finds its state.
  const [checkoutRoots, setCheckoutRoots] = useState<string[]>([])
  const allRoots = [root, ...roots, ...checkoutRoots]
  const refreshStates = (): void => {
    if (!loadFileStates) return
    void loadFileStates().then(states => {
      const found = [...new Set(states.flatMap(state => state.root ? [state.root] : []))]
      setCheckoutRoots(found)
      setFileStates(Object.fromEntries(states.map(state => [relativeKey(state.path, [root, ...found]), state])))
    }, () => setFileStates({}))
  }
  // Loaded once per rendered turn and after each undo; the loader is an inline closure, so it is not a dependency.
  useEffect(refreshStates, []) // eslint-disable-line react-hooks/exhaustive-deps
  const entries = turnChanges(events), summary = changeSummary(entries)
  if (!entries.length) return events.some(event => event.type === 'turn-diff') ? <p className="thread-turn-timing">{t('files.noRemaining')}</p> : null
  const files = [...new Map(entries.map(entry => [entry.file.path, entry])).values()]
  const shown = showAll ? files : files.slice(0, CHANGE_PREVIEW_FILES)
  return <section className="thread-change-summary" aria-label={t('files.label')}>
    <header>
      <FileCode2 size={14} aria-hidden="true" />
      <span><strong>{t('files.edited', { count: summary.files })}</strong>{summary.exact ? <FileStats file={{ ...entries[0].file, additions: summary.additions, deletions: summary.deletions }} /> : <small>{t('files.operations', { count: summary.operations })}</small>}</span>
      {onUndo && (undo === 'idle'
        ? <button type="button" className="thread-change-view" onClick={() => { setUndoError(''); setUndo('confirm') }}>{t('files.undo')}</button>
        : <span className="thread-change-confirm" role="group" aria-label={t('files.undoGroup')}>
          <button type="button" className="thread-change-view is-danger" disabled={undo === 'working'} onClick={() => {
            setUndo('working')
            void onUndo().then(() => setUndo('idle'), cause => { setUndoError(humanizeError(cause, t('files.undoFailed'))); setUndo('idle') })
          }}>{undo === 'working' ? t('files.undoing') : t('files.confirmUndo')}</button>
          <button type="button" className="thread-change-view" disabled={undo === 'working'} onClick={() => setUndo('idle')}>{t('common.cancel')}</button>
        </span>)}
      <button type="button" className="thread-change-view" onClick={() => onViewChanges ? onViewChanges() : onOpen(files[0])}>{t('files.view')}</button>
    </header>
    {undoError && <ErrorState compact title={undoError} />}
    <div>{shown.map(entry => {
      const status = fileStates[relativeKey(entry.file.path, allRoots)]
      const label = relativeTurnPath(entry.file.path, allRoots).label
      return <div key={entry.key} className="thread-change-file">
        <button type="button" onClick={() => onOpen(entry)} title={entry.file.path}><span className="thread-change-file-name"><TurnPath path={entry.file.path} roots={allRoots} /></span>{entries.filter(value => value.file.path === entry.file.path).length === 1 && <FileStats file={entry.file} />}</button>
        {status?.state === 'reverted' && <span className="thread-change-file-state">{t('files.reverted')}</span>}
        {status?.state === 'modified' && <span className="thread-change-file-state" title={t('files.editedLaterTitle')}>{t('files.editedLater')}</span>}
        {status?.state === 'pending' && onUndoFile && <button type="button" className="thread-change-view" disabled={undoingFile !== null || undo === 'working'} aria-label={t('files.undoFileLabel', { path: label })} onClick={() => {
          setUndoError(''); setUndoingFile(status.path)
          void onUndoFile(status.path).then(refreshStates, cause => setUndoError(humanizeError(cause, t('files.undoFileFailed')))).finally(() => setUndoingFile(null))
        }}>{undoingFile === status.path ? t('files.undoing') : t('files.undoFile')}</button>}
        {status?.state === 'pending' && loadHunks && onUndoHunk && <button type="button" className="thread-change-view" aria-expanded={reviewing === status.path} aria-label={t('files.reviewLabel', { path: label })} onClick={() => setReviewing(reviewing === status.path ? null : status.path)}>{reviewing === status.path ? t('files.closeReview') : t('files.review')}</button>}
        {reviewing === status?.path && loadHunks && onUndoHunk && <ThreadHunkReview path={status.path} disabled={undoingFile !== null || undo === 'working'} loadHunks={() => loadHunks(status.path)}
          onUndoHunk={async hunkId => { await onUndoHunk(status.path, hunkId); refreshStates() }} onComment={text => onComment?.(text)} />}
      </div>
    })}</div>
    {files.length > CHANGE_PREVIEW_FILES && <button type="button" className="thread-change-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? t('files.showLess') : t('files.showMore', { count: files.length - CHANGE_PREVIEW_FILES })}<ChevronDown size={14} aria-hidden="true" /></button>}
  </section>
}
