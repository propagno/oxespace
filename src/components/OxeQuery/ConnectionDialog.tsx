import { useState, type FormEvent, type ReactElement } from 'react'
import type { ConnectionEnvironment, DatabaseEngine, OxeQueryConnection, SslMode } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }

export function ConnectionDialog(): ReactElement | null {
  const { open, editing } = useOxeQueryStore(state => state.dialog)
  if (!open) return null
  return <ConnectionForm key={editing?.id ?? 'new'} editing={editing} />
}

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [test, setTest] = useState('')

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
    setBusy(true); setError(''); setTest('')
    try {
      const saved = await save()
      await useOxeQueryStore.getState().refreshConnections()
      const result = await oq('connections.test', { id: saved.id })
      setTest(result.ok ? `Connected${result.serverVersion ? ` · ${result.serverVersion}` : ''}${result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : ''}` : result.message)
      if (!result.ok) setError(result.message)
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  return <div className="desktop-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="desktop-dialog oq-dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Edit connection' : 'New connection'} onSubmit={event => void submit(event)}>
      <header className="desktop-dialog-header"><div><h2>{editing ? 'Edit connection' : 'New connection'}</h2><p>Passwords are kept in the operating system's secure storage and never shown again.</p></div></header>
      <div className="oq-form">
        <label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Local Postgres" required autoFocus /></label>
        <label>Engine<select value={engine} disabled={Boolean(editing)} onChange={event => { const next = event.target.value as DatabaseEngine; setEngine(next); setPort(String(DEFAULT_PORT[next])) }}>
          <option value="postgres">PostgreSQL</option><option value="mongodb">MongoDB</option></select></label>
        <label className="oq-form-wide">Host<input value={host} onChange={event => setHost(event.target.value)} required /></label>
        <label>Port<input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} required /></label>
        <label>Database<input value={database} onChange={event => setDatabase(event.target.value)} placeholder={engine === 'postgres' ? 'postgres' : 'optional'} /></label>
        <label>User<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password"
          placeholder={editing?.hasPassword && !clearPassword ? 'Saved — leave blank to keep' : ''} /></label>
        {editing?.hasPassword && <label className="oq-check"><input type="checkbox" checked={clearPassword} onChange={event => setClearPassword(event.target.checked)} />Remove the saved password</label>}
        <label>TLS<select value={sslMode} onChange={event => setSslMode(event.target.value as SslMode)}>
          <option value="disable">Off</option><option value="prefer">Off (prefer, not negotiated)</option><option value="require">Required (certificate not verified)</option></select></label>
        <label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value as ConnectionEnvironment)}>
          <option value="local">Local</option><option value="dev">Development</option><option value="prod">Production</option></select></label>
        <label className="oq-check oq-form-wide"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />Read-only: statements that change data are refused</label>
      </div>
      {error && <p role="alert" className="oq-error">{error}</p>}
      {test && !error && <p role="status" className="oq-ok">{test}</p>}
      <footer className="oq-dialog-actions">
        <button type="button" onClick={() => void check()} disabled={busy}>Test connection</button>
        <span />
        <button type="button" onClick={close} disabled={busy}>Cancel</button>
        <button type="submit" className="oq-primary" disabled={busy}>Save</button>
      </footer>
    </form>
  </div>
}
