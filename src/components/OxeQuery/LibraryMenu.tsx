import { useEffect, useState, type ReactElement } from 'react'
import { BookMarked, History, Trash2 } from 'lucide-react'
import type { OxeQueryConnection, QueryHistoryItem, SavedQuery } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'

/** Saved queries and history for one connection; both live in the app database, not in the page. */
export function LibraryMenu({ connection, currentSql, refreshKey, onPick }: {
  connection: OxeQueryConnection
  currentSql: string
  /** Changes after every run so a reopened menu is current. */
  refreshKey: number
  onPick: (sql: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'saved' | 'history'>('saved')
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    oq('library.list', { connectionId: connection.id }).then(
      value => { if (alive) { setSaved(value.saved); setHistory(value.history); setError('') } },
      cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [open, connection.id, refreshKey])

  const save = async (): Promise<void> => {
    try {
      const created = await oq('library.save', { connectionId: connection.id, name, sql: currentSql })
      setSaved(current => [...current.filter(item => item.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)))
      setName(''); setError('')
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await oq('library.delete', { connectionId: connection.id, id }); setSaved(current => current.filter(item => item.id !== id)) }
    catch (cause) { setError(errorMessage(cause)) }
  }
  const clear = async (): Promise<void> => {
    try { await oq('library.clearHistory', { connectionId: connection.id }); setHistory([]) } catch (cause) { setError(errorMessage(cause)) }
  }

  return <div className="oq-library-wrap">
    <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><BookMarked size={13} aria-hidden="true" />Library</button>
    {open && <div className="oq-library" role="dialog" aria-label="Saved queries and history">
      <div role="tablist" className="oq-segment">
        <button type="button" role="tab" aria-selected={tab === 'saved'} data-selected={tab === 'saved'} onClick={() => setTab('saved')}><BookMarked size={12} aria-hidden="true" />Saved ({saved.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} data-selected={tab === 'history'} onClick={() => setTab('history')}><History size={12} aria-hidden="true" />History ({history.length})</button>
      </div>
      {error && <p role="alert" className="oq-error">{error}</p>}
      {tab === 'saved' && <>
        <form className="oq-library-save" onSubmit={event => { event.preventDefault(); void save() }}>
          <input aria-label="Name for the current query" placeholder="Save the current query as…" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
          <button type="button" className="oq-primary" disabled={!name.trim() || !currentSql.trim()} onClick={() => void save()}>Save</button>
        </form>
        <ul>{saved.map(item => <li key={item.id}>
          <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}><strong>{item.name}</strong><code>{item.sql.replace(/\s+/g, ' ').slice(0, 80)}</code></button>
          <button type="button" aria-label={`Delete ${item.name}`} onClick={() => void remove(item.id)}><Trash2 size={12} aria-hidden="true" /></button>
        </li>)}</ul>
        {saved.length === 0 && <p className="oq-muted">Nothing saved yet.</p>}
      </>}
      {tab === 'history' && <>
        <ul>{history.map(item => <li key={item.id}>
          <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}>
            <code>{item.sql.replace(/\s+/g, ' ').slice(0, 90)}</code>
            <small>{item.ok ? `${item.rows ?? '–'} rows · ${item.durationMs ?? '–'} ms` : 'failed'} · {new Date(item.ranAt).toLocaleString()}</small>
          </button></li>)}</ul>
        {history.length === 0 ? <p className="oq-muted">Statements you run appear here.</p> : <button type="button" onClick={() => void clear()}>Clear history</button>}
      </>}
    </div>}
  </div>
}
