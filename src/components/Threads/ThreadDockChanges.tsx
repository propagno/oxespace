import { Check, ChevronDown, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, ErrorState, IconButton, Spinner } from '../../ui'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { humanizeError } from '../../utils/humanizeError'

/** One file a turn changed that is still as the turn left it: not undone, not edited since, not kept. */
export interface PendingChange { turnId: string; path: string; additions?: number; deletions?: number }

/** How many of the latest turns are checked; older turns are reviewed in place. */
const TURNS_CHECKED = 20

const keptKey = (threadId: string): string => `oxe.thread.kept:${threadId}`
const changeKey = (change: PendingChange): string => `${change.turnId}|${change.path}`

/** Files kept ("reviewed") in this conversation. Stored per viewer; storage can be missing, so failures mean none. */
function readKept(threadId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(keptKey(threadId)) ?? '[]') as string[]) } catch { return new Set() }
}

function writeKept(threadId: string, kept: Set<string>): void {
  try { localStorage.setItem(keptKey(threadId), JSON.stringify([...kept].slice(-2000))) } catch { /* private mode */ }
}

/**
 * Collects the changes still pending review across the latest finished turns: newest turn first, one entry
 * per file and turn, minus what the person kept. Pure, for tests.
 */
export function pendingChanges(results: Array<{ turnId: string; files: Array<{ path: string; state: string; additions?: number; deletions?: number }> }>, kept: ReadonlySet<string>): PendingChange[] {
  return [...results].reverse().flatMap(({ turnId, files }) => files
    .filter(file => file.state === 'pending')
    .map(file => ({
      turnId,
      path: file.path,
      ...(file.additions !== undefined ? { additions: file.additions } : {}),
      ...(file.deletions !== undefined ? { deletions: file.deletions } : {})
    }))
    .filter(change => !kept.has(changeKey(change))))
}

/**
 * Every file the agent changed that has not been reviewed yet, above the composer, across turns — as the
 * changed-files list above VS Code's chat input. Keep marks a file reviewed; Undo restores it from that
 * turn's checkpoint, which refuses when the file changed afterwards.
 */
export function ThreadDockChanges({ snapshot, running, onViewChanges }: { snapshot: ThreadSnapshot; running: boolean; onViewChanges(path?: string): void }) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const threadId = snapshot.thread.id
  const [changes, setChanges] = useState<PendingChange[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [confirmUndoAll, setConfirmUndoAll] = useState(false)
  const listId = useId()
  const finished = (snapshot.turns ?? []).filter(turn => turn.status !== 'running').slice(-TURNS_CHECKED).map(turn => turn.id)
  const finishedKey = finished.join('|')

  const load = useCallback(async (): Promise<void> => {
    if (!api?.turnFiles || running) return
    const turnIds = finishedKey ? finishedKey.split('|') : []
    const results = await Promise.all(turnIds.map(turnId => api.turnFiles!(threadId, turnId).then(files => ({ turnId, files }), () => ({ turnId, files: [] }))))
    setChanges(pendingChanges(results, readKept(threadId)))
  }, [api, running, finishedKey, threadId])

  useEffect(() => { void load() }, [load, snapshot.thread.updatedAt])

  if (!changes.length || running) return null
  const keep = (selected: PendingChange[]): void => {
    const kept = readKept(threadId)
    for (const change of selected) kept.add(changeKey(change))
    writeKept(threadId, kept)
    setChanges(current => current.filter(change => !kept.has(changeKey(change))))
  }
  const undo = async (selected: PendingChange[]): Promise<void> => {
    if (!api?.undoTurnFile) return
    setError('')
    setBusy(selected.length === 1 ? changeKey(selected[0]) : 'all')
    try {
      // Newest turn first, so each restore finds the file as that turn left it.
      for (const change of selected) await api.undoTurnFile(threadId, change.turnId, change.path)
    } catch (cause) {
      setError(humanizeError(cause, t('dockChanges.undoFailed')))
    } finally {
      setBusy(null)
      await load()
    }
  }
  const files = new Set(changes.map(change => change.path)).size
  const totalAdditions = changes.reduce((sum, change) => sum + (change.additions ?? 0), 0)
  const totalDeletions = changes.reduce((sum, change) => sum + (change.deletions ?? 0), 0)

  // A header with one toggle and the actions beside it: controls are never nested inside the toggle.
  return <section className="thread-dock-changes" data-ui="working-set" data-testid="thread-dock-changes" data-open={open ? 'true' : undefined} data-has-error={error ? 'true' : undefined} aria-label={t('dockChanges.label')}>
    <div className="thread-dock-changes-header">
      <Button variant="ghost" size="sm" className="thread-dock-changes-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={14} aria-hidden="true" className="thread-dock-changes-chevron" />
        <span className="thread-dock-changes-summary">
          <strong>{t('dockChanges.files', { count: files })}</strong>
          {totalAdditions > 0 && <>{' '}<span className="thread-working-set-add">+{totalAdditions}</span></>}
          {totalDeletions > 0 && <>{' '}<span className="thread-working-set-del">−{totalDeletions}</span></>}
        </span>
      </Button>
      <span className="thread-dock-changes-actions">
        <Button variant="ghost" size="sm" aria-label={t('dockChanges.keepAll')} title={t('dockChanges.keepAll')} disabled={busy !== null} icon={<Check size={13} aria-hidden="true" />} onClick={() => keep(changes)}><span className="thread-dock-changes-action-label">{t('dockChanges.keepAll')}</span></Button>
        <Button variant="ghost" size="sm" aria-label={t('dockChanges.undoAll')} title={t('dockChanges.undoAll')} disabled={busy !== null || !api?.undoTurnFile} icon={busy === 'all' ? <Spinner size="sm" decorative /> : <Undo2 size={13} aria-hidden="true" />} onClick={() => setConfirmUndoAll(true)}><span className="thread-dock-changes-action-label">{t('dockChanges.undoAll')}</span></Button>
        <Button variant="ghost" size="sm" onClick={() => onViewChanges()}>{t('files.view')}</Button>
      </span>
    </div>
    {error && <ErrorState compact title={error} />}
    <ul id={listId} hidden={!open}>{changes.map(change => <li key={changeKey(change)} data-ui="working-set-file">
      <Button type="button" variant="ghost" size="sm" className="thread-dock-changes-path" title={change.path} onClick={() => onViewChanges(change.path)}>{change.path}</Button>
      {((change.additions ?? 0) > 0 || (change.deletions ?? 0) > 0) && <span className="thread-working-set-stats">
        {(change.additions ?? 0) > 0 && <span className="thread-working-set-add">+{change.additions}</span>}
        {(change.additions ?? 0) > 0 && (change.deletions ?? 0) > 0 && ' '}
        {(change.deletions ?? 0) > 0 && <span className="thread-working-set-del">−{change.deletions}</span>}
      </span>}
      <IconButton size="sm" label={t('dockChanges.keep', { path: change.path })} title={t('dockChanges.keep', { path: change.path })} disabled={busy !== null} icon={<Check size={13} aria-hidden="true" />} onClick={() => keep([change])} />
      <IconButton size="sm" label={t('dockChanges.undo', { path: change.path })} title={t('dockChanges.undo', { path: change.path })} disabled={busy !== null || !api?.undoTurnFile} icon={busy === changeKey(change) ? <Spinner size="sm" label={t('dockChanges.undoing')} /> : <Undo2 size={13} aria-hidden="true" />} onClick={() => void undo([change])} />
    </li>)}</ul>
    {confirmUndoAll && <ConfirmDialog
      title={t('dockChanges.undoAllTitle', { count: files })}
      description={t('dockChanges.undoAllDescription', { count: files })}
      confirmLabel={t('dockChanges.undoAllConfirm')}
      cancelLabel={t('common.cancel')}
      danger
      busy={busy === 'all'}
      onConfirm={() => { setConfirmUndoAll(false); void undo(changes) }}
      onCancel={() => setConfirmUndoAll(false)}
    />}
  </section>
}
