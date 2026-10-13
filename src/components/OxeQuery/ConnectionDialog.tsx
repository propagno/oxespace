import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Database, FileKey, Leaf, Link2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import type { AgentAccess, ConnectionEnvironment, DatabaseEngine, OxeQueryConnection, OxeQueryConnectionInput, PickKind, SshAuth, SslMode } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { parseConnectionUrl } from './connection-url'
import { useOxeQueryStore } from './oxequery.store'

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }
const ENGINES: { id: DatabaseEngine; label: string; hint: string; Icon: typeof Database }[] = [
  { id: 'postgres', label: 'PostgreSQL', hint: 'SQL editor and schema browser', Icon: Database },
  { id: 'mongodb', label: 'MongoDB', hint: 'Collections, find and aggregate', Icon: Leaf }
]
const ENVIRONMENTS: { id: ConnectionEnvironment; label: string }[] = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Development' }, { id: 'prod', label: 'Production' }]
const TLS_MODES: { id: SslMode; label: string }[] = [
  { id: 'disable', label: 'Off' },
  { id: 'require', label: 'Encrypted — certificate NOT verified' },
  { id: 'verify-ca', label: 'Verify the certificate chain' },
  { id: 'verify-full', label: 'Verify the chain and the host name (recommended)' }
]

export function ConnectionDialog(): ReactElement | null {
  const { open, editing } = useOxeQueryStore(state => state.dialog)
  if (!open) return null
  return <ConnectionForm key={editing?.id ?? 'new'} editing={editing} />
}

type Outcome =
  | { kind: 'ok' | 'fail'; message: string }
  | { kind: 'hostkey'; connectionId: string; fingerprint: string; host: string }
  | { kind: 'hostkey-changed'; expected: string; actual: string }
  | null

interface Picked { handle: string; name: string }

function Section({ title, hint, open, onToggle, children }: { title: string; hint?: string; open: boolean; onToggle(): void; children: ReactNode }): ReactElement {
  return <section className="oq-section">
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={onToggle}>
      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{title}{hint && <small>{hint}</small>}</button>
    {open && <div className="oq-section-body">{children}</div>}
  </section>
}

function FilePick({ label, kind, picked, existing, onPicked, onClear }: { label: string; kind: PickKind; picked: Picked | null; existing: boolean; onPicked(file: Picked): void; onClear(): void }): ReactElement {
  const [error, setError] = useState('')
  const choose = async (): Promise<void> => {
    setError('')
    try { const file = await oq('files.pick', { kind }); if (file) onPicked(file) } catch (cause) { setError(errorMessage(cause)) }
  }
  const current = picked?.name ?? (existing ? 'Saved' : '')
  return <div className="oq-filepick">
    <span>{label}</span>
    <button type="button" onClick={() => void choose()}><FileKey size={13} aria-hidden="true" />{current ? 'Replace…' : 'Choose file…'}</button>
    {current && <code title={current}>{current}</code>}
    {current && <button type="button" className="oq-link" onClick={onClear}>Remove</button>}
    {error && <em role="alert">{error}</em>}
  </div>
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
  const [environment, setEnvironment] = useState<ConnectionEnvironment>(editing?.environment ?? 'local')
  const [readOnly, setReadOnly] = useState(editing?.readOnly ?? true)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')

  const [sslMode, setSslMode] = useState<SslMode>(editing?.sslMode ?? 'disable')
  const [ca, setCa] = useState<Picked | null>(null)
  const [clearCa, setClearCa] = useState(false)
  const [cert, setCert] = useState<Picked | null>(null)
  const [certKey, setCertKey] = useState<Picked | null>(null)
  const [clearClient, setClearClient] = useState(false)

  const [sshEnabled, setSshEnabled] = useState(Boolean(editing?.ssh))
  const [sshHost, setSshHost] = useState(editing?.ssh?.host ?? '')
  const [sshPort, setSshPort] = useState(String(editing?.ssh?.port ?? 22))
  const [sshUser, setSshUser] = useState(editing?.ssh?.user ?? '')
  const [sshAuth, setSshAuth] = useState<SshAuth>(editing?.ssh?.auth ?? 'key')
  const [sshKey, setSshKey] = useState<Picked | null>(null)
  const [sshSecret, setSshSecret] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')

  const [authSource, setAuthSource] = useState(editing?.mongo.authSource ?? '')
  const [replicaSet, setReplicaSet] = useState(editing?.mongo.replicaSet ?? '')
  const [extraHosts, setExtraHosts] = useState((editing?.mongo.extraHosts ?? []).join('\n'))
  const [srv, setSrv] = useState(editing?.mongo.srv ?? false)
  const [direct, setDirect] = useState(editing?.mongo.directConnection ?? true)

  const [timeoutSeconds, setTimeoutSeconds] = useState(String(Math.round((editing?.statementTimeoutMs ?? 60_000) / 1000)))
  const [maxRows, setMaxRows] = useState(String(editing?.maxRows ?? 500))
  const [agentAccess, setAgentAccess] = useState<AgentAccess>(editing?.agentAccess ?? 'off')

  const [open, setOpen] = useState({ tls: sslMode !== 'disable', ssh: Boolean(editing?.ssh), mongo: Boolean(editing && (editing.mongo.authSource || editing.mongo.replicaSet || editing.mongo.srv || editing.mongo.extraHosts.length)), limits: false })
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
    setSslMode(value.sslMode)
    setAuthSource(value.mongo.authSource); setReplicaSet(value.mongo.replicaSet); setExtraHosts(value.mongo.extraHosts.join('\n')); setSrv(value.mongo.srv); setDirect(value.mongo.directConnection)
    setOpen(current => ({ ...current, tls: value.sslMode !== 'disable' || current.tls, mongo: value.engine === 'mongodb' && Boolean(value.mongo.authSource || value.mongo.replicaSet || value.mongo.srv || value.mongo.extraHosts.length) || current.mongo }))
    setName(current => current || `${value.username ? `${value.username}@` : ''}${value.host}${value.database ? `/${value.database}` : ''}`)
  }

  const chooseEngine = (next: DatabaseEngine): void => {
    if (recordId) return
    setEngine(next)
    setPort(current => (Number(current) === DEFAULT_PORT[engine] ? String(DEFAULT_PORT[next]) : current))
  }

  // "Test" has to save first (the secrets live in the store). The id it was saved
  // under is kept, so testing again updates that record instead of adding another.
  const [savedId, setSavedId] = useState<string | null>(null)
  const recordId = editing?.id ?? savedId

  const input = (): OxeQueryConnectionInput => ({
    ...(recordId ? { id: recordId } : {}), name, engine, host, port: Number(port), database, username, sslMode, environment, readOnly,
    ...(editing?.containerRef ? { containerRef: editing.containerRef } : {}),
    ...(password ? { password } : {}), ...(clearPassword ? { clearPassword: true } : {}),
    ...(ca ? { caHandle: ca.handle } : {}), ...(clearCa ? { clearCa: true } : {}),
    ...(cert && certKey ? { clientCertHandle: cert.handle, clientKeyHandle: certKey.handle } : {}), ...(clearClient ? { clearClientCert: true } : {}),
    mongo: engine === 'mongodb' ? { authSource, replicaSet, directConnection: direct, srv, extraHosts: extraHosts.split(/\r?\n|,/).map(entry => entry.trim()).filter(Boolean) } : undefined,
    ssh: sshEnabled
      ? { enabled: true, host: sshHost, port: Number(sshPort), user: sshUser, auth: sshAuth, ...(sshAuth === 'password' && sshSecret ? { password: sshSecret } : {}),
        ...(sshAuth === 'key' && sshKey ? { keyHandle: sshKey.handle, ...(sshPassphrase ? { passphrase: sshPassphrase } : {}) } : {}) }
      : { enabled: false },
    statementTimeoutMs: Math.round(Number(timeoutSeconds) * 1000), maxRows: Number(maxRows), agentAccess
  })

  const save = (): Promise<OxeQueryConnection> => oq('connections.save', input())

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

  const runTest = async (id: string): Promise<void> => {
    const result = await oq('connections.test', { id })
    if (result.ok) {
      setOutcome({ kind: 'ok', message: `Connected${result.serverVersion ? ` to ${result.serverVersion}` : ''}${result.latencyMs !== undefined ? ` in ${result.latencyMs} ms` : ''}.` })
    } else if (result.code === 'host-key-unknown' && result.reasons?.[0]) {
      setOutcome({ kind: 'hostkey', connectionId: id, fingerprint: result.reasons[0], host: `${sshHost}:${sshPort}` })
    } else if (result.code === 'host-key-changed') {
      setOutcome({ kind: 'hostkey-changed', expected: result.reasons?.[0] ?? '', actual: result.reasons?.[1] ?? '' })
    } else setOutcome({ kind: 'fail', message: result.message })
  }

  const check = async (): Promise<void> => {
    setBusy(true); setError(''); setOutcome(null)
    try {
      const saved = await save()
      setSavedId(saved.id)
      await useOxeQueryStore.getState().refreshConnections()
      await runTest(saved.id)
    } catch (cause) { setOutcome({ kind: 'fail', message: errorMessage(cause) }) } finally { setBusy(false) }
  }

  const trustAndRetry = async (): Promise<void> => {
    if (outcome?.kind !== 'hostkey') return
    setBusy(true)
    try {
      await oq('connections.trustHostKey', { id: outcome.connectionId, fingerprint: outcome.fingerprint })
      setOutcome(null)
      await runTest(outcome.connectionId)
    } catch (cause) { setOutcome({ kind: 'fail', message: errorMessage(cause) }) } finally { setBusy(false) }
  }

  const toggle = (key: keyof typeof open): void => setOpen(current => ({ ...current, [key]: !current[key] }))

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
        <label>{srv ? 'Seed list host' : 'Host'}<input value={host} onChange={event => setHost(event.target.value)} required spellCheck={false} /></label>
        {!srv && <label>Port<input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} required /></label>}
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
            onClick={() => { setEnvironment(item.id); if (item.id === 'prod' && agentAccess === 'write') setAgentAccess('read') }}>{item.label}</button>)}
        </div>
        <label className="oq-switch"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />
          <span><strong>Read-only</strong><small>The server refuses statements that change data. Turn off to write.</small></span></label>
        {environment === 'prod' && !readOnly && <p className="oq-warning" role="note"><ShieldAlert size={14} aria-hidden="true" /> This is a production connection with writes enabled. Destructive statements will still ask first.</p>}
      </section>

      <Section title="Security (TLS)" hint={sslMode === 'disable' ? 'off' : sslMode === 'require' ? 'not verified' : 'verified'} open={open.tls} onToggle={() => toggle('tls')}>
        <label className="oq-form-wide">Encryption<select value={sslMode} onChange={event => setSslMode(event.target.value as SslMode)}>
          {TLS_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>
        {sslMode === 'require' && <p className="oq-warning" role="note"><ShieldAlert size={14} aria-hidden="true" /> The connection is encrypted but the server is not authenticated, so someone in the middle could impersonate it.</p>}
        {(sslMode === 'verify-ca' || sslMode === 'verify-full') && <>
          <FilePick label="CA certificate" kind="ca" picked={ca} existing={Boolean(editing?.hasCa) && !clearCa} onPicked={file => { setCa(file); setClearCa(false) }} onClear={() => { setCa(null); setClearCa(true) }} />
          <FilePick label="Client certificate" kind="cert" picked={cert} existing={Boolean(editing?.hasClientCert) && !clearClient} onPicked={file => { setCert(file); setClearClient(false) }} onClear={() => { setCert(null); setCertKey(null); setClearClient(true) }} />
          <FilePick label="Client key" kind="key" picked={certKey} existing={Boolean(editing?.hasClientCert) && !clearClient} onPicked={file => { setCertKey(file); setClearClient(false) }} onClear={() => { setCert(null); setCertKey(null); setClearClient(true) }} />
          <p className="oq-muted">Without a CA file the system trust store is used.</p>
        </>}
      </Section>

      <Section title="SSH tunnel" hint={sshEnabled ? `via ${sshHost || '…'}` : 'off'} open={open.ssh} onToggle={() => toggle('ssh')}>
        <label className="oq-check oq-form-wide"><input type="checkbox" checked={sshEnabled} onChange={event => setSshEnabled(event.target.checked)} />Connect through an SSH server (bastion host)</label>
        {sshEnabled && <div className="oq-form">
          <label>SSH host<input value={sshHost} onChange={event => setSshHost(event.target.value)} spellCheck={false} required /></label>
          <label>SSH port<input type="number" min={1} max={65535} value={sshPort} onChange={event => setSshPort(event.target.value)} /></label>
          <label>SSH user<input value={sshUser} onChange={event => setSshUser(event.target.value)} spellCheck={false} autoComplete="off" required /></label>
          <label>Authentication<select value={sshAuth} onChange={event => setSshAuth(event.target.value as SshAuth)}><option value="key">Private key</option><option value="password">Password</option></select></label>
          {sshAuth === 'key'
            ? <div className="oq-form-wide">
              <FilePick label="Private key" kind="sshKey" picked={sshKey} existing={Boolean(editing?.ssh?.hasSecret && editing.ssh.auth === 'key')}
                onPicked={file => setSshKey(file)} onClear={() => setSshKey(null)} />
              {editing?.ssh?.keyName && !sshKey && <p className="oq-muted">Saved key: {editing.ssh.keyName}</p>}
              <label>Key passphrase<input type="password" value={sshPassphrase} onChange={event => setSshPassphrase(event.target.value)} autoComplete="new-password" placeholder="Only if the key is encrypted" /></label>
            </div>
            : <label className="oq-form-wide">SSH password<input type="password" value={sshSecret} onChange={event => setSshSecret(event.target.value)} autoComplete="new-password"
              placeholder={editing?.ssh?.hasSecret && editing.ssh.auth === 'password' ? 'Saved — leave blank to keep' : ''} /></label>}
          <p className="oq-muted oq-form-wide">The first time, you will be shown the server's key fingerprint to confirm. A different key later is refused.</p>
        </div>}
      </Section>

      {engine === 'mongodb' && <Section title="MongoDB options" hint={srv ? 'SRV' : replicaSet || authSource ? 'custom' : 'defaults'} open={open.mongo} onToggle={() => toggle('mongo')}>
        <div className="oq-form">
          <label>Auth source<input value={authSource} onChange={event => setAuthSource(event.target.value)} placeholder="admin" spellCheck={false} /></label>
          <label>Replica set<input value={replicaSet} onChange={event => setReplicaSet(event.target.value)} spellCheck={false} /></label>
          <label className="oq-check oq-form-wide"><input type="checkbox" checked={srv} onChange={event => setSrv(event.target.checked)} />Seed list (mongodb+srv — the host is a DNS name)</label>
          {!srv && <label className="oq-form-wide">Additional hosts <small>one host:port per line</small><textarea rows={2} value={extraHosts} onChange={event => setExtraHosts(event.target.value)} spellCheck={false} /></label>}
          <label className="oq-check oq-form-wide"><input type="checkbox" checked={direct} disabled={srv} onChange={event => setDirect(event.target.checked)} />Connect directly to this host (skip replica-set discovery)</label>
        </div>
      </Section>}

      <Section title="Limits and agents" hint={agentAccess === 'off' ? 'agents off' : `agents: ${agentAccess}`} open={open.limits} onToggle={() => toggle('limits')}>
        <div className="oq-form">
          <label>Statement timeout (seconds)<input type="number" min={1} max={3600} value={timeoutSeconds} onChange={event => setTimeoutSeconds(event.target.value)} /></label>
          <label>Default row limit<input type="number" min={1} max={10000} value={maxRows} onChange={event => setMaxRows(event.target.value)} /></label>
          <label className="oq-form-wide">AI agents
            <select value={agentAccess} onChange={event => setAgentAccess(event.target.value as AgentAccess)}>
              <option value="off">No access (default)</option>
              <option value="read">Read — agents may ask to read, each request needs your approval</option>
              <option value="write" disabled={environment === 'prod'}>Read and write — every change needs your approval</option>
            </select>
          </label>
          {environment === 'prod' && <p className="oq-muted oq-form-wide">Agents can never write to a production connection.</p>}
        </div>
      </Section>

      {error && <p role="alert" className="oq-error">{error}</p>}
      {outcome?.kind === 'ok' && <p role="status" className="oq-outcome oq-outcome-ok"><CheckCircle2 size={15} aria-hidden="true" />{outcome.message}</p>}
      {outcome?.kind === 'fail' && <p role="alert" className="oq-outcome oq-outcome-fail"><XCircle size={15} aria-hidden="true" />{outcome.message}</p>}
      {outcome?.kind === 'hostkey' && <div role="alertdialog" aria-label="Trust SSH host key" className="oq-hostkey">
        <p><ShieldCheck size={15} aria-hidden="true" /> <strong>{outcome.host}</strong> has not been seen before. Compare this fingerprint with the one your server reports (for example with <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>).</p>
        <code className="oq-fingerprint">{outcome.fingerprint}</code>
        <div><button type="button" onClick={() => setOutcome(null)} disabled={busy}>Cancel</button><button type="button" className="oq-primary" onClick={() => void trustAndRetry()} disabled={busy}>Trust this key and test again</button></div>
      </div>}
      {outcome?.kind === 'hostkey-changed' && <div role="alert" className="oq-hostkey oq-hostkey-danger">
        <p><ShieldAlert size={15} aria-hidden="true" /> <strong>The SSH server's host key changed.</strong> This can mean the server was rebuilt, or that someone is intercepting the connection. Do not continue until you have confirmed it with whoever runs the server.</p>
        <code className="oq-fingerprint">trusted: {outcome.expected}</code><code className="oq-fingerprint">now: {outcome.actual}</code>
      </div>}

      <footer className="oq-dialog-actions">
        <button type="button" onClick={() => void check()} disabled={busy}>{busy ? 'Working…' : 'Test connection'}</button>
        <span className="oq-spacer" />
        <button type="button" onClick={close} disabled={busy}>Cancel</button>
        <button type="submit" className="oq-primary" disabled={busy}>{editing ? 'Save' : 'Save and open'}</button>
      </footer>
    </form>
  </div>
}
