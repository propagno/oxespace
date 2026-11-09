import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, toast } from '../../ui'
import { i18n } from '../../i18n'
import { THREAD_PLACE_LIMITS, type ThreadPlace, type ThreadPlaceWrite } from '../../../shared/types/thread-places'
import type { GitDiff } from '../../../shared/types/git'
import { PlaceDriftCard } from './PlaceDriftCard'
import { groupFileCount, orderPlaces, placeGroups, placesBridge, shortCommit, showsDriftCard, type PlaceGroups } from './placesModel'
import './PlacesChanges.css'

type DiffFile = GitDiff['files'][number]

function openFolder(path: string): void {
  const app = (window as unknown as { oxe?: { app?: { openIn?: (...args: unknown[]) => Promise<unknown> } } }).oxe?.app
  void app?.openIn?.({ path })?.catch(() => undefined)
}

/**
 * U4.1: the conversation's changes grouped by place (task worktree, main checkout, another checkout, outside), each
 * against its own base; a place whose branch moved carries its drift card (U4.2) and keeps the task's changes apart
 * from the branch switch's.
 */
export function PlacesChanges(props: { threadId: string }): ReactElement {
  const { threadId } = props
  const { t } = useTranslation('thread')
  const [places, setPlaces] = useState<ThreadPlace[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [groups, setGroups] = useState<Record<string, PlaceGroups | null>>({})

  const readDiff = useCallback(async (placeId: string): Promise<void> => {
    const api = placesBridge()
    if (!api?.placeDiff) return
    try {
      const diff = await api.placeDiff(threadId, placeId)
      setGroups(current => ({ ...current, [placeId]: placeGroups(diff) }))
    } catch {
      setGroups(current => ({ ...current, [placeId]: null }))
    }
  }, [threadId])

  const readAll = useCallback(async (): Promise<void> => {
    const api = placesBridge()
    if (!api?.places) { setPlaces([]); return }
    try {
      const result = await api.places(threadId)
      setPlaces(orderPlaces(result.places))
      setCapped(result.capped)
      await Promise.all(result.places.map(place => readDiff(place.id)))
    } catch {
      setPlaces([])
    }
  }, [threadId, readDiff])

  useEffect(() => {
    void readAll()
    const off = placesBridge()?.onPlacesChanged?.(event => { if (event.threadId === threadId) void readAll() })
    return () => { off?.() }
  }, [threadId, readAll])

  if (places === null) return <p className="places-note">{t('places.loading')}</p>
  const total = places.reduce((sum, place) => sum + groupFileCount(groups[place.id] ?? null), 0)
  const drifting = places.some(place => showsDriftCard(place))
  return <div className="places-changes">
    {capped ? <p className="places-note">{t('places.capped', { limit: THREAD_PLACE_LIMITS.places })}</p> : null}
    {total === 0 && !drifting
      ? <p className="places-note">{t('places.empty')}</p>
      : <>
        <p className="places-note">{t('places.summary', { count: places.filter(place => groupFileCount(groups[place.id] ?? null) > 0).length })}</p>
        {places.map(place => <PlaceSection key={place.id} threadId={threadId} place={place} groups={groups[place.id] ?? null}
          reread={() => readDiff(place.id)} />)}
      </>}
  </div>
}

function PlaceSection(props: { threadId: string; place: ThreadPlace; groups: PlaceGroups | null; reread: () => Promise<void> }): ReactElement {
  const { threadId, place, groups, reread } = props
  const { t } = useTranslation('thread')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const label = t(`places.kind.${place.kind}`)
  const undo = async (input: { path: string; hunk?: string; seenMtime: number }): Promise<void> => {
    const api = placesBridge()
    if (!api?.placeUndo) return
    try {
      const result = await api.placeUndo(threadId, place.id, input)
      if (result.ok) {
        const token = result.restoreToken
        toast({
          title: t('places.undone'), intent: 'success',
          action: { label: i18n.t('ui.undo'), run: () => { void api.placeRestore?.(threadId, token).then(() => reread()).catch(() => undefined) } }
        })
      } else {
        toast({ title: result.refusal.code === 'thread.place.stale' ? t('places.stale') : t('places.undoFailed'), intent: 'warning' })
      }
    } catch {
      toast({ title: t('places.undoFailed'), intent: 'danger' })
    }
    await reread()
  }
  const discard = async (): Promise<void> => {
    const api = placesBridge()
    if (!api?.placeDiscard) return
    setBusy(true)
    try {
      const result = await api.placeDiscard(threadId, place.id, { confirmed: true })
      toast(result.ok ? { title: t('places.discarded'), intent: 'success' } : { title: t('places.undoFailed'), intent: 'danger' })
    } catch {
      toast({ title: t('places.undoFailed'), intent: 'danger' })
    } finally {
      setBusy(false)
      setConfirmDiscard(false)
    }
    await reread()
  }

  return <section className="place-section" aria-label={label}>
    <header className="place-head">
      <h3 className="place-title">{label}</h3>
      {groups?.kind === 'git'
        ? <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>{t('places.discard')}</Button>
        : null}
      {place.kind === 'outside'
        ? <Button size="sm" variant="ghost" onClick={() => openFolder(place.path)}>{t('places.openFolder')}</Button>
        : null}
    </header>
    <p className="place-sub">{place.kind === 'outside'
      ? t('places.outsideNote')
      : t('places.against', { path: place.path, commit: shortCommit(place.base?.commit) })}</p>
    {showsDriftCard(place) ? <PlaceDriftCard threadId={threadId} place={place} /> : null}
    {groups === null ? <p className="places-note">{t('places.loading')}</p> : null}
    {groups?.kind === 'written' ? <WrittenList files={groups.written} /> : null}
    {groups?.kind === 'git' && groups.branchSwitch
      ? <>
        <section className="place-group">
          <h4 className="place-group-title">{t('places.groups.task')}</h4>
          <DiffList files={groups.task.files} undo={undo} />
        </section>
        <section className="place-group">
          <h4 className="place-group-title">{t('places.groups.branchSwitch')}</h4>
          <DiffList files={groups.branchSwitch.files} />
        </section>
      </>
      : null}
    {groups?.kind === 'git' && !groups.branchSwitch ? <DiffList files={groups.task.files} undo={undo} /> : null}
    {confirmDiscard
      ? <ConfirmDialog title={t('places.discardTitle', { place: label })} description={t('places.discardText', { path: place.path })}
        confirmLabel={t('places.discardConfirm')} danger busy={busy}
        onConfirm={() => void discard()} onCancel={() => setConfirmDiscard(false)} />
      : null}
  </section>
}

function DiffList(props: { files: DiffFile[]; undo?: (input: { path: string; hunk?: string; seenMtime: number }) => Promise<void> }): ReactElement {
  const { files, undo } = props
  const { t } = useTranslation('thread')
  if (files.length === 0) return <p className="places-note">{t('places.noFiles')}</p>
  return <ul className="place-files">
    {files.map(file => <li key={file.path} className="place-file">
      <div className="place-file-head">
        <span className="place-file-path">{file.path}</span>
        <span className="place-file-counts">+{file.additions} −{file.deletions}</span>
        {undo
          ? <Button size="sm" variant="ghost" onClick={() => void undo({ path: file.path, seenMtime: file.mtime ?? 0 })}>{t('places.undoFile')}</Button>
          : null}
      </div>
      {(file.hunks ?? []).map(hunk => <div key={hunk.header} className="place-hunk">
        <div className="place-file-head">
          <code className="place-hunk-header">{hunk.header}</code>
          {undo
            ? <Button size="sm" variant="ghost" onClick={() => void undo({ path: file.path, hunk: hunk.header, seenMtime: file.mtime ?? 0 })}>{t('places.undoHunk')}</Button>
            : null}
        </div>
        <pre className="place-hunk-lines">{hunk.lines.join('\n')}</pre>
      </div>)}
    </li>)}
  </ul>
}

function WrittenList(props: { files: ThreadPlaceWrite[] }): ReactElement {
  const { t } = useTranslation('thread')
  if (props.files.length === 0) return <p className="places-note">{t('places.noFiles')}</p>
  return <ul className="place-files">
    {props.files.map(file => <li key={file.path} className="place-file">
      <div className="place-file-head">
        <span className="place-file-path">{file.path}</span>
        {file.additions !== undefined || file.deletions !== undefined
          ? <span className="place-file-counts">+{file.additions ?? 0} −{file.deletions ?? 0}</span>
          : null}
      </div>
    </li>)}
  </ul>
}
