import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ErrorState, Notice } from '../../ui/Display'
import { formatMs } from './catalog'
import { EXAMPLE } from './examples'
import { CheckCircle2, ChevronDown, ChevronRight, Database, FileKey, Leaf, Link2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { CONNECTION_COLORS, type AgentAccess, type ConnectionColor, type ConnectionEnvironment, DatabaseEngine, OxeQueryConnection, OxeQueryConnectionInput, PickKind, SshAuth, SslMode } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { buildConnectionUrl, parseConnectionUrl } from './connection-url'
import { useShallow } from 'zustand/react/shallow'
import { useOxeQueryStore, type ConnectionDraft } from './oxequery.store'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { FieldError, Select, SegmentedControl, SwatchPicker, Switch } from '../../ui/Field'
import { splitHostInput } from '../../../shared/oxequeryHost'

/** Markup the translated sentences may use. */
const STRONG_AND_CODE = {
  strong: <strong />,
  code: <code />
}

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }
/** Product names stay as they are; what each engine is for comes from the catalog. */
const ENGINES: { id: DatabaseEngine; name: string; Icon: typeof Database }[] = [{ id: 'postgres', name: 'PostgreSQL', Icon: Database }, { id: 'mongodb', name: 'MongoDB', Icon: Leaf }]
const ENVIRONMENTS: ConnectionEnvironment[] = ['local', 'dev', 'prod']
const TLS_MODES: SslMode[] = ['prefer', 'disable', 'require', 'verify-ca', 'verify-full']

export function ConnectionDialog(): ReactElement | null {
  const { open, editing, draft } = useOxeQueryStore(state => state.dialog)
  if (!open) return null
  return <ConnectionForm key={editing?.id ?? `new:${draft?.containerRef ?? ''}`} editing={editing} draft={draft} />
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
  const { t } = useTranslation('oxequery')
  const [error, setError] = useState('')
  const choose = async (): Promise<void> => {
    setError('')
    try { const file = await oq('files.pick', { kind }); if (file) onPicked(file) } catch (cause) { setError(errorMessage(cause)) }
  }
  const current = picked?.name ?? (existing ? t('form.saved') : '')
  return <div className="oq-filepick">
    <span>{label}</span>
    <button type="button" onClick={() => void choose()}><FileKey size={13} aria-hidden="true" />{current ? t('form.replace') : t('form.chooseFile')}</button>
    {current && <code title={current}>{current}</code>}
    {current && <button type="button" className="oq-link" onClick={onClear}>{t('common.remove')}</button>}
    {error && <FieldError className="oq-filepick-error">{error}</FieldError>}
  </div>
}

function ConnectionForm({ editing, draft }: { editing: OxeQueryConnection | null; draft?: ConnectionDraft }): ReactElement {
  const { t } = useTranslation('oxequery')
  const close = useOxeQueryStore(state => state.closeDialog)
  // A draft comes from a database container in OxePod: everything but the password is filled in.
  const seed = editing ?? draft
  const containerRef = editing?.containerRef ?? draft?.containerRef
  const [engine, setEngine] = useState<DatabaseEngine>(seed?.engine ?? 'postgres')
  const [name, setName] = useState(seed?.name ?? '')
  const [host, setHost] = useState(seed?.host ?? '127.0.0.1')
  const [port, setPort] = useState(String(seed?.port ?? DEFAULT_PORT[seed?.engine ?? 'postgres']))
  const [database, setDatabase] = useState(seed?.database ?? '')
  const [username, setUsername] = useState(seed?.username ?? '')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [environment, setEnvironment] = useState<ConnectionEnvironment>(editing?.environment ?? 'local')
  const [readOnly, setReadOnly] = useState(editing?.readOnly ?? true)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  // Like DBeaver's "Connect by" and Compass's URI box: a connection string or the separate fields.
  // MongoDB users usually hold a URI, PostgreSQL users usually fill in a host.
  const [mode, setMode] = useState<'host' | 'url'>('host')

  // libpq's default: try TLS and fall back to a plain connection only when the server has none.
  const [sslMode, setSslMode] = useState<SslMode>(editing?.sslMode ?? 'prefer')
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
  const [group, setGroup] = useState(editing?.group ?? '')
  const [favorite, setFavorite] = useState(editing?.favorite ?? false)
  const [color, setColor] = useState<ConnectionColor | ''>(editing?.color ?? '')
  const [maskNames, setMaskNames] = useState((editing?.maskPatterns ?? []).join('\n'))
  const [keepalive, setKeepalive] = useState(String(editing?.keepaliveSeconds ?? 30))
  const groups = useOxeQueryStore(useShallow(state => [...new Set(state.connections.map(item => item.group).filter(Boolean))].sort()))

  const [open, setOpen] = useState({ tls: sslMode !== 'disable' && sslMode !== 'prefer', ssh: Boolean(editing?.ssh), mongo: Boolean(editing && (editing.mongo.authSource || editing.mongo.replicaSet || editing.mongo.srv || editing.mongo.extraHosts.length)), limits: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<Outcome>(null)

  const applyUrl = (text: string): void => {
    setUrl(text)
    if (!text.trim()) { setUrlError(''); return }
    const parsed = parseConnectionUrl(text)
    if (!parsed.ok) { setUrlError(t(`url.${parsed.error}`, { scheme: parsed.scheme ?? '' })); return }
    const value = parsed.value
    setUrlError('')
    setEngine(value.engine); setHost(value.host); setPort(String(value.port)); setDatabase(value.database); setUsername(value.username)
    if (value.password) { setPassword(value.password); setClearPassword(false) }
    setSslMode(value.sslMode)
    setAuthSource(value.mongo.authSource); setReplicaSet(value.mongo.replicaSet); setExtraHosts(value.mongo.extraHosts.join('\n')); setSrv(value.mongo.srv); setDirect(value.mongo.directConnection)
    setOpen(current => ({ ...current, tls: (value.sslMode !== 'disable' && value.sslMode !== 'prefer') || current.tls, mongo: value.engine === 'mongodb' && Boolean(value.mongo.authSource || value.mongo.replicaSet || value.mongo.srv || value.mongo.extraHosts.length) || current.mongo }))
    setName(current => current || `${value.username ? `${value.username}@` : ''}${value.host}${value.database ? `/${value.database}` : ''}`)
  }

  const currentUrlParts = () => ({ engine, host, port: Number(port) || DEFAULT_PORT[engine], database, username, sslMode, mongo: { authSource, replicaSet, directConnection: direct, srv, extraHosts: extraHosts.split(/\r?\n|,/).map(entry => entry.trim()).filter(Boolean) } })
  const switchMode = (next: 'host' | 'url'): void => {
    if (next === mode) return
    // Going to the string writes it from the fields (without the password); coming back keeps what the string filled in.
    if (next === 'url' && !url.trim()) { setUrl(buildConnectionUrl(currentUrlParts())); setUrlError('') }
    setMode(next)
  }
  const derivedName = `${username ? `${username}@` : ''}${host}${database ? `/${database}` : ''}`

  const chooseEngine = (next: DatabaseEngine): void => {
    if (recordId) return
    setEngine(next)
    if (!url.trim()) setMode(next === 'mongodb' ? 'url' : 'host')
    setPort(current => (Number(current) === DEFAULT_PORT[engine] ? String(DEFAULT_PORT[next]) : current))
  }

  // "Test" has to save first (the secrets live in the store). The id it was saved
  // under is kept, so testing again updates that record instead of adding another.
  const [savedId, setSavedId] = useState<string | null>(null)
  const recordId = editing?.id ?? savedId

  const input = (): OxeQueryConnectionInput => ({
    ...(recordId ? { id: recordId } : {}), name: name.trim() || derivedName, engine, host, port: Number(port), database, username, sslMode, environment, readOnly,
    ...(containerRef ? { containerRef } : {}),
    ...(password ? { password } : {}), ...(clearPassword ? { clearPassword: true } : {}),
    ...(ca ? { caHandle: ca.handle } : {}), ...(clearCa ? { clearCa: true } : {}),
    ...(cert && certKey ? { clientCertHandle: cert.handle, clientKeyHandle: certKey.handle } : {}), ...(clearClient ? { clearClientCert: true } : {}),
    mongo: engine === 'mongodb' ? { authSource, replicaSet, directConnection: direct, srv, extraHosts: extraHosts.split(/\r?\n|,/).map(entry => entry.trim()).filter(Boolean) } : undefined,
    ssh: sshEnabled
      ? { enabled: true, host: sshHost, port: Number(sshPort), user: sshUser, auth: sshAuth, ...(sshAuth === 'password' && sshSecret ? { password: sshSecret } : {}),
        ...(sshAuth === 'key' && sshKey ? { keyHandle: sshKey.handle, ...(sshPassphrase ? { passphrase: sshPassphrase } : {}) } : {}) }
      : { enabled: false },
    statementTimeoutMs: Math.round(Number(timeoutSeconds) * 1000), maxRows: Number(maxRows), agentAccess,
    group: group.trim(), favorite, color, maskPatterns: maskNames.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean), keepaliveSeconds: Math.round(Number(keepalive))
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

  // The connection lives in memory for this session: no record, no saved password, no history.
  const connectOnce = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const made = await oq('connections.connectEphemeral', input())
      await useOxeQueryStore.getState().refreshConnections()
      useOxeQueryStore.getState().closeDialog()
      useOxeQueryStore.getState().openConnection(made)
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const runTest = async (id: string): Promise<void> => {
    const result = await oq('connections.test', { id })
    if (result.ok) {
      setOutcome({ kind: 'ok', message: [result.serverVersion ? t('reconnect.connectedTo', { version: result.serverVersion }) : t('reconnect.connected'), result.latencyMs !== undefined ? t('form.latency', { duration: formatMs(result.latencyMs) }) : ''].filter(Boolean).join(' ') })
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

  const title = editing ? t('form.editTitle') : t('connections.new')
  const description = editing?.containerRef ? t('form.fromContainer', { name: editing.containerRef }) : draft?.containerRef ? t('form.fromContainerDraft', { name: draft.containerRef }) : t('form.description')
  return <Dialog className="oq-scope" title={title} description={description} size="lg" closeLabel={t('common.close')} onClose={() => { if (!busy) close() }}
    footer={<>
      <Button disabled={busy} loading={busy} onClick={() => void check()}>{t('form.test')}</Button>
      {!editing && <Button disabled={busy} onClick={() => void connectOnce()} title={t('form.connectOnceTitle')}>{t('form.connectOnce')}</Button>}
      <span className="oq-spacer" />
      <Button disabled={busy} onClick={close}>{t('common.cancel')}</Button>
      <Button type="submit" form="oq-connection-form" variant="primary" disabled={busy}>{editing ? t('common.save') : t('form.saveOpen')}</Button>
    </>}>
    <form id="oq-connection-form" className="oq-dialog-form" onSubmit={event => void submit(event)}>
      {!editing && <section className="oq-engines" role="radiogroup" aria-label={t('newDatabase.engine')}>
        {ENGINES.map(({ id, name: label, Icon }) => <button key={id} type="button" role="radio" aria-checked={engine === id} className="oq-engine" data-selected={engine === id} onClick={() => chooseEngine(id)}>
          <Icon size={18} aria-hidden="true" /><span><strong>{label}</strong><small>{t(`form.engineHint.${id}`)}</small></span></button>)}
      </section>}

      <div className="oq-connect-by"><span>{t('form.connectBy')}</span>
        <SegmentedControl label={t('form.connectBy')} value={mode} onChange={switchMode} options={[{ value: 'host', label: t('form.host') }, { value: 'url', label: t('form.url') }]} />
      </div>

      {mode === 'url' && <label className="oq-url"><span><Link2 size={13} aria-hidden="true" /> {t('form.connectionString')}</span>
        <textarea rows={2} value={url} required onChange={event => applyUrl(event.target.value)} spellCheck={false} autoComplete="off" aria-label={t('form.connectionString')} aria-invalid={urlError ? true : undefined} aria-describedby={urlError ? 'oq-url-error' : undefined}
          placeholder={engine === 'mongodb' ? 'mongodb://user:password@localhost:27017/app' : 'postgres://user:password@localhost:5432/app'} />
        {urlError ? <FieldError id="oq-url-error">{urlError}</FieldError> : <small>{t('form.urlHint')}</small>}</label>}

      <div className="oq-form">
        <label className="oq-form-wide">{t('server.column.name')}<input value={name} onChange={event => setName(event.target.value)} placeholder={derivedName.trim() && derivedName !== '127.0.0.1' ? derivedName : t(`form.namePlaceholder.${engine}`)} autoFocus={!draft} /></label>
        <label>{t('form.group')}<input list="oq-groups" value={group} onChange={event => setGroup(event.target.value)} placeholder={t('form.noGroup')} maxLength={60} /></label>
        <datalist id="oq-groups">{groups.map(item => <option key={item} value={item} />)}</datalist>
        <div className="oq-form-pair"><SwatchPicker<ConnectionColor | ''> label={t('form.color')} value={color} onChange={setColor}
          // The same colours as .oq-color-dot: CONNECTION_COLORS in order are --avatar-1 to --avatar-6.
          options={[{ value: '', label: t('form.noColor') }, ...CONNECTION_COLORS.map((item, index) => ({ value: item, label: t(`form.colors.${item}`), color: `var(--avatar-${index + 1})` }))]} />
          <label className="oq-check"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />{t('form.favorite')}</label></div>
        {mode === 'host' && <>
        <label>{srv ? t('form.seedHost') : t('form.host')}<input value={host} onChange={event => setHost(event.target.value)} onBlur={() => {
          // A host pasted as a URL keeps only its name; a port written after it fills the Port field.
          const pasted = splitHostInput(host)
          if (pasted.host !== host) setHost(pasted.host)
          if (pasted.port && !srv) setPort(String(pasted.port))
        }} required spellCheck={false} /></label>
        {!srv && <label>{t('form.port')}<input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} required /></label>}
        <label>{t('form.user')}<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        <label>{t('form.password')}<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" autoFocus={Boolean(draft)}
          placeholder={editing?.hasPassword && !clearPassword ? t('form.keepSaved') : ''} aria-describedby={draft ? 'oq-draft-password' : undefined} /></label>
        {draft && <small id="oq-draft-password" className="oq-muted oq-form-wide">{t('form.containerPassword')}</small>}
        <label className="oq-form-wide">{t('form.database')}<input value={database} onChange={event => setDatabase(event.target.value)} spellCheck={false}
          placeholder={engine === 'postgres' ? 'postgres' : t('form.optional')} /></label>
        {editing?.hasPassword && <label className="oq-check oq-form-wide"><input type="checkbox" checked={clearPassword} onChange={event => setClearPassword(event.target.checked)} />{t('form.clearPassword')}</label>}
        </>}
      </div>

      <section className="oq-safety" aria-label={t('form.safety')}>
        <SegmentedControl label={t('form.environment')} className="oq-environment" value={environment}
          options={ENVIRONMENTS.map(item => ({ value: item, label: t(`environment.${item}`), tone: item === 'prod' ? 'danger' as const : undefined }))}
          onChange={item => { setEnvironment(item); if (item === 'prod' && agentAccess === 'write') setAgentAccess('read') }} />
        <Switch checked={readOnly} onChange={setReadOnly} label={t('form.readOnly')} description={t('form.readOnlyHint')} />
        {environment === 'prod' && !readOnly && <p className="oq-warning" role="note"><ShieldAlert size={14} aria-hidden="true" /> {t('form.prodWrites')}</p>}
      </section>

      <Section title={t('form.tls')} hint={t(`form.tlsHint.${sslMode === 'verify-ca' || sslMode === 'verify-full' ? 'verified' : sslMode}`)} open={open.tls} onToggle={() => toggle('tls')}>
        <label className="oq-form-wide">{t('form.encryption')}<Select className="oq-select" value={sslMode} onChange={event => setSslMode(event.target.value as SslMode)}>
          {TLS_MODES.map(mode => <option key={mode} value={mode}>{t(`form.tlsMode.${mode}`)}</option>)}</Select></label>
        {sslMode === 'require' && <p className="oq-warning" role="note"><ShieldAlert size={14} aria-hidden="true" /> {t('form.requireWarning')}</p>}
        {(sslMode === 'verify-ca' || sslMode === 'verify-full') && <>
          <FilePick label={t('form.ca')} kind="ca" picked={ca} existing={Boolean(editing?.hasCa) && !clearCa} onPicked={file => { setCa(file); setClearCa(false) }} onClear={() => { setCa(null); setClearCa(true) }} />
          <FilePick label={t('form.clientCert')} kind="cert" picked={cert} existing={Boolean(editing?.hasClientCert) && !clearClient} onPicked={file => { setCert(file); setClearClient(false) }} onClear={() => { setCert(null); setCertKey(null); setClearClient(true) }} />
          <FilePick label={t('form.clientKey')} kind="key" picked={certKey} existing={Boolean(editing?.hasClientCert) && !clearClient} onPicked={file => { setCertKey(file); setClearClient(false) }} onClear={() => { setCert(null); setCertKey(null); setClearClient(true) }} />
          <p className="oq-muted">{t('form.caHint')}</p>
        </>}
      </Section>

      <Section title={t('form.ssh')} hint={sshEnabled ? t('form.via', { host: sshHost || '…' }) : t('form.tlsHint.disable')} open={open.ssh} onToggle={() => toggle('ssh')}>
        <label className="oq-check oq-form-wide"><input type="checkbox" checked={sshEnabled} onChange={event => setSshEnabled(event.target.checked)} />{t('form.sshEnable')}</label>
        {sshEnabled && <div className="oq-form">
          <label>{t('form.sshHost')}<input value={sshHost} onChange={event => setSshHost(event.target.value)} spellCheck={false} required /></label>
          <label>{t('form.sshPort')}<input type="number" min={1} max={65535} value={sshPort} onChange={event => setSshPort(event.target.value)} /></label>
          <label>{t('form.sshUser')}<input value={sshUser} onChange={event => setSshUser(event.target.value)} spellCheck={false} autoComplete="off" required /></label>
          <label>{t('form.auth')}<Select className="oq-select" value={sshAuth} onChange={event => setSshAuth(event.target.value as SshAuth)}><option value="key">{t('form.privateKey')}</option><option value="password">{t('form.password')}</option><option value="agent">{t('form.sshAgent')}</option></Select></label>
          {sshAuth === 'agent' ? <p className="oq-muted oq-form-wide">{t('form.agentHint')}</p> : sshAuth === 'key'
            ? <div className="oq-form-wide">
              <FilePick label={t('form.privateKey')} kind="sshKey" picked={sshKey} existing={Boolean(editing?.ssh?.hasSecret && editing.ssh.auth === 'key')}
                onPicked={file => setSshKey(file)} onClear={() => setSshKey(null)} />
              {editing?.ssh?.keyName && !sshKey && <p className="oq-muted">{t('form.savedKey', { name: editing.ssh.keyName })}</p>}
              <label>{t('form.passphrase')}<input type="password" value={sshPassphrase} onChange={event => setSshPassphrase(event.target.value)} autoComplete="new-password" placeholder={t('form.passphraseHint')} /></label>
            </div>
            : <label className="oq-form-wide">{t('form.sshPassword')}<input type="password" value={sshSecret} onChange={event => setSshSecret(event.target.value)} autoComplete="new-password"
              placeholder={editing?.ssh?.hasSecret && editing.ssh.auth === 'password' ? t('form.keepSaved') : ''} /></label>}
          <p className="oq-muted oq-form-wide">{t('form.hostKeyHint')}</p>
        </div>}
      </Section>

      {engine === 'mongodb' && <Section title={t('form.mongoOptions')} hint={srv ? 'SRV' : replicaSet || authSource ? t('form.custom') : t('form.defaults')} open={open.mongo} onToggle={() => toggle('mongo')}>
        <div className="oq-form">
          <label>{t('form.authSource')}<input value={authSource} onChange={event => setAuthSource(event.target.value)} placeholder={EXAMPLE.authSource} spellCheck={false} /></label>
          <label>{t('form.replicaSet')}<input value={replicaSet} onChange={event => setReplicaSet(event.target.value)} spellCheck={false} /></label>
          <label className="oq-check oq-form-wide"><input type="checkbox" checked={srv} onChange={event => setSrv(event.target.checked)} />{t('form.srv')}</label>
          {!srv && <label className="oq-form-wide">{t('form.extraHosts')} <small>{t('form.extraHostsHint')}</small><textarea rows={2} value={extraHosts} onChange={event => setExtraHosts(event.target.value)} spellCheck={false} /></label>}
          <label className="oq-check oq-form-wide"><input type="checkbox" checked={direct} disabled={srv} onChange={event => setDirect(event.target.checked)} />{t('form.direct')}</label>
        </div>
      </Section>}

      <Section title={t('form.limits')} hint={t(`form.agentsHint.${agentAccess}`)} open={open.limits} onToggle={() => toggle('limits')}>
        <div className="oq-form">
          <label>{t('form.timeout')}<input type="number" min={1} max={3600} value={timeoutSeconds} onChange={event => setTimeoutSeconds(event.target.value)} /></label>
          <label>{t('form.maxRows')}<input type="number" min={1} max={100000} value={maxRows} onChange={event => setMaxRows(event.target.value)} /></label>
          <label className="oq-form-wide">{t('form.agents')}
            <Select className="oq-select" value={agentAccess} onChange={event => setAgentAccess(event.target.value as AgentAccess)}>
              <option value="off">{t('form.agentOff')}</option>
              <option value="read">{t('form.agentRead')}</option>
              <option value="write" disabled={environment === 'prod'}>{t('form.agentWrite')}</option>
            </Select>
          </label>
          {environment === 'prod' && <p className="oq-muted oq-form-wide">{t('form.agentProd')}</p>}
          <label>{t('form.keepalive')}<input type="number" min={0} max={3600} value={keepalive} onChange={event => setKeepalive(event.target.value)} /><small>{t('form.keepaliveHint')}</small></label>
          <label className="oq-form-wide">{t('form.mask')} <small>{t('form.maskHint')}</small>
            <textarea rows={3} value={maskNames} onChange={event => setMaskNames(event.target.value)} spellCheck={false} placeholder={EXAMPLE.maskedNames} /></label>
        </div>
      </Section>

      {error && <ErrorState compact title={t('form.failed')} message={error} />}
      {outcome?.kind === 'ok' && <p role="status" className="oq-outcome oq-outcome-ok"><CheckCircle2 size={15} aria-hidden="true" />{outcome.message}</p>}
      {outcome?.kind === 'fail' && <ErrorState compact title={t('form.testFailed')} message={outcome.message} />}
      {outcome?.kind === 'hostkey' && <ConfirmDialog title={t('form.trustTitle')} confirmLabel={t('form.trustConfirm')} cancelLabel={t('common.cancel')} busy={busy}
        description={<Trans t={t} i18nKey="form.trustDescription" values={{ host: outcome.host }} components={STRONG_AND_CODE} />}
        onCancel={() => setOutcome(null)} onConfirm={() => void trustAndRetry()}>
        <code className="oq-fingerprint">{outcome.fingerprint}</code>
      </ConfirmDialog>}
      {outcome?.kind === 'hostkey-changed' && <Notice intent="danger" className="oq-hostkey-notice">
        <p><Trans t={t} i18nKey="form.keyChanged" components={{ strong: <strong /> }} /></p>
        <code className="oq-fingerprint">{t('form.trusted', { fingerprint: outcome.expected })}</code><code className="oq-fingerprint">{t('form.now', { fingerprint: outcome.actual })}</code>
      </Notice>}
    </form>
  </Dialog>
}
