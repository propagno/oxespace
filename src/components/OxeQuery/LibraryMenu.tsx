import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState } from '../../ui/Display'
import { formatMs } from './catalog'
import { formatNumber } from '../../utils/formatTime'
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
  const { t } = useTranslation('oxequery')
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
      toast({ title: t('library.saved'), description: created.name, intent: 'success' })
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await oq('library.delete', { connectionId: connection.id, id }); setSaved(current => current.filter(item => item.id !== id)) }
    catch (cause) { setError(errorMessage(cause)) }
  }
  const clear = async (): Promise<void> => {
    try { await oq('library.clearHistory', { connectionId: connection.id }); setHistory([]) } catch (cause) { setError(errorMessage(cause)) }
  }

  return <Popover open={open} onOpenChange={setOpen} align="end" label={t('library.label')}
    trigger={<Button size="sm" aria-haspopup="dialog" icon={<BookMarked size={13} aria-hidden="true" />}>{t('library.title')}</Button>}>
    <div className="oq-library oq-scope">
      <div role="tablist" className="oq-segment">
        <button type="button" role="tab" aria-selected={tab === 'saved'} data-selected={tab === 'saved'} onClick={() => setTab('saved')}><BookMarked size={12} aria-hidden="true" />{t('library.savedTab', { count: saved.length })}</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} data-selected={tab === 'history'} onClick={() => setTab('history')}><History size={12} aria-hidden="true" />{t('library.historyTab', { count: history.length })}</button>
      </div>
      {error && <ErrorState compact title={t('library.failed')} message={error} />}
      {tab === 'saved' && <>
        <form className="oq-library-save" onSubmit={event => { event.preventDefault(); void save() }}>
          <input aria-label={t('library.nameLabel')} placeholder={t('library.namePlaceholder')} value={name} maxLength={120} onChange={event => setName(event.target.value)} />
          <Button size="sm" variant="primary" disabled={!name.trim() || !currentSql.trim()} onClick={() => void save()}>{t('common.save')}</Button>
        </form>
        <ul>{groupSaved(saved).flatMap(group => [
          ...(group.folder ? [<li key={`folder:${group.folder}`} className="oq-library-folder" role="presentation"><strong>{group.folder}</strong></li>] : []),
          ...group.items.map(({ query: item, label }) => <li key={item.id}>
            <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}><strong>{label}</strong><code>{describe(item.sql).slice(0, 80)}</code></button>
            <IconButton size="sm" label={t('connections.deleteNamed', { name: item.name })} icon={<Trash2 size={12} aria-hidden="true" />} onClick={() => void remove(item.id)} />
          </li>)
        ])}</ul>
        {saved.length === 0 && <EmptyState compact title={t('library.noneSaved')} />}
      </>}
      {tab === 'history' && <>
        <ul>{history.map(item => <li key={item.id}>
          <button type="button" title={item.sql} onClick={() => { onPick(item.sql); setOpen(false) }}>
            <code>{describe(item.sql).slice(0, 90)}</code>
            <small>{item.ok ? [item.rows === null || item.rows === undefined ? t('activity.rowsUnknown') : t('common.rows', { count: item.rows, formatted: formatNumber(item.rows) }), item.durationMs === null || item.durationMs === undefined ? '' : formatMs(item.durationMs)].filter(Boolean).join(' · ') : t('common.failed')} · {formatDateTime(item.ranAt)}</small>
          </button></li>)}</ul>
        {history.length === 0 ? <EmptyState compact title={t('library.noHistory')} /> : <Button size="sm" onClick={() => void clear()}>{t('library.clearHistory')}</Button>}
      </>}
    </div>
  </Popover>
}
