import { useEffect, useState } from 'react'
import { GitCompare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot, ThreadTurnFileStatus } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { humanizeError } from '../../utils/humanizeError'
import { EmptyState, ErrorState, LoadingState } from '../../ui'
import { ThreadHunkReview } from './ThreadHunkReview'
import { TurnPath } from './ThreadFileActivity'
import { threadChanges } from './threadChanges'

const folderName = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) ?? path

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
  const { t } = useTranslation('thread')
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
    }, cause => { if (active) { setFiles([]); setError(humanizeError(cause, t('turnReview.loadFailed'))) } })
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
        <strong>{turn ? t('turnReview.turn', { number: turn.sequence }) : t('turnReview.thisTurn')}</strong>
        <small title={checkout ?? snapshot.thread.rootPath}>{files ? t('turnReview.files', { count: files.length }) : t('common.loading')}{checkout && t('turnReview.in', { folder: folderName(checkout) })}</small>
      </div>
      <button type="button" className="thread-change-view" onClick={onShowAll} title={t('turnReview.allTitle')}><GitCompare size={13} aria-hidden="true" />{t('turnReview.all')}</button>
    </header>
    {error && <ErrorState compact title={error} />}
    {files === null ? <LoadingState label={t('turnReview.loading')} />
      : !files.length ? <EmptyState compact title={reported.length ? t('turnReview.notRecorded') : t('turnReview.none')}>
        {reported.length > 0 && <span className="thread-turn-review-reported">{reported.map(path => <span key={path} title={path}><TurnPath path={path} roots={[...roots, snapshot.thread.observedLocation?.checkoutRoot]} /></span>)}</span>}
      </EmptyState>
      : <>
        <ul className="thread-turn-review-files" aria-label={t('turnReview.files')}>{files.map(file => <li key={file.path}>
          <button type="button" aria-current={file.path === selected || undefined} title={file.root ? `${file.root.replace(/[\\/]+$/, '')}/${file.path}` : file.path} onClick={() => setSelected(file.path)}>
            <span className="thread-change-file-name"><TurnPath path={file.path} roots={roots} /></span>
            {file.state !== 'pending' && <span className="thread-change-file-state">{t(`turnReview.${file.state}`)}</span>}
            {!file.postExists && <span className="thread-change-file-state">{t('turnReview.deleted')}</span>}
            {!file.preExists && file.postExists && <span className="thread-change-file-state">{t('turnReview.added')}</span>}
          </button>
        </li>)}</ul>
        {current && <div className="thread-turn-review-diff">
          {current.state === 'pending'
            ? <ThreadHunkReview key={`${current.path}:${revision}`} path={current.path} disabled={running || !api?.undoTurnHunk} loadHunks={() => api!.turnFileHunks ? api!.turnFileHunks(id, turnId, current.path) : Promise.resolve([])}
              onUndoHunk={async hunkId => { await api!.undoTurnHunk!(id, turnId, current.path, hunkId); await useThreadStore.getState().refresh(id); setRevision(value => value + 1) }} onComment={onComment} />
            : <EmptyState compact title={current.state === 'reverted' ? t('turnReview.backToBefore') : t('turnReview.editedAfter')} />}
        </div>}
      </>}
  </div>
}
