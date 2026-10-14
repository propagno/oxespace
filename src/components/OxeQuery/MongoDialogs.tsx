import { useState, type ReactElement } from 'react'
import type { MongoCollectionAction, OxeQueryConnection } from '../../../shared/types/oxequery'
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from '../../ui'
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
      setDone(op === 'deleteMany' ? `${result.deleted} deleted.` : `${result.matched} matched, ${result.modified} changed.`)
      setCounted(null); setConfirmed(false)
      onDone()
    } catch (cause) {
      setError(cause instanceof OxeQueryClientError && cause.code === 'conflict' ? `${cause.message}` : errorMessage(cause))
      if (cause instanceof OxeQueryClientError && cause.code === 'conflict') { setCounted(null); setConfirmed(false) }
    } finally { setBusy(false) }
  }

  const verb = op === 'deleteMany' ? 'deleted' : 'changed'
  return <Dialog title={`Change many in ${collection}`} description="Count the documents first; the change runs only for the number you confirm." size="lg" onClose={onClose} testId="mongo-bulk"
    footer={<><Button variant="ghost" onClick={onClose}>Close</Button>
      <Button variant="secondary" loading={busy} disabled={problem !== null} onClick={() => void count()}>Count matches</Button>
      <Button variant={op === 'deleteMany' ? 'danger' : 'primary'} loading={busy} disabled={counted === null || counted === 0 || !confirmed || connection.readOnly} onClick={() => void apply()}>
        {op === 'deleteMany' ? 'Delete documents' : 'Update documents'}</Button></>}>
    <div className={styles.form}>
      <Select label="Operation" value={op} onChange={event => { setOp(event.target.value as typeof op); reset() }} options={[{ value: 'updateMany', label: 'Update many' }, { value: 'deleteMany', label: 'Delete many' }]} />
      <TextArea mono label="Filter" rows={3} value={where} error={jsonProblem(where, 'object') ?? undefined} onChange={event => { setWhere(event.target.value); reset() }} />
      {op === 'updateMany' && <TextArea mono label="Update" rows={5} value={update} hint="Update operators such as $set, $unset, $inc — not a replacement document"
        error={updateProblem ?? undefined} onChange={event => { setUpdate(event.target.value); reset() }} />}
      {connection.readOnly && <p role="note" className={styles.note}>This connection is read-only: you can count, not change.</p>}
      {counted !== null && <section className={styles.count} aria-label="Matches" role="status">
        <strong>{counted} document{counted === 1 ? '' : 's'} match</strong>
        {where.trim() === '{}' && <p className={styles.warn}>The filter is empty: every document in the collection matches.</p>}
        {counted > 0 && !connection.readOnly && <Checkbox label={`${counted} document${counted === 1 ? '' : 's'} will be ${verb}${op === 'deleteMany' ? ' for good' : ''}`} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />}
      </section>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {done && <p role="status" className={styles.ok}>{done}</p>}
    </div>
  </Dialog>
}

type CollectionDialogMode = { kind: 'create'; database: string } | { kind: 'rename'; database: string; collection: string } | { kind: 'drop'; database: string; collection: string }

/** Create, rename or drop a collection. A drop names what it deletes and waits for a tick. */
export function CollectionDialog({ connection, mode, onClose, onDone }: { connection: OxeQueryConnection; mode: CollectionDialogMode; onClose: () => void; onDone: (name?: string) => void }): ReactElement {
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

  const title = mode.kind === 'create' ? `New collection in ${mode.database}` : mode.kind === 'rename' ? `Rename ${mode.collection}` : `Drop ${mode.collection}`
  return <Dialog title={title} size="sm" onClose={onClose} testId="mongo-collection"
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={mode.kind === 'drop' ? 'danger' : 'primary'} loading={busy} disabled={connection.readOnly || (mode.kind !== 'drop' && !name.trim()) || (mode.kind === 'drop' && !confirmed)} onClick={() => void submit()}>
        {mode.kind === 'create' ? 'Create' : mode.kind === 'rename' ? 'Rename' : 'Drop collection'}</Button></>}>
    <div className={styles.form}>
      {mode.kind !== 'drop' && <TextField mono autoFocus label={mode.kind === 'create' ? 'Name' : 'New name'} value={name} onChange={event => setName(event.target.value)} />}
      {mode.kind === 'create' && <>
        <Checkbox label="Capped (a fixed size; the oldest documents are replaced)" checked={capped} onChange={event => setCapped(event.target.checked)} />
        {capped && <TextField label="Size (MB)" inputMode="numeric" value={sizeMb} onChange={event => setSizeMb(event.target.value)} />}
      </>}
      {mode.kind === 'drop' && <>
        <p className={styles.error}>This deletes “{mode.collection}” and all of its documents for good.</p>
        <Checkbox label="I understand it cannot be recovered" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      </>}
      {connection.readOnly && <p role="note" className={styles.note}>This connection is read-only.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </Dialog>
}
