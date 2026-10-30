import { useCallback, useEffect, useState, type ReactElement } from 'react'
import './WorkspaceMemoryNotes.css'
import type { MemoryNote, MemoryNotePatch, MemoryNotesView, MemoryResetScope, MemoryScope } from '../../../shared/types/memory'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Select, TextArea, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const DAY = 86_400_000
const SCOPE_LABEL: Record<MemoryScope, string> = { personal: 'Only me', project: 'This project', team: 'Team' }
const ORIGIN_LABEL: Record<MemoryNote['origin']['kind'], string> = {
  user: 'Written or edited by you', agent: 'Recorded by an agent', file: 'From a file', web: 'From the web', tool: 'From tool output',
  unknown: 'Captured by the memory service'
}
/** Days from now; an empty value is the prompt. */
const EXPIRY_CHOICES = [{ value: '', label: 'Set expiry…' }, { value: '1', label: 'Expire in 1 day' }, { value: '7', label: 'Expire in 7 days' }, { value: '30', label: 'Expire in 30 days' }]

export function describeOrigin(note: Pick<MemoryNote, 'origin' | 'createdAt'>): string {
  const { origin } = note
  const parts = [ORIGIN_LABEL[origin.kind], origin.agentId && `agent ${origin.agentId}`, origin.threadId && `conversation ${origin.threadId.slice(0, 8)}`,
    origin.sessionId && `session ${origin.sessionId.slice(0, 8)}`, note.createdAt ? new Date(note.createdAt).toLocaleString() : undefined]
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
    catch (error) { setMessage(humanizeError(error, 'Could not read stored memory')); setFailure(true); setState('error') }
  }, [api, workspaceId])
  useEffect(() => { setQuery(''); setEditing(null); void load('') }, [load])

  if (!api?.notes) return null
  const act = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true); setMessage(''); setFailure(false)
    try { const done = await work(); if (done) setMessage(done); await load(query) }
    catch (error) { setFailure(true); setMessage(humanizeError(error, 'Memory operation failed')) }
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
        return erased ? 'Note deleted.' : 'Note hidden from every agent and tool. This memory service has no way to erase a single page; Erase everything removes it.'
      }
      const result = await api.reset({ workspaceId, scope: pending.scope, confirm: typed })
      return result.storeErased ? 'All stored memory was erased.' : `${result.notesRemoved} notes forgotten for this project.`
    }).finally(close)
  }
  const exportNotes = (scope: 'all' | 'team'): Promise<void> => act(async () => {
    const result = await api.export({ workspaceId, scope })
    downloadText(result.fileName, result.content)
    return `Exported ${result.count} notes to ${result.fileName}. Secrets were removed.`
  })

  return <section className="memory-notes" aria-labelledby="memory-notes-title">
    <h4 id="memory-notes-title" className="memory-runtime-heading">Stored memory</h4>
    <p>What agents can be given for this project. Text taken from files, web pages and tool output is stored as untrusted data and shown to agents only as quoted evidence, never as instructions.</p>
    <form className="memory-notes-search" role="search" onSubmit={event => { event.preventDefault(); void load(query) }}>
      <TextField aria-label="Search stored memory" placeholder="Search stored memory" value={query} onChange={event => setQuery(event.target.value)} />
      <Button type="submit" disabled={busy}>Search</Button>
      <Button disabled={busy || !view?.notes.length} onClick={() => void exportNotes('all')}>Export all</Button>
      <Button disabled={busy || !view?.teamAllowed || !view.notes.some(note => note.effectiveScope === 'team')} title={view?.teamBlock} onClick={() => void exportNotes('team')}>Export team notes</Button>
    </form>
    {view && !view.teamAllowed && <p className="memory-notes-hint">{view.teamBlock}</p>}
    {message && <p className="memory-feedback" role={failure ? 'alert' : 'status'}>{message}</p>}
    {state === 'loading' && !view && <LoadingState label="Reading stored memory…" />}
    {state === 'error' && !view && <ErrorState compact title="Stored memory could not be read" message={message} onRetry={() => void load(query)} />}
    {view && view.notes.length === 0 && state !== 'loading' && <EmptyState compact title={query ? 'No stored memory matches' : 'Nothing stored yet'}>Notes agents record for this project appear here.</EmptyState>}
    <ul className="memory-notes-list" aria-busy={state === 'loading'}>
      {view?.notes.map(note => {
        const dim = note.state !== 'active'
        return <li key={note.path} className="memory-note" data-state={note.state}>
          <header>
            <strong>{note.title || (note.kind ? note.kind[0].toUpperCase() + note.kind.slice(1) : note.origin.kind === 'unknown' ? 'Captured page' : 'Note')}</strong>
            <span className="memory-note-badges">
              {note.pinned && <Badge intent="info">Pinned</Badge>}
              {dim && <Badge intent="warning">{note.state === 'superseded' ? 'Replaced' : note.state === 'wrong' ? 'Marked wrong' : 'Expired'}</Badge>}
              <Badge intent={note.trust === 'trusted' ? 'success' : 'neutral'} title={note.trust === 'trusted' ? 'You wrote or reviewed this' : 'Not reviewed: agents get it as quoted evidence only'}>{note.trust === 'trusted' ? 'Trusted' : 'Untrusted'}</Badge>
              <Badge title={note.scope !== note.effectiveScope ? `Chosen: ${SCOPE_LABEL[note.scope]}. ${note.teamBlock ?? ''}` : undefined}>{SCOPE_LABEL[note.effectiveScope]}</Badge>
              {note.suspicious && <Badge intent="danger" title="Reads like an instruction to an AI model. It is left out of the brief that starts a session.">Looks like an instruction</Badge>}
            </span>
          </header>
          {editing?.path === note.path
            ? <div className="memory-note-edit">
              <TextArea aria-label="Edit note" rows={5} value={editing.text} onChange={event => setEditing({ path: note.path, text: event.target.value })} />
              <div><Button variant="primary" disabled={busy || !editing.text.trim()} onClick={() => void update(note, { text: editing.text }, 'Note replaced. The old version is hidden.').then(() => setEditing(null))}>Save as new version</Button>
                <Button disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div>
            </div>
            : <pre className="memory-note-text">{note.text}</pre>}
          <p className="memory-note-meta">{describeOrigin(note)}</p>
          {note.origin.excerpt && <blockquote className="memory-note-excerpt">Asked: {note.origin.excerpt}</blockquote>}
          {note.expiresAt && <p className="memory-note-meta">{note.state === 'expired' ? 'Expired' : 'Expires'} {new Date(note.expiresAt).toLocaleDateString()}</p>}
          <p className="memory-note-meta">{note.usedBy.length ? `Given to ${note.usedBy.map(use => `${use.agentId} (${use.uses}×, last ${new Date(use.lastUsedAt).toLocaleDateString()})`).join(', ')}` : 'Not given to any agent yet'}</p>
          {note.state !== 'deleted' && <div className="memory-note-actions">
            <Button size="sm" disabled={busy} onClick={() => void update(note, { pinned: !note.pinned })}>{note.pinned ? 'Unpin' : 'Pin'}</Button>
            <Button size="sm" disabled={busy} onClick={() => void update(note, { wrong: !note.wrong })}>{note.wrong ? 'Not wrong' : 'Mark wrong'}</Button>
            {note.trust === 'untrusted' && note.origin.kind !== 'unknown' && <Button size="sm" disabled={busy} onClick={() => void update(note, { trust: 'trusted' })}>I reviewed this</Button>}
            {note.origin.kind !== 'unknown' && <Button size="sm" disabled={busy || note.state === 'superseded'} onClick={() => setEditing({ path: note.path, text: note.text })}>Edit</Button>}
            <Select aria-label="Expiry" value="" disabled={busy} onChange={event => { const days = Number(event.target.value); if (days) void update(note, { expiresAt: Date.now() + days * DAY }, 'Expiry set.') }}>
              {EXPIRY_CHOICES.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}            </Select>
            {note.expiresAt && <Button size="sm" disabled={busy} onClick={() => void update(note, { expiresAt: null }, 'Expiry removed.')}>Remove expiry</Button>}
            <Select aria-label="Who can use this note" value={note.scope} disabled={busy || dim} onChange={event => void update(note, { scope: event.target.value as MemoryScope })}>
              {(Object.keys(SCOPE_LABEL) as MemoryScope[]).map(scope => <option key={scope} value={scope} disabled={scope === 'team' && !!note.teamBlock && note.scope !== 'team'} title={scope === 'team' ? note.teamBlock : undefined}>{SCOPE_LABEL[scope]}</option>)}
            </Select>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'delete', note })}>Delete</Button>
          </div>}
        </li>
      })}
    </ul>
    <div className="memory-notes-danger">
      <Button variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset', scope: 'project' })}>Reset this project’s memory</Button>
      <Button variant="danger" disabled={busy} onClick={() => setConfirm({ kind: 'reset', scope: 'all' })}>Erase all stored memory</Button>
    </div>
    {confirm?.kind === 'delete' && <ConfirmDialog danger busy={busy} title="Delete this note?" confirmLabel="Delete" onCancel={close} onConfirm={confirmed}
      description="Agents and tools will no longer be given it, and its text is removed from OXESpace." />}
    {confirm?.kind === 'reset' && <ConfirmDialog danger busy={busy} title={confirm.scope === 'all' ? 'Erase all stored memory?' : 'Reset this project’s memory?'} confirmLabel={confirm.scope === 'all' ? 'Erase everything' : 'Reset'}
      confirmDisabled={typed !== 'RESET'} onCancel={close} onConfirm={confirmed}
      description={confirm.scope === 'all'
        ? 'Stops the memory service and deletes everything it stored for every project, including upgrade snapshots. This cannot be undone. Close memory-enabled terminals first.'
        : 'Forgets every note OXESpace knows for this project and keeps them hidden from agents. Pages the memory service captured on its own stay in its store; Erase all removes those.'}>
      <TextField label="Type RESET to confirm" value={typed} autoComplete="off" onChange={event => setTyped(event.target.value)} />
    </ConfirmDialog>}
  </section>
}
