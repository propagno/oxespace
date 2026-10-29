import { useEffect, useState, type ReactElement } from 'react'
import { BookMarked, History, Trash2 } from 'lucide-react'
import type { OxeQueryConnection, QueryHistoryItem, SavedQuery } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { groupSaved } from './library-folders'
import { Button, IconButton } from '../../ui/Button'
import { Popover } from '../../ui/Overlay'
import { toast } from '../../ui/Toast'
import { formatDateTime } from '../../utils/formatTime'

/** Saved queries and history for one connection; both live in the app database, not in the page. */
export function LibraryMenu({ connection, currentSql, refreshKey, onPick, describe = text => text.replace(/\s+/g, ' ') }: {
  connection: OxeQueryConnection
  currentSql: string
  /** Changes after every run so a reopened menu is current. */
  refreshKey: number
  onPick: (sql: string) => void
  /** What a list shows for an entry; defaults to the text on one line. */
  describe?: (sql: string) => string
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
      toast({ title: 'Query saved', description: created.name, intent: 'success', duration: 2500 })
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await oq('library.delete', { connectionId: connection.id, id }); setSaved(current => current.filter(item => item.id !== id)) }
    catch (cause) { setError(errorMessage(cause)) }
  }
  const clear = async (): Promise<void> => {
    try { await oq('library.clearHistory', { connectionId: connection.id }); setHistory([]) } catch (cause) { setError(errorMessage(cause)) }
  }

  return <Popover open={open} onOpenChange={setOpen} align="end" label="Saved queries and history"
    trigger={<Button size="sm" aria-haspopup="dialog" icon={<BookMarked size={13} aria-hidden="true" />}>Library</Button>}>
    <div className="oq-library oq-scope">
      <div role="tablist" className="oq-segment">
        <button type="button" role="tab" aria-selected={tab === 'saved'} data-selected={tab === 'saved'} onClick={() => setTab('saved')}><BookMarked size={12} aria-hidden="true" />Saved ({saved.length})</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} data-selected={tab === 'history'} onClick={() => setTab('history')}><History size={12} aria-hidden="true" />History ({history.length})</button>
      </div>
      {error && <p role="alert" className="oq-error">{error}</p>}
      {tab === 'saved' && <>
        <form className="oq-library-save" onSubmit={event => { event.preventDefault(); void save() }}>
          <input aria-label="Name for the current query" placeholder="Save as… (Folder/Name)" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
          <Button size="sm" variant="primary" disabled={!name.trim() || !currentSql.trim()} onClick={() => void save()}>Save</Button>
        </form>
        <ul>{groupSaved(saved).flatMap(group => [
          ...(group.folder ? [<li key={`folder:${group.folder}`} className="oq-library-folder" role="presentation"><strong>{group.folder}</strong></li>] : []),
          ...group.items.map(({ query: item, label }) => <li key={item.id}>
            <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}><strong>{label}</strong><code>{describe(item.sql).slice(0, 80)}</code></button>
            <IconButton size="sm" label={`Delete ${item.name}`} icon={<Trash2 size={12} aria-hidden="true" />} onClick={() => void remove(item.id)} />
          </li>)
        ])}</ul>
        {saved.length === 0 && <p className="oq-muted">Nothing saved yet.</p>}
      </>}
      {tab === 'history' && <>
        <ul>{history.map(item => <li key={item.id}>
          <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}>
            <code>{describe(item.sql).slice(0, 90)}</code>
            <small>{item.ok ? `${item.rows ?? '–'} rows · ${item.durationMs ?? '–'} ms` : 'failed'} · {formatDateTime(item.ranAt)}</small>
          </button></li>)}</ul>
        {history.length === 0 ? <p className="oq-muted">Statements you run appear here.</p> : <Button size="sm" onClick={() => void clear()}>Clear history</Button>}
      </>}
    </div>
  </Popover>
}
