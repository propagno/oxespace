import { useEffect, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MongoStats, MongoValidation, OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { jsonProblem } from './mongo-model'

const bytes = (value: number): string => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`

/** Size figures and the validation rules of a collection. Rules are shown always and changed only on a read-write connection. */
export function CollectionFacts({ connection, database, collection }: { connection: OxeQueryConnection; database: string; collection: string }): ReactElement {
  const [statsOpen, setStatsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [stats, setStats] = useState<MongoStats | null>(null)
  const [rules, setRules] = useState<MongoValidation | null>(null)
  const [text, setText] = useState('')
  const [level, setLevel] = useState<MongoValidation['level']>('strict')
  const [action, setAction] = useState<MongoValidation['action']>('error')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => { setStats(null); setRules(null); setError(''); setSaved('') }, [connection.id, database, collection])
  useEffect(() => {
    if (!statsOpen || stats) return
    let alive = true
    oq('mongo.stats', { connectionId: connection.id, database, collection }).then(value => { if (alive) setStats(value) }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [statsOpen, stats, connection.id, database, collection])
  useEffect(() => {
    if (!rulesOpen || rules) return
    let alive = true
    oq('mongo.validation', { connectionId: connection.id, database, collection }).then(value => {
      if (!alive) return
      setRules(value); setText(value.validator ?? ''); setLevel(value.level); setAction(value.action)
    }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [rulesOpen, rules, connection.id, database, collection])

  const problem = jsonProblem(text, 'object', true)
  const save = async (): Promise<void> => {
    setError(''); setSaved('')
    try {
      await oq('mongo.setValidation', { connectionId: connection.id, database, collection, validator: text.trim() === '' ? null : text, level, action })
      setSaved(text.trim() === '' ? 'Validation removed.' : 'Validation saved.')
      setRules(null)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  const disclosure = (open: boolean, toggle: () => void, label: string): ReactElement =>
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={toggle}>{open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{label}</button>

  return <>
    <section className="oq-columns" aria-label="Collection statistics">
      {disclosure(statsOpen, () => setStatsOpen(value => !value), `Statistics${stats ? ` · ${stats.documents.toLocaleString()} documents` : ''}`)}
      {statsOpen && (stats
        ? <dl className="oq-facts">
          <div><dt>Documents</dt><dd>{stats.documents.toLocaleString()}</dd></div>
          <div><dt>Data size</dt><dd>{bytes(stats.sizeBytes)}</dd></div>
          <div><dt>Average document</dt><dd>{bytes(stats.avgDocumentBytes)}</dd></div>
          <div><dt>On disk</dt><dd>{bytes(stats.storageBytes)}</dd></div>
          <div><dt>Indexes</dt><dd>{stats.indexes} · {bytes(stats.indexBytes)}</dd></div>
          {stats.capped && <div><dt>Kind</dt><dd>capped</dd></div>}
        </dl>
        : <p className="oq-muted" aria-busy="true">Reading statistics…</p>)}
    </section>
    <section className="oq-columns" aria-label="Collection validation">
      {disclosure(rulesOpen, () => setRulesOpen(value => !value), `Validation${rules ? (rules.validator ? ' · rules set' : ' · none') : ''}`)}
      {rulesOpen && (rules
        ? <div className="oq-columns-grid oq-rules">
          <label>Rules (<code>$jsonSchema</code>)
            <textarea aria-label="Validation rules" spellCheck={false} rows={8} value={text} readOnly={connection.readOnly} aria-invalid={problem ? true : undefined}
              placeholder={'{ "$jsonSchema": { "bsonType": "object", "required": ["name"] } }'} onChange={event => setText(event.target.value)} />
            {problem && <small className="oq-field-error" role="alert">{problem}</small>}
          </label>
          <label>Applies to<select aria-label="Validation level" value={level} disabled={connection.readOnly} onChange={event => setLevel(event.target.value as MongoValidation['level'])}>
            <option value="strict">all inserts and updates</option><option value="moderate">updates of documents that already pass</option><option value="off">nothing (off)</option></select></label>
          <label>On a violation<select aria-label="Validation action" value={action} disabled={connection.readOnly} onChange={event => setAction(event.target.value as MongoValidation['action'])}>
            <option value="error">refuse the write</option><option value="warn">allow it and log a warning</option></select></label>
          {!connection.readOnly && <button type="button" className="oq-primary" disabled={problem !== null} onClick={() => void save()}>Save validation</button>}
          {saved && <p role="status" className="oq-ok">{saved}</p>}
        </div>
        : <p className="oq-muted" aria-busy="true">Reading rules…</p>)}
    </section>
    {error && <p role="alert" className="oq-error">{error}</p>}
  </>
}
