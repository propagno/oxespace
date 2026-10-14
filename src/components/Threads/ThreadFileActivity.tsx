import { FileCode2, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { parseThreadPatch } from '../../../shared/threadPatch'
import type { ThreadArtifact, ThreadFileHunk, ThreadTurnFileStatus } from '../../../shared/types/thread'
import { ThreadPatch } from './ThreadPatch'
import type { ThreadEvent } from '../../../shared/types/thread'
import { changeSummary, threadChanges, turnChanges, threadFileLabel, type ThreadChangeEntry } from './threadChanges'
import { ThreadHunkReview } from './ThreadHunkReview'

export function ThreadFileActivity({ event, root, threadId, onOpen }: { event: Extract<ThreadEvent, { type: 'tool' }>; root: string; threadId: string; onOpen(entry: ThreadChangeEntry): void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return <div className="thread-file-activity">{threadChanges([event]).map(entry => <div key={entry.key}><div className="thread-file-operation"><button type="button" className="thread-file-entry" onClick={() => onOpen(entry)} title={entry.file.path}>
    <FileCode2 size={14} /><span className="thread-file-verb">{entry.file.state === 'failed' ? 'Failed' : entry.file.state === 'running' ? 'Updating' : entry.file.state === 'unknown' ? 'Unconfirmed' : entry.file.source === 'tool-input' ? 'Tool completed' : entry.file.source === 'working-tree-observation' ? 'Observed' : entry.file.kind === 'add' ? 'Added' : entry.file.kind === 'delete' ? 'Deleted' : entry.file.kind === 'rename' ? 'Renamed' : 'Edited'}</span>
    <span className="thread-file-path">{threadFileLabel(entry.file.path, root)}</span><FileStats file={entry.file} />
  </button>{entry.file.artifactId && <button type="button" className="thread-file-expand" aria-label={`Expand file diff ${threadFileLabel(entry.file.path, root)}`} aria-expanded={expanded === entry.key} onClick={() => setExpanded(value => value === entry.key ? null : entry.key)}><ChevronRight size={12} /></button>}</div>
    {expanded === entry.key && <ThreadInlineEvidence threadId={threadId} artifactId={entry.file.artifactId!} />}
  </div>)}{event.state === 'failed' && event.output && <p className="thread-file-error" role="alert">{event.output}</p>}</div>
}

function ThreadInlineEvidence({ threadId, artifactId }: { threadId: string; artifactId: string }) {
  const [artifact, setArtifact] = useState<ThreadArtifact | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setArtifact(null); setError('')
    const api = window.oxe?.thread
    if (!api?.artifact) { setError('Restart the updated application to load this diff.'); return }
    void api.artifact(threadId, artifactId).then(value => { if (active) setArtifact(value) }, () => { if (active) setError('Could not load this diff.') })
    return () => { active = false }
  }, [threadId, artifactId, revision])
  const parsed = artifact && artifact.source !== 'tool-input' ? parseThreadPatch(artifact.content) : null
  return <div className="thread-inline-evidence">{error ? <div role="alert">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div> : !artifact ? <p role="status">Loading file evidence…</p> : <>{artifact.truncated && <p>Incomplete evidence; totals are unavailable.</p>}{artifact.source === 'tool-input' && <p>Tool input; this is not a verified disk diff.</p>}{artifact.source === 'working-tree-observation' && <p>Verified working-tree observation; authorship is indeterminate.</p>}{parsed?.hunks.length ? <ThreadPatch hunks={parsed.hunks} /> : <pre>{artifact.content}</pre>}</>}</div>
}
export function FileStats({ file }: { file: ThreadChangeEntry['file'] }) {
  return file.additions !== undefined && file.deletions !== undefined && !file.truncated ? <span className="thread-file-stats"><span>+{file.additions}</span><span>−{file.deletions}</span></span> : null
}
const CHANGE_PREVIEW_FILES = 3

const relativeKey = (path: string, root: string): string => {
  const label = threadFileLabel(path, root).replace(/\\/g, '/').replace(/^\.\//, '')
  return /^[a-z]:\//i.test(root.replace(/\\/g, '/')) ? label.toLowerCase() : label
}

export function ThreadTurnChanges({ events, root, onOpen, onViewChanges, onUndo, loadFileStates, onUndoFile, loadHunks, onUndoHunk, onComment }: { events: ThreadEvent[]; root: string; onOpen(entry: ThreadChangeEntry): void; onViewChanges?(): void; onUndo?(): Promise<void>; loadFileStates?(): Promise<ThreadTurnFileStatus[]>; onUndoFile?(path: string): Promise<void>; loadHunks?(path: string): Promise<ThreadFileHunk[]>; onUndoHunk?(path: string, hunkId: string): Promise<void>; onComment?(text: string): void }) {
  const [showAll, setShowAll] = useState(false)
  const [undo, setUndo] = useState<'idle' | 'confirm' | 'working'>('idle')
  const [undoError, setUndoError] = useState('')
  // Per-file standing of this turn's checkpoint, keyed by repository-relative path.
  const [fileStates, setFileStates] = useState<Record<string, ThreadTurnFileStatus>>({})
  const [undoingFile, setUndoingFile] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const refreshStates = (): void => {
    if (!loadFileStates) return
    void loadFileStates().then(states => setFileStates(Object.fromEntries(states.map(state => [relativeKey(state.path, root), state]))), () => setFileStates({}))
  }
  // Loaded once per rendered turn and after each undo; the loader is an inline closure, so it is not a dependency.
  useEffect(refreshStates, []) // eslint-disable-line react-hooks/exhaustive-deps
  const entries = turnChanges(events), summary = changeSummary(entries)
  if (!entries.length) return events.some(event => event.type === 'turn-diff') ? <p className="thread-turn-timing">No remaining file changes in the provider’s final turn diff.</p> : null
  const files = [...new Map(entries.map(entry => [entry.file.path, entry])).values()]
  const shown = showAll ? files : files.slice(0, CHANGE_PREVIEW_FILES)
  return <section className="thread-change-summary" aria-label="Changed files">
    <header>
      <FileCode2 size={14} aria-hidden="true" />
      <span><strong>Edited {summary.files} {summary.files === 1 ? 'file' : 'files'}</strong>{summary.exact ? <FileStats file={{ ...entries[0].file, additions: summary.additions, deletions: summary.deletions }} /> : <small>{summary.operations} {summary.operations === 1 ? 'operation' : 'operations'}</small>}</span>
      {onUndo && (undo === 'idle'
        ? <button type="button" className="thread-change-view" onClick={() => { setUndoError(''); setUndo('confirm') }}>Undo</button>
        : <span className="thread-change-confirm" role="group" aria-label="Confirm undo">
          <button type="button" className="thread-change-view is-danger" disabled={undo === 'working'} onClick={() => {
            setUndo('working')
            void onUndo().then(() => setUndo('idle'), cause => { setUndoError(cause instanceof Error ? cause.message : 'Could not undo these changes.'); setUndo('idle') })
          }}>{undo === 'working' ? 'Undoing…' : 'Confirm undo'}</button>
          <button type="button" className="thread-change-view" disabled={undo === 'working'} onClick={() => setUndo('idle')}>Cancel</button>
        </span>)}
      <button type="button" className="thread-change-view" onClick={() => onViewChanges ? onViewChanges() : onOpen(files[0])}>View changes</button>
    </header>
    {undoError && <p role="alert" className="thread-change-error">{undoError}</p>}
    <div>{shown.map(entry => {
      const status = fileStates[relativeKey(entry.file.path, root)]
      return <div key={entry.key} className="thread-change-file">
        <button type="button" onClick={() => onOpen(entry)} title={entry.file.path}><span className="thread-file-path">{threadFileLabel(entry.file.path, root)}</span>{entries.filter(value => value.file.path === entry.file.path).length === 1 && <FileStats file={entry.file} />}</button>
        {status?.state === 'reverted' && <span className="thread-change-file-state">Reverted</span>}
        {status?.state === 'modified' && <span className="thread-change-file-state" title="Edited after this turn; undo would discard that later work">Edited later</span>}
        {status?.state === 'pending' && onUndoFile && <button type="button" className="thread-change-view" disabled={undoingFile !== null || undo === 'working'} aria-label={`Undo ${threadFileLabel(entry.file.path, root)}`} onClick={() => {
          setUndoError(''); setUndoingFile(status.path)
          void onUndoFile(status.path).then(refreshStates, cause => setUndoError(cause instanceof Error ? cause.message : 'Could not undo this file.')).finally(() => setUndoingFile(null))
        }}>{undoingFile === status.path ? 'Undoing…' : 'Undo file'}</button>}
        {status?.state === 'pending' && loadHunks && onUndoHunk && <button type="button" className="thread-change-view" aria-expanded={reviewing === status.path} aria-label={`Review changes in ${threadFileLabel(entry.file.path, root)}`} onClick={() => setReviewing(reviewing === status.path ? null : status.path)}>{reviewing === status.path ? 'Close review' : 'Review'}</button>}
        {reviewing === status?.path && loadHunks && onUndoHunk && <ThreadHunkReview path={status.path} disabled={undoingFile !== null || undo === 'working'} loadHunks={() => loadHunks(status.path)}
          onUndoHunk={async hunkId => { await onUndoHunk(status.path, hunkId); refreshStates() }} onComment={text => onComment?.(text)} />}
      </div>
    })}</div>
    {files.length > CHANGE_PREVIEW_FILES && <button type="button" className="thread-change-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Show less' : `Show ${files.length - CHANGE_PREVIEW_FILES} more`}<ChevronDown size={14} aria-hidden="true" /></button>}
  </section>
}
