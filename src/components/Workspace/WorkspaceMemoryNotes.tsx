import { useCallback, useEffect, useState, type ReactElement } from 'react'
import './WorkspaceMemoryNotes.css'
import type { MemoryNote, MemoryNotePatch, MemoryNotesView, MemoryResetScope, MemoryScope } from '../../../shared/types/memory'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Select, TextArea, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'

const DAY = 86_400_000
const tn = (key: string, options?: Record<string, unknown>): string => (i18n.t as (key: string, options?: object) => string)(`memory.notes.${key}`, { ns: 'code', ...options })
const SCOPES: MemoryScope[] = ['personal', 'project', 'team']
const scopeLabel = (scope: MemoryScope): string => tn(`scope.${scope}`)
/** Days from now; an empty value is the prompt. */
const expiryChoices = (): Array<{ value: string; label: string }> => [{ value: '', label: tn('expiry.prompt') }, { value: '1', label: tn('expiry.d1') }, { value: '7', label: tn('expiry.d7') }, { value: '30', label: tn('expiry.d30') }]

export function describeOrigin(note: Pick<MemoryNote, 'origin' | 'createdAt'>): string {
  const { origin } = note
  const parts = [tn(`origin.${origin.kind}`), origin.agentId && tn('originAgent', { id: origin.agentId }), origin.threadId && tn('originThread', { id: origin.threadId.slice(0, 8) }),
    origin.sessionId && tn('originSession', { id: origin.sessionId.slice(0, 8) }), note.createdAt ? new Date(note.createdAt).toLocaleString(i18n.language) : undefined]
  return parts.filter(Boolean).join(' · ')
}

export function downloadText(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Confirm = { kind: 'delete'; note: MemoryNote } | { kind: 'reset'; scope: MemoryResetScope } | null

/** Everything stored for the project: where each note came from, who used it, and what you can do about it. */
export function WorkspaceMemoryNotes({ workspaceId }: { workspaceId: string }): ReactElement | null {
  useTranslation('code')
  const api = typeof window !== 'undefined' ? window.oxe?.memory : undefined
  const [view, setView] = useState<MemoryNotesView | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ path: string; text: string } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [typed, setTyped] = useState('')

  const load = useCallback(async (search: string): Promise<void> => {
    if (!api?.notes) return
    setState('loading')
    try { setView(await api.notes({ workspaceId, ...(search.trim() ? { query: search.trim() } : {}) })); setState('ready') }
    catch (error) { setMessage(humanizeError(error, tn('readFailed'))); setFailure(true); setState('error') }
  }, [api, workspaceId])
  useEffect(() => { setQuery(''); setEditing(null); void load('') }, [load])

  if (!api?.notes) return null
  const act = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true); setMessage(''); setFailure(false)
    try { const done = await work(); if (done) setMessage(done); await load(query) }
    catch (error) { setFailure(true); setMessage(humanizeError(error, tn('opFailed'))) }
    finally { setBusy(false) }
  }
  const update = (note: MemoryNote, patch: MemoryNotePatch, done?: string) => act(async () => { await api.noteUpdate({ workspaceId, path: note.path, patch }); return done })

  const close = (): void => { setConfirm(null); setTyped('') }
  const confirmed = (): void => {
    const pending = confirm
    if (!pending) return
    void act(async () => {
      if (pending.kind === 'delete') {
        const { erased } = await api.noteDelete({ workspaceId, path: pending.note.path })
        return erased ? tn('deleted') : tn('hidden')
      }
      const result = await api.reset({ workspaceId, scope: pending.scope, confirm: typed })
      return result.storeErased ? tn('erasedAll') : tn('forgotten', { count: result.notesRemoved })
    }).finally(close)
  }
  const exportNotes = (scope: 'all' | 'team'): Promise<void> => act(async () => {
    const result = await api.export({ workspaceId, scope })
    downloadText(result.fileName, result.content)
    return tn('exported', { count: result.count, file: result.fileName })
  })

  return <section className="memory-notes" aria-labelledby="memory-notes-title">
    <h4 id="memory-notes-title" className="memory-runtime-heading">{tn('title')}</h4>
    <p>{tn('intro')}</p>
    <form className="memory-notes-search" role="search" onSubmit={event => { event.preventDefault(); void load(query) }}>
      <TextField aria-label={tn('search')} placeholder={tn('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <Button type="submit" disabled={busy}>{tn('searchButton')}</Button>
      <Button disabled={busy || !view?.notes.length} onClick={() => void exportNotes('all')}>{tn('exportAll')}</Button>
      <Button disabled={busy || !view?.teamAllowed || !view.notes.some(note => note.effectiveScope === 'team')} title={view?.teamBlock} onClick={() => void exportNotes('team')}>{tn('exportTeam')}</Button>
    </form>
    {view && !view.teamAllowed && <p className="memory-notes-hint">{view.teamBlock}</p>}
    {message && <p className="memory-feedback" role={failure ? 'alert' : 'status'}>{message}</p>}
    {state === 'loading' && !view && <LoadingState label={tn('loading')} />}
    {state === 'error' && !view && <ErrorState compact title={tn('errorTitle')} message={message} onRetry={() => void load(query)} />}
    {view && view.notes.length === 0 && state !== 'loading' && <EmptyState compact title={query ? tn('noMatch') : tn('none')}>{tn('noneHint')}</EmptyState>}
    <ul className="memory-notes-list" aria-busy={state === 'loading'}>
      {view?.notes.map(note => {
        const dim = note.state !== 'active'
        return <li key={note.path} className="memory-note" data-state={note.state}>
          <header>
            <strong>{note.title || (note.kind ? note.kind[0].toUpperCase() + note.kind.slice(1) : note.origin.kind === 'unknown' ? tn('untitled.capturedPage') : tn('untitled.note'))}</strong>
            <span className="memory-note-badges">
              {note.pinned && <Badge intent="info">{tn('pinned')}</Badge>}
              {dim && <Badge intent="warning">{note.state === 'superseded' ? tn('replaced') : note.state === 'wrong' ? tn('wrong') : tn('expired')}</Badge>}
              <Badge intent={note.trust === 'trusted' ? 'success' : 'neutral'} title={note.trust === 'trusted' ? tn('trustedHint') : tn('untrustedHint')}>{note.trust === 'trusted' ? tn('trusted') : tn('untrusted')}</Badge>
              <Badge title={note.scope !== note.effectiveScope ? tn('chosen', { scope: scopeLabel(note.scope), block: note.teamBlock ?? '' }) : undefined}>{scopeLabel(note.effectiveScope)}</Badge>
              {note.suspicious && <Badge intent="danger" title={tn('suspiciousHint')}>{tn('suspicious')}</Badge>}
            </span>
          </header>
          {editing?.path === note.path
            ? <div className="memory-note-edit">
              <TextArea aria-label={tn('editNote')} rows={5} value={editing.text} onChange={event => setEditing({ path: note.path, text: event.target.value })} />
              <div><Button variant="primary" disabled={busy || !editing.text.trim()} onClick={() => void update(note, { text: editing.text }, tn('replacedDone')).then(() => setEditing(null))}>{tn('saveVersion')}</Button>
                <Button disabled={busy} onClick={() => setEditing(null)}>{tn('cancel')}</Button></div>
            </div>
            : <pre className="memory-note-text">{note.text}</pre>}
          <p className="memory-note-meta">{describeOrigin(note)}</p>
          {note.origin.excerpt && <blockquote className="memory-note-excerpt">{tn('asked', { text: note.origin.excerpt })}</blockquote>}
          {note.expiresAt && <p className="memory-note-meta">{tn(note.state === 'expired' ? 'expiredOn' : 'expiresOn', { date: new Date(note.expiresAt).toLocaleDateString(i18n.language) })}</p>}
          <p className="memory-note-meta">{note.usedBy.length ? tn('givenTo', { list: note.usedBy.map(use => tn('givenUse', { agent: use.agentId, uses: use.uses, date: new Date(use.lastUsedAt).toLocaleDateString(i18n.language) })).join(', ') }) : tn('notGiven')}</p>
          {note.state !== 'deleted' && <div className="memory-note-actions">
            <Button size="sm" disabled={busy} onClick={() => void update(note, { pinned: !note.pinned })}>{note.pinned ? tn('unpin') : tn('pin')}</Button>
            <Button size="sm" disabled={busy} onClick={() => void update(note, { wrong: !note.wrong })}>{note.wrong ? tn('notWrong') : tn('markWrong')}</Button>
            {note.trust === 'untrusted' && note.origin.kind !== 'unknown' && <Button size="sm" disabled={busy} onClick={() => void update(note, { trust: 'trusted' })}>{tn('reviewed')}</Button>}
            {note.origin.kind !== 'unknown' && <Button size="sm" disabled={busy || note.state === 'superseded'} onClick={() => setEditing({ path: note.path, text: note.text })}>{tn('edit')}</Button>}
            <Select aria-label={tn('expiryLabel')} value="" disabled={busy} onChange={event => { const days = Number(event.target.value); if (days) void update(note, { expiresAt: Date.now() + days * DAY }, tn('expirySet')) }}>
              {expiryChoices().map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}            </Select>
            {note.expiresAt && <Button size="sm" disabled={busy} onClick={() => void update(note, { expiresAt: null }, tn('expiryRemoved'))}>{tn('removeExpiry')}</Button>}
            <Select aria-label={tn('who')} value={note.scope} disabled={busy || dim} onChange={event => void update(note, { scope: event.target.value as MemoryScope })}>
              {SCOPES.map(scope => <option key={scope} value={scope} disabled={scope === 'team' && !!note.teamBlock && note.scope !== 'team'} title={scope === 'team' ? note.teamBlock : undefined}>{scopeLabel(scope)}</option>)}
            </Select>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'delete', note })}>{tn('delete')}</Button>
          </div>}
        </li>
      })}
    </ul>
    <div className="memory-notes-danger">
      <Button variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset', scope: 'project' })}>{tn('resetProject')}</Button>
      <Button variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset', scope: 'all' })}>{tn('eraseAll')}</Button>
    </div>
    {confirm?.kind === 'delete' && <ConfirmDialog danger busy={busy} title={tn('deleteTitle')} confirmLabel={tn('delete')} onCancel={close} onConfirm={confirmed}
      description={tn('deleteBody')} />}
    {confirm?.kind === 'reset' && <ConfirmDialog danger busy={busy} title={confirm.scope === 'all' ? tn('eraseTitle') : tn('resetTitle')} confirmLabel={confirm.scope === 'all' ? tn('eraseConfirm') : tn('resetConfirm')}
      confirmDisabled={typed !== 'RESET'} onCancel={close} onConfirm={confirmed}
      description={confirm.scope === 'all'
        ? tn('eraseBody')
        : tn('resetBody')}>
      <TextField label={tn('typeReset')} value={typed} autoComplete="off" onChange={event => setTyped(event.target.value)} />
    </ConfirmDialog>}
  </section>
}
