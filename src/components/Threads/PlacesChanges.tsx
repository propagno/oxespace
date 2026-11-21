import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, MessageSquarePlus, X } from 'lucide-react'
import { Badge, Button, ConfirmDialog, IconButton, TextArea, toast } from '../../ui'
import { Skeleton } from '../../ui/Display'
import { i18n } from '../../i18n'
import { commentAnchor, formatDiffComments, type DiffComment, type DiffSide } from '../../../shared/types/diff-comments'
import { THREAD_PLACE_LIMITS, type ThreadPlace, type ThreadPlaceWrite } from '../../../shared/types/thread-places'
import type { GitDiff, GitLineType } from '../../../shared/types/git'
import { useDiffCommentsStore } from '../../store/diff-comments.store'
import { useEditorStore } from '../../store/editor.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { useThreadWorktreeFinishStore } from '../../store/thread-worktree-finish.store'
import { PlaceDriftCard } from './PlaceDriftCard'
import { clockTime, hunkLine, middlePath, orderPlaces, placeGroups, placesBridge, placesStats, shortCommit, showsDriftCard, type PlaceGroups } from './placesModel'
import './PlacesChanges.css'

type DiffFile = GitDiff['files'][number]
type DiffHunk = NonNullable<DiffFile['hunks']>[number]
/** A place's diff once read; 'failed' when main could not read it. Absent while it is being read. */
type Loaded = PlaceGroups | 'failed'
type Undo = (input: { path: string; hunk?: string; seenMtime: number }) => Promise<void>
/** Return `false` or reject to signal delivery failure (OXE-150). */
export type PlacesSend = (text: string) => void | boolean | Promise<void | boolean>

/** Isolated store scope per conversation so comments in one thread never appear in another (OXE-150 Risco 1). */
export function threadCommentScope(threadId: string, workspaceId?: string): string {
  return workspaceId ? `thread:${workspaceId}:${threadId}` : `thread:${threadId}`
}

interface LineEntry {
  type: GitLineType
  content: string
  side: DiffSide
  lineNo: number
}

function hunkLineEntries(hunk: DiffHunk): LineEntry[] {
  const headerMatch = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(hunk.header)
  const legacy = hunk as DiffHunk & { oldStart?: number; newStart?: number }
  let oldCur = legacy.oldStart ?? (headerMatch ? Number(headerMatch[1]) : 1)
  let newCur = legacy.newStart ?? (headerMatch ? Number(headerMatch[2]) : 1)
  return (hunk.lines as ReadonlyArray<DiffHunk['lines'][number] | string>).map((raw) => {
    if (typeof raw === 'string') {
      const type: GitLineType = raw.startsWith('+') ? 'added' : raw.startsWith('-') ? 'removed' : 'context'
      const content = raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' ') ? raw.slice(1) : raw
      if (type === 'removed') return { type, content, side: 'old', lineNo: oldCur++ }
      if (type === 'added') return { type, content, side: 'new', lineNo: newCur++ }
      oldCur++
      return { type, content, side: 'new', lineNo: newCur++ }
    }
    const side: DiffSide = raw.type === 'removed' || (raw.newLineNo == null && raw.oldLineNo != null) ? 'old' : 'new'
    const lineNo = side === 'old' ? (raw.oldLineNo ?? oldCur) : (raw.newLineNo ?? newCur)
    if (raw.type === 'removed') oldCur = lineNo + 1
    else if (raw.type === 'added') newCur = lineNo + 1
    else { oldCur = (raw.oldLineNo ?? oldCur) + 1; newCur = lineNo + 1 }
    return { type: raw.type, content: raw.content, side, lineNo }
  })
}

interface LineCommentOps {
  comments: DiffComment[]
  onAdd: (filePath: string, side: DiffSide, lineNo: number, lineContent: string, body: string) => void
  onRemove: (id: string) => void
}

/** What a hunk offers besides undo: a comment sent to the conversation, and the file opened at the hunk's line. */
interface HunkActions { openAt: (path: string, line: number) => void; comment?: PlacesSend; lineComments: LineCommentOps }

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
  /** Sends a review request, a hunk comment or a batch of line comments to the conversation; return false or reject on failure. */
  onSend?: PlacesSend
  /** Shows the changes of the latest turn; without it By turn is unavailable. */
  onByTurn?: () => void
}

/**
 * U4.1: the conversation's changes grouped by place (task worktree, main checkout, another checkout, outside), each
 * against its own base; a place whose branch moved carries its drift card (U4.2) and keeps the task's changes apart
 * from the branch switch's. It keeps ChangesPanel's features (CR-F4-D1): All changes · By turn, the +/− count, Ask
 * for a review, Finish the worktree…, line comments sent in one batch (OXE-150) and per hunk Comment and Open in editor.
 */
export function PlacesChanges(props: PlacesChangesProps): ReactElement {
  const { threadId, workspaceId, onSend, onByTurn } = props
  const { t } = useTranslation('thread')
  const { t: tc } = useTranslation('code')
  const [places, setPlaces] = useState<ThreadPlace[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [groups, setGroups] = useState<Record<string, Loaded>>({})
  const [collisions, setCollisions] = useState<Record<string, string[]>>({})
  const [sendingComments, setSendingComments] = useState(false)
  const [sendNotice, setSendNotice] = useState<{ kind: 'sent' | 'failed'; text: string } | null>(null)

  const commentScope = threadCommentScope(threadId, workspaceId)
  const allComments = useDiffCommentsStore((s) => s.comments)
  const addDiffComment = useDiffCommentsStore((s) => s.add)
  const removeDiffComment = useDiffCommentsStore((s) => s.remove)
  const clearDiffComments = useDiffCommentsStore((s) => s.clear)
  const markCommentsSent = useDiffCommentsStore((s) => s.markSent)
  const scopedComments = useMemo(() => allComments.filter((c) => c.workspaceId === commentScope), [allComments, commentScope])
  const pendingComments = useMemo(() => scopedComments.filter((c) => c.sentAt == null), [scopedComments])
  const lineComments = useMemo<LineCommentOps>(() => ({
    comments: scopedComments,
    onAdd: (filePath, side, lineNo, lineContent, body) => {
      addDiffComment({ workspaceId: commentScope, filePath, side, lineNo, lineContent, body })
      setSendNotice(null)
    },
    onRemove: removeDiffComment
  }), [scopedComments, addDiffComment, commentScope, removeDiffComment])

  const sendLineComments = async (): Promise<void> => {
    if (!onSend || !pendingComments.length || sendingComments) return
    const batch = pendingComments
    setSendingComments(true)
    let delivered: boolean
    try {
      const result = await onSend(formatDiffComments(batch))
      delivered = result !== false
    } catch {
      delivered = false
    } finally {
      setSendingComments(false)
    }
    if (delivered) {
      markCommentsSent(batch.map((item) => item.id), Date.now())
      setSendNotice({ kind: 'sent', text: tc('changes.comments.sent', { count: batch.length }) })
    } else {
      setSendNotice({ kind: 'failed', text: tc('changes.comments.notSent') })
    }
  }

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
        {pendingComments.length > 0 ? (
          <span className="places-comments-group" role="group" aria-label={tc('changes.comments.label')}>
            <IconButton
              size="sm"
              variant="ghost"
              label={tc('changes.comments.discard')}
              title={tc('changes.comments.discardTitle')}
              icon={<X size={14} aria-hidden="true" />}
              onClick={() => { clearDiffComments(commentScope); setSendNotice(null) }}
            />
            {onSend ? (
              <Button
                variant="primary"
                size="sm"
                loading={sendingComments}
                title={tc('changes.comments.sendTitle')}
                onClick={() => void sendLineComments()}
              >
                {tc('changes.comments.sendCount', { count: pendingComments.length })}
              </Button>
            ) : null}
          </span>
        ) : null}
        <Button size="sm" disabled={!onSend} onClick={() => void onSend?.(t('places.reviewPrompt'))}>{t('places.askReview')}</Button>
        {worktree
          ? <Button size="sm" variant="ghost" onClick={() => useThreadWorktreeFinishStore.getState().ask(threadId, 'archive')}>{t('places.finish')}</Button>
          : null}
      </span>
    </div>
    {sendNotice ? (
      <div role="status" className={`places-send-notice${sendNotice.kind === 'failed' ? ' is-failed' : ''}`} data-testid="places-comments-notice" data-kind={sendNotice.kind}>
        <span>{sendNotice.text}</span>
        {sendNotice.kind === 'failed' ? (
          <Button variant="secondary" size="sm" loading={sendingComments} onClick={() => void sendLineComments()}>
            {tc('changes.comments.retry')}
          </Button>
        ) : null}
      </div>
    ) : null}
    <p className="places-summary">
      {stats.places > 1 ? `${files} ${t('places.inPlaces', { count: stats.places })}` : files}
      {' · '}<span className="places-add">+{stats.additions}</span>{' '}<span className="places-del">−{stats.deletions}</span>
    </p>
    {places.map(place => <PlaceSection key={place.id} threadId={threadId} workspaceId={workspaceId} place={place} groups={groups[place.id]}
      collisions={collisions} onSend={onSend} lineComments={lineComments} reread={() => readDiff(place.id)} />)}
    {cappedLine}
  </div>
}

function PlaceSection(props: {
  threadId: string; workspaceId?: string; place: ThreadPlace; groups: Loaded | undefined; collisions: Record<string, string[]>
  onSend?: PlacesSend; lineComments: LineCommentOps; reread: () => Promise<void>
}): ReactElement {
  const { threadId, workspaceId, place, groups, collisions, onSend, lineComments, reread } = props
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
  const actions: HunkActions = { openAt: (path, line) => openInEditor(threadId, workspaceId, place.path, path, line), comment: onSend, lineComments }
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
  const { t: tc } = useTranslation('code')
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [activeLine, setActiveLine] = useState<{ anchor: string; side: DiffSide; lineNo: number; lineContent: string } | null>(null)
  const [lineDraft, setLineDraft] = useState('')
  const line = hunkLine(hunk.header)
  const openLabel = t('places.openAt', { line })
  const entries = useMemo(() => hunkLineEntries(hunk), [hunk])
  const commentsByAnchor = useMemo(() => {
    const map = new Map<string, DiffComment[]>()
    for (const item of actions.lineComments.comments) {
      if (item.filePath !== path) continue
      const key = commentAnchor(item.filePath, item.side, item.lineNo)
      const list = map.get(key)
      if (list) list.push(item)
      else map.set(key, [item])
    }
    return map
  }, [actions.lineComments.comments, path])
  const send = (): void => {
    const body = text.trim()
    if (!body || !actions.comment) return
    void actions.comment(`${t('places.commentPrompt', { path, hunk: hunk.header, interpolation: { escapeValue: false } })}\n${body}`)
    setText('')
    setOpen(false)
  }
  const saveLineComment = (): void => {
    const body = lineDraft.trim()
    if (!activeLine || !body) return
    actions.lineComments.onAdd(path, activeLine.side, activeLine.lineNo, activeLine.lineContent, body)
    setLineDraft('')
    setActiveLine(null)
  }
  return <div className="place-hunk">
    <div className="place-file-head">
      <code className="place-hunk-header">{hunk.header}</code>
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('places.comment')}</Button>
      <Button size="sm" variant="ghost" square aria-label={openLabel} title={openLabel} icon={<FileText size={14} aria-hidden="true" />}
        onClick={() => actions.openAt(path, line)} />
      {undo ? <Button size="sm" variant="ghost" onClick={undo}>{t('places.undoHunk')}</Button> : null}
    </div>
    <div className="place-hunk-lines">
      {entries.map((entry, index) => {
        const anchor = commentAnchor(path, entry.side, entry.lineNo)
        // A sent comment stays while its line still reads as it did when commented (OXE-129 / OXE-150).
        const visibleComments = (commentsByAnchor.get(anchor) ?? []).filter(
          (item) => item.sentAt == null || item.lineContent === entry.content
        )
        const editing = activeLine?.anchor === anchor
        const commentBtnLabel = tc('changes.comments.inputLabel', { line: entry.lineNo })
        return <div key={`${entry.side}:${entry.lineNo}:${index}`} className="place-hunk-row">
          <div className="place-hunk-line" data-line-type={entry.type}>
            <IconButton
              size="sm"
              variant="ghost"
              className="place-line-comment-trigger"
              label={commentBtnLabel}
              title={commentBtnLabel}
              data-testid="places-line-comment-btn"
              data-line-no={entry.lineNo}
              data-side={entry.side}
              icon={<MessageSquarePlus size={12} aria-hidden="true" />}
              onClick={() => {
                setActiveLine({ anchor, side: entry.side, lineNo: entry.lineNo, lineContent: entry.content })
                setLineDraft('')
              }}
            />
            <span className="place-hunk-lineno" aria-hidden="true">{entry.lineNo}</span>
            <code className="place-hunk-code">{entry.content}</code>
          </div>
          {visibleComments.map((item) => (
            <div key={item.id} className="place-line-comment-card" data-testid="places-line-comment" data-sent={item.sentAt != null ? 'true' : 'false'}>
              <p className="place-line-comment-body">{item.body}</p>
              <div className="place-line-comment-footer">
                {item.sentAt != null ? (
                  <Badge intent="success" data-testid="places-comment-sent">
                    {tc('changes.comments.sentAt', { time: clockTime(item.sentAt) })}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={tc('changes.comments.removeLabel', { line: item.lineNo })}
                  onClick={() => actions.lineComments.onRemove(item.id)}
                >
                  {tc('changes.comments.remove')}
                </Button>
              </div>
            </div>
          ))}
          {editing ? (
            <div className="place-line-composer" data-testid="places-line-composer">
              <TextArea
                label={commentBtnLabel}
                placeholder={tc('changes.comments.placeholder', { line: entry.lineNo })}
                rows={2}
                value={lineDraft}
                onChange={(event) => setLineDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.preventDefault(); setActiveLine(null); setLineDraft('') }
                  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveLineComment() }
                }}
              />
              <div className="place-comment-actions">
                <Button size="sm" variant="ghost" onClick={() => { setActiveLine(null); setLineDraft('') }}>{tc('changes.comments.cancel')}</Button>
                <Button size="sm" variant="primary" disabled={!lineDraft.trim()} onClick={saveLineComment}>{tc('changes.comments.add')}</Button>
              </div>
            </div>
          ) : null}
        </div>
      })}
    </div>
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
