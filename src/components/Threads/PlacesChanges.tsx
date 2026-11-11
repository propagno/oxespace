import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { Badge, Button, ConfirmDialog, TextArea, toast } from '../../ui'
import { Skeleton } from '../../ui/Display'
import { i18n } from '../../i18n'
import { THREAD_PLACE_LIMITS, type ThreadPlace, type ThreadPlaceWrite } from '../../../shared/types/thread-places'
import type { GitDiff } from '../../../shared/types/git'
import { useEditorStore } from '../../store/editor.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { useThreadWorktreeFinishStore } from '../../store/thread-worktree-finish.store'
import { PlaceDriftCard } from './PlaceDriftCard'
import { hunkLine, middlePath, orderPlaces, placeGroups, placesBridge, placesStats, shortCommit, showsDriftCard, type PlaceGroups } from './placesModel'
import './PlacesChanges.css'

type DiffFile = GitDiff['files'][number]
type DiffHunk = NonNullable<DiffFile['hunks']>[number]
/** A place's diff once read; 'failed' when main could not read it. Absent while it is being read. */
type Loaded = PlaceGroups | 'failed'
type Undo = (input: { path: string; hunk?: string; seenMtime: number }) => Promise<void>
/** What a hunk offers besides undo: a comment sent to the conversation, and the file opened at the hunk's line. */
interface HunkActions { openAt: (path: string, line: number) => void; comment?: (text: string) => void }

function openFolder(path: string): void {
  const app = (window as unknown as { oxe?: { app?: { openIn?: (...args: unknown[]) => Promise<unknown> } } }).oxe?.app
  void app?.openIn?.({ path })?.catch(() => undefined)
}

function openInEditor(threadId: string, workspaceId: string | undefined, rootPath: string, relativePath: string, line: number): void {
  if (!workspaceId) return
  void useEditorStore.getState().openFile({ workspaceId, rootPath, relativePath, line })
  useThreadWorkbenchStore.getState().setView(threadId, { panel: 'files' })
}

export interface PlacesChangesProps {
  threadId: string
  workspaceId?: string
  /** Sends a review request or a hunk comment to the conversation; without it those actions are unavailable. */
  onSend?: (text: string) => void
  /** Shows the changes of the latest turn; without it By turn is unavailable. */
  onByTurn?: () => void
}

/**
 * U4.1: the conversation's changes grouped by place (task worktree, main checkout, another checkout, outside), each
 * against its own base; a place whose branch moved carries its drift card (U4.2) and keeps the task's changes apart
 * from the branch switch's. It keeps ChangesPanel's features (CR-F4-D1): All changes · By turn, the +/− count, Ask
 * for a review, Finish the worktree… and per hunk Comment and Open in editor.
 */
export function PlacesChanges(props: PlacesChangesProps): ReactElement {
  const { threadId, workspaceId, onSend, onByTurn } = props
  const { t } = useTranslation('thread')
  const [places, setPlaces] = useState<ThreadPlace[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [groups, setGroups] = useState<Record<string, Loaded>>({})
  const [collisions, setCollisions] = useState<Record<string, string[]>>({})

  const readDiff = useCallback(async (placeId: string): Promise<void> => {
    const api = placesBridge()
    if (!api?.placeDiff) return
    try {
      const diff = await api.placeDiff(threadId, placeId)
      setGroups(current => ({ ...current, [placeId]: placeGroups(diff) ?? 'failed' }))
    } catch {
      setGroups(current => ({ ...current, [placeId]: 'failed' }))
    }
  }, [threadId])

  const readCollisions = useCallback(async (): Promise<void> => {
    try {
      const found = await placesBridge()?.collisions?.(threadId)
      const byFile: Record<string, string[]> = {}
      for (const collision of Array.isArray(found) ? found : []) {
        byFile[collision.file] = [...(byFile[collision.file] ?? []), ...collision.others.map(other => other.title)]
      }
      setCollisions(byFile)
    } catch {
      setCollisions({})
    }
  }, [threadId])

  const readAll = useCallback(async (): Promise<void> => {
    const api = placesBridge()
    if (!api?.places) { setPlaces([]); return }
    void readCollisions()
    try {
      const result = await api.places(threadId)
      setPlaces(orderPlaces(result.places))
      setCapped(result.capped)
      await Promise.all(result.places.map(place => readDiff(place.id)))
    } catch {
      setPlaces([])
    }
  }, [threadId, readDiff, readCollisions])

  useEffect(() => {
    void readAll()
    const off = placesBridge()?.onPlacesChanged?.(event => { if (event.threadId === threadId) void readAll() })
    return () => { off?.() }
  }, [threadId, readAll])

  if (places === null) return <div className="places-changes" aria-busy="true"><Skeleton lines={4} label={t('places.loading')} /></div>
  const loaded = places.every(place => groups[place.id] !== undefined)
  const stats = placesStats(places.map(place => { const value = groups[place.id]; return value === 'failed' ? null : value }))
  const drifting = places.some(place => showsDriftCard(place))
  const cappedLine = capped ? <p className="places-note">{t('places.capped', { limit: THREAD_PLACE_LIMITS.places })}</p> : null
  if (loaded && stats.files === 0 && !drifting) return <div className="places-changes"><p className="places-note">{t('places.empty')}</p>{cappedLine}</div>
  const worktree = places.some(place => place.kind === 'worktree')
  const files = t('places.files', { count: stats.files })
  return <div className="places-changes">
    <div className="places-toolbar">
      <div className="places-view" role="radiogroup" aria-label={t('places.view.label')}>
        <Button size="sm" variant="ghost" role="radio" aria-checked="true">{t('places.view.all')}</Button>
        <Button size="sm" variant="ghost" role="radio" aria-checked="false" disabled={!onByTurn} onClick={onByTurn}>{t('places.view.byTurn')}</Button>
      </div>
      <span className="places-toolbar-actions">
        <Button size="sm" disabled={!onSend} onClick={() => onSend?.(t('places.reviewPrompt'))}>{t('places.askReview')}</Button>
        {worktree
          ? <Button size="sm" variant="ghost" onClick={() => useThreadWorktreeFinishStore.getState().ask(threadId, 'archive')}>{t('places.finish')}</Button>
          : null}
      </span>
    </div>
    <p className="places-summary">
      {stats.places > 1 ? `${files} ${t('places.inPlaces', { count: stats.places })}` : files}
      {' · '}<span className="places-add">+{stats.additions}</span>{' '}<span className="places-del">−{stats.deletions}</span>
    </p>
    {places.map(place => <PlaceSection key={place.id} threadId={threadId} workspaceId={workspaceId} place={place} groups={groups[place.id]}
      collisions={collisions} onSend={onSend} reread={() => readDiff(place.id)} />)}
    {cappedLine}
  </div>
}

function PlaceSection(props: {
  threadId: string; workspaceId?: string; place: ThreadPlace; groups: Loaded | undefined; collisions: Record<string, string[]>
  onSend?: (text: string) => void; reread: () => Promise<void>
}): ReactElement {
  const { threadId, workspaceId, place, groups, collisions, onSend, reread } = props
  const { t } = useTranslation('thread')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const label = t(`places.kind.${place.kind}`)
  const undo: Undo = async input => {
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
  const branch = place.current?.branch ?? place.base?.branch ?? null
  const actions: HunkActions = { openAt: (path, line) => openInEditor(threadId, workspaceId, place.path, path, line), comment: onSend }
  const read = groups !== undefined && groups !== 'failed' ? groups : null
  const git = read?.kind === 'git' ? read : null

  return <section className="place-section" aria-label={label} aria-busy={groups === undefined || undefined}>
    <header className="place-head">
      <h3 className="place-title">{label}</h3>
      {branch && place.kind !== 'outside' ? <code className="place-branch">{branch}</code> : null}
      {git ? <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>{t('places.discard')}</Button> : null}
      {place.kind === 'outside'
        ? <Button size="sm" variant="ghost" onClick={() => openFolder(place.path)}>{t('places.openFolder')}</Button>
        : null}
    </header>
    <p className="place-sub">{place.kind === 'outside'
      ? t('places.outsideNote')
      : <><code className="place-path" title={place.path}>{middlePath(place.path)}</code>{' · '}{t('places.base', { commit: shortCommit(place.base?.commit) })}</>}</p>
    {showsDriftCard(place) ? <PlaceDriftCard threadId={threadId} place={place} /> : null}
    {groups === undefined ? <Skeleton lines={2} decorative /> : null}
    {groups === 'failed' ? <p className="places-note">{t('places.failed')}</p> : null}
    {read?.kind === 'written' ? <WrittenList files={read.written} collisions={collisions} /> : null}
    {git && git.branchSwitch
      ? <>
        <section className="place-group">
          <h4 className="place-group-title">{t('places.groups.task')}</h4>
          <DiffList files={git.task.files} undo={undo} actions={actions} collisions={collisions} />
        </section>
        <section className="place-group">
          <h4 className="place-group-title">{t('places.groups.branchSwitch')}</h4>
          <DiffList files={git.branchSwitch.files} actions={actions} collisions={collisions} />
        </section>
      </>
      : null}
    {git && !git.branchSwitch ? <DiffList files={git.task.files} undo={undo} actions={actions} collisions={collisions} /> : null}
    {confirmDiscard
      ? <ConfirmDialog title={t('places.discardTitle', { place: label })} description={t('places.discardText', { path: place.path })}
        confirmLabel={t('places.discardConfirm')} danger busy={busy}
        onConfirm={() => void discard()} onCancel={() => setConfirmDiscard(false)} />
      : null}
  </section>
}

/** CR-F4-D6: a file another conversation also edits carries the collision mark in its row. */
function CollisionMark({ titles }: { titles?: string[] }): ReactElement | null {
  const { t } = useTranslation('thread')
  if (!titles?.length) return null
  return <Badge intent="warning" data-tone="warning">{t('collision.alsoEditedBy', { title: titles.join(', '), interpolation: { escapeValue: false } })}</Badge>
}

function DiffList(props: { files: DiffFile[]; undo?: Undo; actions: HunkActions; collisions: Record<string, string[]> }): ReactElement {
  const { files, undo, actions, collisions } = props
  const { t } = useTranslation('thread')
  if (files.length === 0) return <p className="places-note">{t('places.noFiles')}</p>
  return <ul className="place-files">
    {files.map(file => <li key={file.path} className="place-file">
      <div className="place-file-head">
        <code className="place-file-path">{file.path}</code>
        <span className="place-file-counts">+{file.additions} −{file.deletions}</span>
        <CollisionMark titles={collisions[file.path]} />
        {undo
          ? <Button size="sm" variant="ghost" onClick={() => void undo({ path: file.path, seenMtime: file.mtime ?? 0 })}>{t('places.undoFile')}</Button>
          : null}
      </div>
      {(file.hunks ?? []).map(hunk => <HunkView key={hunk.header} path={file.path} hunk={hunk} actions={actions}
        undo={undo ? () => void undo({ path: file.path, hunk: hunk.header, seenMtime: file.mtime ?? 0 }) : undefined} />)}
    </li>)}
  </ul>
}

function HunkView(props: { path: string; hunk: DiffHunk; undo?: () => void; actions: HunkActions }): ReactElement {
  const { path, hunk, undo, actions } = props
  const { t } = useTranslation('thread')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const line = hunkLine(hunk.header)
  const openLabel = t('places.openAt', { line })
  const send = (): void => {
    const body = text.trim()
    if (!body || !actions.comment) return
    actions.comment(`${t('places.commentPrompt', { path, hunk: hunk.header, interpolation: { escapeValue: false } })}\n${body}`)
    setText('')
    setOpen(false)
  }
  return <div className="place-hunk">
    <div className="place-file-head">
      <code className="place-hunk-header">{hunk.header}</code>
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('places.comment')}</Button>
      <Button size="sm" variant="ghost" square aria-label={openLabel} title={openLabel} icon={<FileText size={14} aria-hidden="true" />}
        onClick={() => actions.openAt(path, line)} />
      {undo ? <Button size="sm" variant="ghost" onClick={undo}>{t('places.undoHunk')}</Button> : null}
    </div>
    <pre className="place-hunk-lines">{hunk.lines.map((entry, index) => <span key={index} className="place-hunk-line" data-line-type={entry.type}>{entry.content}{'\n'}</span>)}</pre>
    {open
      ? <div className="place-comment">
        <TextArea label={t('places.commentLabel', { path, hunk: hunk.header })} rows={3} value={text} onChange={event => setText(event.target.value)} />
        <div className="place-comment-actions">
          <Button size="sm" variant="primary" disabled={!text.trim() || !actions.comment} onClick={send}>{t('places.commentSend')}</Button>
        </div>
      </div>
      : null}
  </div>
}

function WrittenList(props: { files: ThreadPlaceWrite[]; collisions: Record<string, string[]> }): ReactElement {
  const { t } = useTranslation('thread')
  if (props.files.length === 0) return <p className="places-note">{t('places.noFiles')}</p>
  return <ul className="place-files">
    {props.files.map(file => <li key={file.path} className="place-file">
      <div className="place-file-head">
        <code className="place-file-path">{file.path}</code>
        {file.additions !== undefined || file.deletions !== undefined
          ? <span className="place-file-counts">+{file.additions ?? 0} −{file.deletions ?? 0}</span>
          : null}
        <CollisionMark titles={props.collisions[file.path]} />
      </div>
    </li>)}
  </ul>
}
