import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { MongoCollectionAction, OxeQueryConnection } from '../../../shared/types/oxequery'
import { Button, Checkbox, Dialog, ErrorState, Select, TextArea, TextField } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { jsonProblem } from './mongo-model'
import styles from './MongoPanels.module.css'

/**
 * Update or delete many documents. The count comes first: the change can only be applied for the
 * number that was shown, so a collection that moved in the meantime asks again instead of running.
 */
export function BulkPanel({ connection, database, collection, filter, onClose, onDone }: {
  connection: OxeQueryConnection
  database: string
  collection: string
  filter: string
  onClose: () => void
  onDone: () => void
}): ReactElement {
  const { t } = useTranslation('oxequery')
  const [op, setOp] = useState<'updateMany' | 'deleteMany'>('updateMany')
  const [where, setWhere] = useState(filter.trim() || '{}')
  const [update, setUpdate] = useState('{\n  "$set": { "field": "value" }\n}')
  const [counted, setCounted] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  // An update is operators (an object) or a short pipeline (an array): either shape will do.
  const updateProblem = op === 'updateMany' && jsonProblem(update, 'array') ? jsonProblem(update, 'object') : null
  const problem = jsonProblem(where, 'object') ?? updateProblem
  const input = { connectionId: connection.id, database, collection, op, filter: where, ...(op === 'updateMany' ? { update } : {}) }
  const reset = (): void => { setCounted(null); setConfirmed(false); setDone(''); setError('') }

  const count = async (): Promise<void> => {
    setBusy(true); reset()
    try { setCounted((await oq('mongo.bulk', { ...input, dryRun: true })).matched) } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const apply = async (): Promise<void> => {
    if (counted === null) return
    setBusy(true); setError('')
    try {
      const result = await oq('mongo.bulk', { ...input, confirmed: true, expectedCount: counted })
      setDone(op === 'deleteMany' ? t('bulk.deleted', { count: result.deleted, formatted: formatNumber(result.deleted) }) : t('bulk.updated', { matched: formatNumber(result.matched), count: result.modified, formatted: formatNumber(result.modified) }))
      setCounted(null); setConfirmed(false)
      onDone()
    } catch (cause) {
      setError(cause instanceof OxeQueryClientError && cause.code === 'conflict' ? `${cause.message}` : errorMessage(cause))
      if (cause instanceof OxeQueryClientError && cause.code === 'conflict') { setCounted(null); setConfirmed(false) }
    } finally { setBusy(false) }
  }

  return <Dialog className="oq-scope" title={t('bulk.title', { collection })} description={t('bulk.description')} closeLabel={t('common.close')} size="lg" onClose={onClose} testId="mongo-bulk"
    footer={<><Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      <Button variant="secondary" loading={busy} disabled={problem !== null} onClick={() => void count()}>{t('bulk.count')}</Button>
      <Button variant={op === 'deleteMany' ? 'danger' : 'primary'} loading={busy} disabled={counted === null || counted === 0 || !confirmed || connection.readOnly} onClick={() => void apply()}>
        {op === 'deleteMany' ? t('bulk.deleteDocuments') : t('bulk.updateDocuments')}</Button></>}>
    <div className={styles.form}>
      <Select label={t('bulk.operation')} value={op} onChange={event => { setOp(event.target.value as typeof op); reset() }} options={[{ value: 'updateMany', label: t('bulk.updateMany') }, { value: 'deleteMany', label: t('bulk.deleteMany') }]} />
      <TextArea mono label={t('mongo.filter')} rows={3} value={where} error={jsonProblem(where, 'object') ?? undefined} onChange={event => { setWhere(event.target.value); reset() }} />
      {op === 'updateMany' && <TextArea mono label={t('bulk.update')} rows={5} value={update} hint={t('bulk.updateHint')}
        error={updateProblem ?? undefined} onChange={event => { setUpdate(event.target.value); reset() }} />}
      {connection.readOnly && <p role="note" className={styles.note}>{t('bulk.readOnly')}</p>}
      {counted !== null && <section className={styles.count} aria-label={t('bulk.matchesLabel')} role="status">
        <strong>{t('bulk.matches', { count: counted, formatted: formatNumber(counted) })}</strong>
        {where.trim() === '{}' && <p className={styles.warn}>{t('bulk.emptyFilter')}</p>}
        {counted > 0 && !connection.readOnly && <Checkbox label={t(op === 'deleteMany' ? 'bulk.willDelete' : 'bulk.willChange', { count: counted, formatted: formatNumber(counted) })} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />}
      </section>}
      {error && <ErrorState compact title={t('bulk.failed')} message={error} />}
      {done && <p role="status" className={styles.ok}>{done}</p>}
    </div>
  </Dialog>
}

type CollectionDialogMode = { kind: 'create'; database: string } | { kind: 'rename'; database: string; collection: string } | { kind: 'drop'; database: string; collection: string }

/** Create, rename or drop a collection. A drop names what it deletes and waits for a tick. */
export function CollectionDialog({ connection, mode, onClose, onDone }: { connection: OxeQueryConnection; mode: CollectionDialogMode; onClose: () => void; onDone: (name?: string) => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [name, setName] = useState(mode.kind === 'rename' ? mode.collection : '')
  const [capped, setCapped] = useState(false)
  const [sizeMb, setSizeMb] = useState('64')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    setBusy(true); setError('')
    const collection = mode.kind === 'create' ? name.trim() : mode.collection
    const action: MongoCollectionAction = mode.kind === 'create'
      ? { kind: 'create', ...(capped ? { capped: true, sizeBytes: Math.max(1, Math.round(Number(sizeMb) || 64)) * 1024 * 1024 } : {}) }
      : mode.kind === 'rename' ? { kind: 'rename', to: name.trim() } : { kind: 'drop' }
    try {
      await oq('mongo.collection', { connectionId: connection.id, database: mode.database, collection, action, confirmed })
      onDone(mode.kind === 'drop' ? undefined : name.trim())
      onClose()
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const title = mode.kind === 'create' ? t('mongo.newCollectionIn', { database: mode.database }) : mode.kind === 'rename' ? t('mongo.renameNamed', { name: mode.collection }) : t('mongo.dropNamed', { name: mode.collection })
  return <Dialog className="oq-scope" title={title} size="sm" onClose={onClose} closeLabel={t('common.close')} testId="mongo-collection"
    footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant={mode.kind === 'drop' ? 'danger' : 'primary'} loading={busy} disabled={connection.readOnly || (mode.kind !== 'drop' && !name.trim()) || (mode.kind === 'drop' && !confirmed)} onClick={() => void submit()}>
        {mode.kind === 'create' ? t('common.create') : mode.kind === 'rename' ? t('common.rename') : t('collection.drop')}</Button></>}>
    <div className={styles.form}>
      {mode.kind !== 'drop' && <TextField mono autoFocus label={mode.kind === 'create' ? t('server.column.name') : t('collection.newName')} value={name} onChange={event => setName(event.target.value)} />}
      {mode.kind === 'create' && <>
        <Checkbox label={t('collection.capped')} checked={capped} onChange={event => setCapped(event.target.checked)} />
        {capped && <TextField label={t('collection.size')} inputMode="numeric" value={sizeMb} onChange={event => setSizeMb(event.target.value)} />}
      </>}
      {mode.kind === 'drop' && <>
        <p className={styles.error}>{t('collection.dropWarning', { name: mode.collection })}</p>
        <Checkbox label={t('collection.understand')} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      </>}
      {connection.readOnly && <p role="note" className={styles.note}>{t('collection.readOnly')}</p>}
      {error && <ErrorState compact title={t('collection.failed')} message={error} />}
    </div>
  </Dialog>
}
