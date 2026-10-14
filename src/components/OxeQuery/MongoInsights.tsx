import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { MongoIndexInfo, MongoSchema, OxeQueryConnection } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { CollectionFacts } from './CollectionFacts'

/** Inferred schema and indexes of the selected collection. */
export function MongoInsights({ connection, database, collection }: { connection: OxeQueryConnection; database: string; collection: string }): ReactElement {
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [schema, setSchema] = useState<MongoSchema | null>(null)
  const [indexes, setIndexes] = useState<MongoIndexInfo[]>([])
  const [keys, setKeys] = useState('{ "field": 1 }')
  const [unique, setUnique] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ reasons: string[]; action: () => void } | null>(null)

  const loadIndexes = useCallback(async (): Promise<void> => {
    try { setIndexes(await oq('mongo.indexes', { connectionId: connection.id, database, collection })) } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id, database, collection])

  useEffect(() => { setSchema(null); setIndexes([]); setError(''); setConfirm(null); void loadIndexes() }, [loadIndexes])
  useEffect(() => {
    if (!schemaOpen || schema) return
    let alive = true
    oq('mongo.schema', { connectionId: connection.id, database, collection }).then(value => { if (alive) setSchema(value) }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [schemaOpen, schema, connection.id, database, collection])

  const change = async (run: (confirmed: boolean) => Promise<unknown>, confirmed = false): Promise<void> => {
    setError('')
    try { await run(confirmed); setConfirm(null); await loadIndexes() }
    catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setConfirm({ reasons: cause.reasons, action: () => void change(run, true) })
      else setError(errorMessage(cause))
    }
  }

  return <div className="oq-insights">
    <section className="oq-columns" aria-label="Collection schema">
      <button type="button" className="oq-disclosure" aria-expanded={schemaOpen} onClick={() => setSchemaOpen(value => !value)}>
        {schemaOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}Schema{schema ? ` · ${schema.fields.length} fields from ${schema.sampled} documents` : ''}</button>
      {schemaOpen && (schema
        ? <div className="oq-columns-grid"><table><thead><tr><th>Field</th><th>Types</th><th>Present</th></tr></thead>
          <tbody>{schema.fields.map(field => <tr key={field.path}><td><code>{field.path}</code></td>
            <td>{field.types.map(item => `${item.type}${field.types.length > 1 ? ` ×${item.count}` : ''}`).join(', ')}</td><td>{field.presence}%</td></tr>)}</tbody></table>
          {schema.truncated && <p className="oq-muted">Showing the first 300 fields.</p>}</div>
        : <p className="oq-muted" aria-busy="true">Sampling documents…</p>)}
    </section>
    <section className="oq-columns" aria-label="Indexes">
      <button type="button" className="oq-disclosure" aria-expanded={indexOpen} onClick={() => setIndexOpen(value => !value)}>
        {indexOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}Indexes · {indexes.length}</button>
      {indexOpen && <div className="oq-columns-grid">
        <ul className="oq-index-list">{indexes.map(index => <li key={index.name}>
          <code>{index.name}</code><span>{index.keys}</span>{index.unique && <span className="oq-badge">unique</span>}
          {!connection.readOnly && index.name !== '_id_' && <button type="button" aria-label={`Drop index ${index.name}`}
            onClick={() => void change(confirmed => oq('mongo.dropIndex', { connectionId: connection.id, database, collection, name: index.name, confirmed }))}><Trash2 size={12} aria-hidden="true" /></button>}
        </li>)}</ul>
        {!connection.readOnly && <form className="oq-index-form" onSubmit={event => { event.preventDefault(); void change(confirmed => oq('mongo.createIndex', { connectionId: connection.id, database, collection, keys, unique, confirmed })) }}>
          <input aria-label="Index keys" spellCheck={false} value={keys} onChange={event => setKeys(event.target.value)} />
          <label className="oq-inline"><input type="checkbox" checked={unique} onChange={event => setUnique(event.target.checked)} />Unique</label>
          <button type="submit"><Plus size={12} aria-hidden="true" />Create index</button>
        </form>}
        {confirm && <div className="oq-confirm" role="alertdialog" aria-label="Confirm index change">
          <strong>Confirm this index change</strong><ul>{confirm.reasons.map(item => <li key={item}>{item}</li>)}</ul>
          <div><button type="button" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="oq-danger" onClick={confirm.action}>Continue</button></div>
        </div>}
      </div>}
    </section>
    <CollectionFacts connection={connection} database={database} collection={collection} />
    {error && <p role="alert" className="oq-error">{error}</p>}
  </div>
}
