import { FileCode2, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { usePathMenu, WithPathMenu } from '../PathMenu/usePathMenu'
import { conversationPathMenu } from '../PathMenu/conversationPathMenu'

/** A changed file's path relative to its checkout, with the checkout named when it is not the conversation's root. */
export function TurnPath({ path, roots }: { path: string; roots: Array<string | null | undefined> }) {
  const { label, checkout } = relativeTurnPath(path, roots)
  return <>{checkout && <span className="thread-file-checkout">{checkout}</span>}<span className="thread-file-path">{label}</span></>
}

/** `root` is the conversation's own checkout; `roots` are others it worked in, such as a worktree. */
export function ThreadFileActivity({ event, root, roots = [], threadId, workspaceId, onOpen }: { event: Extract<ThreadEvent, { type: 'tool' }>; root: string; roots?: Array<string | null | undefined>; threadId: string; workspaceId?: string; onOpen(entry: ThreadChangeEntry): void }) {
  return <div className="thread-file-activity">{threadChanges([event]).map(entry => <FileActivityRow key={entry.key} entry={entry} root={root} roots={roots} threadId={threadId} workspaceId={workspaceId} onOpen={onOpen} />)}{event.state === 'failed' && event.output && <ErrorState compact title={event.output} />}</div>
}

/** One changed file: click opens it in OXESpace; right click or Shift+F10 opens the path menu (F33), for files in the project. */
function FileActivityRow({ entry, root, roots, threadId, workspaceId, onOpen }: { entry: ThreadChangeEntry; root: string; roots: Array<string | null | undefined>; threadId: string; workspaceId?: string; onOpen(entry: ThreadChangeEntry): void }) {
  const { t } = useTranslation('thread')
  const [expanded, setExpanded] = useState(false)
  const verb = (file: ThreadChangeEntry['file']): string => t(`files.verb.${file.state === 'failed' || file.state === 'running' || file.state === 'unknown' ? file.state
    : file.source === 'tool-input' ? 'toolInput' : file.source === 'working-tree-observation' ? 'observed' : file.kind === 'add' || file.kind === 'delete' || file.kind === 'rename' ? file.kind : 'update'}`)
  const target = conversationPathMenu(entry.file.path, workspaceId, root, roots)
  const { menu, onContextMenu } = usePathMenu(target?.request ?? null, { openInOxespace: target?.copyOnly ? undefined : () => onOpen(entry), copyOnly: target?.copyOnly })
  return <div><div className="thread-file-operation"><button type="button" className="thread-file-entry" onClick={() => onOpen(entry)} onContextMenu={onContextMenu} title={entry.file.path}>
    <FileCode2 size={14} /><span className="thread-file-verb">{verb(entry.file)}</span>
    <TurnPath path={entry.file.path} roots={[root, ...roots]} /><FileStats file={entry.file} />
  </button>{menu}{entry.file.artifactId && <button type="button" className="thread-file-expand" aria-label={t('files.expand', { path: relativeTurnPath(entry.file.path, [root, ...roots]).label })} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronRight size={12} /></button>}</div>
    {expanded && <ThreadInlineEvidence threadId={threadId} artifactId={entry.file.artifactId!} />}
  </div>
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
/** Waits before asking again for a turn's file states that came back empty. */
const STATE_RETRY_MS = [800, 2000, 5000]

// Matches an event's path to a checkpoint path, which is relative to the checkout the turn changed.
const relativeKey = (path: string, roots: Array<string | null | undefined>): string => {
  const label = relativeTurnPath(path, roots).label
  return roots.some(root => root && /^[a-z]:[\\/]/i.test(root)) ? label.toLowerCase() : label
}

export function ThreadTurnChanges({ events, root, roots = [], workspaceId, onOpen, onViewChanges, onUndo, loadFileStates, onUndoFile, loadHunks, onUndoHunk, onComment, openFirst = false }: { openFirst?: boolean; events: ThreadEvent[]; root: string; roots?: Array<string | null | undefined>; workspaceId?: string; onOpen(entry: ThreadChangeEntry): void; onViewChanges?(): void; onUndo?(): Promise<void>; loadFileStates?(): Promise<ThreadTurnFileStatus[]>; onUndoFile?(path: string): Promise<void>; loadHunks?(path: string): Promise<ThreadFileHunk[]>; onUndoHunk?(path: string, hunkId: string): Promise<void>; onComment?(text: string): void }) {
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
  // A turn that just ended has its checkpoint finalized a moment later; until then there are no states, and the card
  // had no per-file actions for the rest of its life. An empty answer is asked again, a few times, then left alone.
  useEffect(() => {
    if (!loadFileStates) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number): void => {
      void loadFileStates().then(states => {
        if (!active) return
        const found = [...new Set(states.flatMap(state => state.root ? [state.root] : []))]
        setCheckoutRoots(found)
        setFileStates(Object.fromEntries(states.map(state => [relativeKey(state.path, [root, ...found]), state])))
        if (!states.length && attempt < STATE_RETRY_MS.length) timer = setTimeout(() => load(attempt + 1), STATE_RETRY_MS[attempt])
      }, () => { if (active) setFileStates({}) })
    }
    load(0)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The latest turn shows the change where it is told: the first file still pending opens its first block by itself.
  // Only once, only when its blocks really load, and never over a review the person opened.
  const autoOpened = useRef(false)
  const [openedByItself, setOpenedByItself] = useState<string | null>(null)
  useEffect(() => {
    if (!openFirst || autoOpened.current || !loadHunks || !onUndoHunk) return
    const first = [...new Map(turnChanges(events).map(entry => [entry.file.path, entry])).values()].slice(0, CHANGE_PREVIEW_FILES)
      .map(entry => fileStates[relativeKey(entry.file.path, [root, ...roots, ...checkoutRoots])]).find(status => status?.state === 'pending')
    if (!first) return
    autoOpened.current = true
    let active = true
    void loadHunks(first.path).then(hunks => {
      if (!active || !hunks.length) return
      setOpenedByItself(first.path)
      setReviewing(current => current ?? first.path)
    }, () => undefined)
    return () => { active = false }
  }, [openFirst, fileStates]) // eslint-disable-line react-hooks/exhaustive-deps
  const entries = turnChanges(events), summary = changeSummary(entries)
  if (!entries.length) return events.some(event => event.type === 'turn-diff') ? <p className="thread-turn-timing">{t('files.noRemaining')}</p> : null
  const files = [...new Map(entries.map(entry => [entry.file.path, entry])).values()]
  const shown = showAll ? files : files.slice(0, CHANGE_PREVIEW_FILES)
  // What this turn changed, from its checkpoint, when every file has it. The events count each file against the
  // last commit: after two turns on one file the second card read both turns' lines.
  const own = (entry: ThreadChangeEntry): { additions: number; deletions: number } | undefined => {
    const status = fileStates[relativeKey(entry.file.path, allRoots)]
    return status?.additions !== undefined && status.deletions !== undefined ? { additions: status.additions, deletions: status.deletions } : undefined
  }
  const owned = files.map(own)
  const turnTotal = owned.every(Boolean) ? { additions: owned.reduce((sum, value) => sum + value!.additions, 0), deletions: owned.reduce((sum, value) => sum + value!.deletions, 0) } : undefined
  return <section className="thread-change-summary" aria-label={t('files.label')}>
    <header>
      <FileCode2 size={14} aria-hidden="true" />
      <span><strong>{t('files.edited', { count: summary.files })}</strong>{turnTotal ? <FileStats file={{ ...entries[0].file, ...turnTotal, truncated: false }} /> : summary.exact ? <FileStats file={{ ...entries[0].file, additions: summary.additions, deletions: summary.deletions }} /> : <small>{t('files.operations', { count: summary.operations })}</small>}</span>
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
        {/* F33: the path menu on a changed file of the conversation's project. */}
        <WithPathMenu {...(() => { const target = conversationPathMenu(entry.file.path, workspaceId, root, allRoots); return { request: target?.request ?? null, copyOnly: target?.copyOnly } })()} openInOxespace={() => onOpen(entry)}
          render={onContextMenu => <button type="button" onClick={() => onOpen(entry)} onContextMenu={onContextMenu} title={entry.file.path}><span className="thread-change-file-name"><TurnPath path={entry.file.path} roots={allRoots} /></span>{own(entry) ? <FileStats file={{ ...entry.file, ...own(entry), truncated: false }} /> : entries.filter(value => value.file.path === entry.file.path).length === 1 && <FileStats file={entry.file} />}</button>} />
        {status?.state === 'reverted' && <span className="thread-change-file-state">{t('files.reverted')}</span>}
        {status?.state === 'modified' && <span className="thread-change-file-state" title={t('files.editedLaterTitle')}>{t('files.editedLater')}</span>}
        {status?.state === 'pending' && onUndoFile && <button type="button" className="thread-change-view" disabled={undoingFile !== null || undo === 'working'} aria-label={t('files.undoFileLabel', { path: label })} onClick={() => {
          setUndoError(''); setUndoingFile(status.path)
          void onUndoFile(status.path).then(refreshStates, cause => setUndoError(humanizeError(cause, t('files.undoFileFailed')))).finally(() => setUndoingFile(null))
        }}>{undoingFile === status.path ? t('files.undoing') : t('files.undoFile')}</button>}
        {status?.state === 'pending' && loadHunks && onUndoHunk && <button type="button" className="thread-change-view" aria-expanded={reviewing === status.path} aria-label={t('files.reviewLabel', { path: label })} onClick={() => { setOpenedByItself(null); setReviewing(reviewing === status.path ? null : status.path) }}>{reviewing === status.path ? t('files.closeReview') : t('files.review')}</button>}
        {reviewing === status?.path && loadHunks && onUndoHunk && <ThreadHunkReview key={`${status.path}:${openedByItself === status.path}`} firstOnly={openedByItself === status.path} path={status.path} disabled={undoingFile !== null || undo === 'working'} loadHunks={() => loadHunks(status.path)}
          onUndoHunk={async hunkId => { await onUndoHunk(status.path, hunkId); refreshStates() }} onComment={text => onComment?.(text)} />}
      </div>
    })}</div>
    {files.length > CHANGE_PREVIEW_FILES && <button type="button" className="thread-change-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? t('files.showLess') : t('files.showMore', { count: files.length - CHANGE_PREVIEW_FILES })}<ChevronDown size={14} aria-hidden="true" /></button>}
  </section>
}
