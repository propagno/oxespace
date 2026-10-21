import { useEffect, useState } from 'react'
import { GitCompare } from 'lucide-react'
import type { ThreadSnapshot, ThreadTurnFileStatus } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { humanizeError } from '../../utils/humanizeError'
import { EmptyState } from '../../ui'
import { ThreadHunkReview } from './ThreadHunkReview'
import { TurnPath } from './ThreadFileActivity'
import { threadChanges } from './threadChanges'

const folderName = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) ?? path
const STATE_LABEL: Record<ThreadTurnFileStatus['state'], string> = { pending: '', reverted: 'Reverted', modified: 'Edited later' }

/**
 * Changes for one turn: exactly the files it changed, in the checkout where it changed them
 * (a worktree included), from the turn's checkpoint, the same record Undo uses.
 */
export function ThreadTurnReview({ snapshot, turnId, onShowAll, onComment }: {
  snapshot: ThreadSnapshot
  turnId: string
  onShowAll(): void
  onComment(text: string): void
}) {
  const api = window.oxe?.thread
  const id = snapshot.thread.id
  const [files, setFiles] = useState<ThreadTurnFileStatus[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    if (!api?.turnFiles) { setFiles([]); return }
    void api.turnFiles(id, turnId).then(value => {
      if (!active) return
      setFiles(value)
      setSelected(current => current && value.some(file => file.path === current) ? current : value[0]?.path ?? null)
    }, cause => { if (active) { setFiles([]); setError(humanizeError(cause, 'Could not load this turn’s changes.')) } })
    return () => { active = false }
  }, [api, id, turnId, revision])
  const turn = snapshot.turns?.find(value => value.id === turnId)
  const running = snapshot.thread.status === 'running'
  const checkout = files?.find(file => file.root)?.root
  const roots = [snapshot.thread.rootPath, checkout]
  // Without a checkpoint, the turn's own events still say which files it touched.
  const reported = [...new Set(threadChanges(snapshot.events.filter(event => event.type === 'tool' && event.turnId === turnId)).map(entry => entry.file.path))]
  const current = files?.find(file => file.path === selected)
  return <div className="thread-turn-review">
    <header className="thread-turn-review-heading">
      <div>
        <strong>{turn ? `Turn ${turn.sequence}` : 'This turn'}</strong>
        <small title={checkout ?? snapshot.thread.rootPath}>{files ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'Loading…'}{checkout && ` · in ${folderName(checkout)}`}</small>
      </div>
      <button type="button" className="thread-change-view" onClick={onShowAll} title="Show every change on the branch, not only this turn's"><GitCompare size={13} aria-hidden="true" />All changes</button>
    </header>
    {error && <p role="alert" className="thread-change-error">{error}</p>}
    {files === null ? <EmptyState compact title="Loading this turn’s changes…" />
      : !files.length ? <div className="thread-turn-review-empty">
        <p>{reported.length ? 'This turn’s changes were not recorded for review, so they cannot be shown as a diff here. It reported these files:' : 'No file changes were recorded for this turn.'}</p>
        {reported.length > 0 && <ul>{reported.map(path => <li key={path} title={path}><TurnPath path={path} roots={[...roots, snapshot.thread.observedLocation?.checkoutRoot]} /></li>)}</ul>}
      </div>
      : <>
        <ul className="thread-turn-review-files" aria-label="Files changed in this turn">{files.map(file => <li key={file.path}>
          <button type="button" aria-current={file.path === selected || undefined} title={file.root ? `${file.root.replace(/[\\/]+$/, '')}/${file.path}` : file.path} onClick={() => setSelected(file.path)}>
            <span className="thread-change-file-name"><TurnPath path={file.path} roots={roots} /></span>
            {STATE_LABEL[file.state] && <span className="thread-change-file-state">{STATE_LABEL[file.state]}</span>}
            {!file.postExists && <span className="thread-change-file-state">Deleted</span>}
            {!file.preExists && file.postExists && <span className="thread-change-file-state">Added</span>}
          </button>
        </li>)}</ul>
        {current && <div className="thread-turn-review-diff">
          {current.state === 'pending'
            ? <ThreadHunkReview key={`${current.path}:${revision}`} path={current.path} disabled={running || !api?.undoTurnHunk} loadHunks={() => api!.turnFileHunks ? api!.turnFileHunks(id, turnId, current.path) : Promise.resolve([])}
              onUndoHunk={async hunkId => { await api!.undoTurnHunk!(id, turnId, current.path, hunkId); await useThreadStore.getState().refresh(id); setRevision(value => value + 1) }} onComment={onComment} />
            : <p className="thread-hunk-note">{current.state === 'reverted' ? 'This file is back to how it was before the turn.' : 'This file was edited after the turn, so the turn’s own change can no longer be shown on its own. Use All changes to see the file as it is.'}</p>}
        </div>}
      </>}
  </div>
}
