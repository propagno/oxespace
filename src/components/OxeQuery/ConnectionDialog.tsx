import { useState, type FormEvent, type ReactElement } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Database, Leaf, Link2, ShieldAlert, XCircle } from 'lucide-react'
import type { ConnectionEnvironment, DatabaseEngine, OxeQueryConnection, SslMode } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { parseConnectionUrl } from './connection-url'
import { useOxeQueryStore } from './oxequery.store'

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }
const ENGINES: { id: DatabaseEngine; label: string; hint: string; Icon: typeof Database }[] = [
  { id: 'postgres', label: 'PostgreSQL', hint: 'SQL editor and schema browser', Icon: Database },
  { id: 'mongodb', label: 'MongoDB', hint: 'Collections, find and aggregate', Icon: Leaf }
]
const ENVIRONMENTS: { id: ConnectionEnvironment; label: string }[] = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Development' }, { id: 'prod', label: 'Production' }]

export function ConnectionDialog(): ReactElement | null {
  const { open, editing } = useOxeQueryStore(state => state.dialog)
  if (!open) return null
  return <ConnectionForm key={editing?.id ?? 'new'} editing={editing} />
}

type Outcome = { kind: 'ok' | 'fail'; message: string } | null

function ConnectionForm({ editing }: { editing: OxeQueryConnection | null }): ReactElement {
  const close = useOxeQueryStore(state => state.closeDialog)
  const [engine, setEngine] = useState<DatabaseEngine>(editing?.engine ?? 'postgres')
  const [name, setName] = useState(editing?.name ?? '')
  const [host, setHost] = useState(editing?.host ?? '127.0.0.1')
  const [port, setPort] = useState(String(editing?.port ?? DEFAULT_PORT.postgres))
  const [database, setDatabase] = useState(editing?.database ?? '')
  const [username, setUsername] = useState(editing?.username ?? '')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [sslMode, setSslMode] = useState<SslMode>(editing?.sslMode ?? 'disable')
  const [environment, setEnvironment] = useState<ConnectionEnvironment>(editing?.environment ?? 'local')
  const [readOnly, setReadOnly] = useState(editing?.readOnly ?? true)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [advanced, setAdvanced] = useState(Boolean(editing && editing.sslMode !== 'disable'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<Outcome>(null)

  const applyUrl = (text: string): void => {
    setUrl(text)
    if (!text.trim()) { setUrlError(''); return }
    const parsed = parseConnectionUrl(text)
    if (!parsed.ok) { setUrlError(parsed.error); return }
    const value = parsed.value
    setUrlError('')
    setEngine(value.engine); setHost(value.host); setPort(String(value.port)); setDatabase(value.database); setUsername(value.username)
    if (value.password) { setPassword(value.password); setClearPassword(false) }
    if (value.sslMode !== 'disable') { setSslMode(value.sslMode); setAdvanced(true) }
    setName(current => current || `${value.username ? `${value.username}@` : ''}${value.host}${value.database ? `/${value.database}` : ''}`)
  }

  const chooseEngine = (next: DatabaseEngine): void => {
    if (editing) return
    setEngine(next)
    setPort(current => (Number(current) === DEFAULT_PORT[engine] ? String(DEFAULT_PORT[next]) : current))
  }

  const save = async (): Promise<OxeQueryConnection> => oq('connections.save', {
    ...(editing ? { id: editing.id } : {}), name, engine, host, port: Number(port), database, username, sslMode, environment, readOnly,
    ...(editing?.containerRef ? { containerRef: editing.containerRef } : {}), ...(password ? { password } : {}), ...(clearPassword ? { clearPassword: true } : {})
  })

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const saved = await save()
      await useOxeQueryStore.getState().refreshConnections()
      useOxeQueryStore.getState().closeDialog()
      useOxeQueryStore.getState().openConnection(saved)
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const check = async (): Promise<void> => {
    setBusy(true); setError(''); setOutcome(null)
    try {
      const saved = await save()
      await useOxeQueryStore.getState().refreshConnections()
      const result = await oq('connections.test', { id: saved.id })
      setOutcome(result.ok
        ? { kind: 'ok', message: `Connected${result.serverVersion ? ` to ${result.serverVersion}` : ''}${result.latencyMs !== undefined ? ` in ${result.latencyMs} ms` : ''}.` }
        : { kind: 'fail', message: result.message })
    } catch (cause) { setOutcome({ kind: 'fail', message: errorMessage(cause) }) } finally { setBusy(false) }
  }

  return <div className="desktop-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="desktop-dialog oq-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit connection' : 'New connection'} onSubmit={event => void submit(event)}>
      <header className="desktop-dialog-header"><div><h2>{editing ? 'Edit connection' : 'New connection'}</h2>
        <p>{editing?.containerRef ? `Created from the container ${editing.containerRef}.` : 'Connect to a database running here, in a container or on another server.'}</p></div></header>

      {!editing && <section className="oq-engines" role="radiogroup" aria-label="Engine">
        {ENGINES.map(({ id, label, hint, Icon }) => <button key={id} type="button" role="radio" aria-checked={engine === id} className="oq-engine" data-selected={engine === id} onClick={() => chooseEngine(id)}>
          <Icon size={18} aria-hidden="true" /><span><strong>{label}</strong><small>{hint}</small></span></button>)}
      </section>}

      {!editing && <label className="oq-url"><span><Link2 size={13} aria-hidden="true" /> Connection string <small>(optional — fills the form)</small></span>
        <input value={url} onChange={event => applyUrl(event.target.value)} placeholder="postgres://user:password@localhost:5432/app" spellCheck={false} autoComplete="off" />
        {urlError && <em role="alert">{urlError}</em>}</label>}

      <div className="oq-form">
        <label className="oq-form-wide">Name<input value={name} onChange={event => setName(event.target.value)} placeholder={engine === 'postgres' ? 'Local Postgres' : 'Local MongoDB'} required autoFocus /></label>
        <label>Host<input value={host} onChange={event => setHost(event.target.value)} required spellCheck={false} /></label>
        <label>Port<input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} required /></label>
        <label>User<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password"
          placeholder={editing?.hasPassword && !clearPassword ? 'Saved — leave blank to keep' : ''} /></label>
        <label className="oq-form-wide">Database<input value={database} onChange={event => setDatabase(event.target.value)} spellCheck={false}
          placeholder={engine === 'postgres' ? 'postgres' : 'optional'} /></label>
        {editing?.hasPassword && <label className="oq-check oq-form-wide"><input type="checkbox" checked={clearPassword} onChange={event => setClearPassword(event.target.checked)} />Remove the saved password</label>}
      </div>

      <section className="oq-safety" aria-label="Safety">
        <div role="radiogroup" aria-label="Environment" className="oq-segment">
          {ENVIRONMENTS.map(item => <button key={item.id} type="button" role="radio" aria-checked={environment === item.id} data-selected={environment === item.id} data-environment={item.id}
            onClick={() => setEnvironment(item.id)}>{item.label}</button>)}
        </div>
        <label className="oq-switch"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />
          <span><strong>Read-only</strong><small>The server refuses statements that change data. Turn off to write.</small></span></label>
        {environment === 'prod' && !readOnly && <p className="oq-warning" role="note"><ShieldAlert size={14} aria-hidden="true" /> This is a production connection with writes enabled. Destructive statements will still ask first.</p>}
      </section>

      <button type="button" className="oq-disclosure" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>
        {advanced ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}Advanced</button>
      {advanced && <div className="oq-form">
        <label className="oq-form-wide">TLS<select value={sslMode} onChange={event => setSslMode(event.target.value as SslMode)}>
          <option value="disable">Off</option><option value="prefer">Off (prefer, not negotiated)</option><option value="require">Required — certificate is not verified</option></select></label>
      </div>}

      {error && <p role="alert" className="oq-error">{error}</p>}
      {outcome && <p role="status" className={`oq-outcome oq-outcome-${outcome.kind}`}>{outcome.kind === 'ok' ? <CheckCircle2 size={15} aria-hidden="true" /> : <XCircle size={15} aria-hidden="true" />}{outcome.message}</p>}

      <footer className="oq-dialog-actions">
        <button type="button" onClick={() => void check()} disabled={busy}>{busy ? 'Working…' : 'Test connection'}</button>
        <span className="oq-spacer" />
        <button type="button" onClick={close} disabled={busy}>Cancel</button>
        <button type="submit" className="oq-primary" disabled={busy}>{editing ? 'Save' : 'Save and open'}</button>
      </footer>
    </form>
  </div>
}
