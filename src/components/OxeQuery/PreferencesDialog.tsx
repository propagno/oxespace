import { useEffect, useState, type ReactElement } from 'react'
import type { AgentAccess, ConnectionEnvironment, OxeQueryPreferences } from '../../../shared/types/oxequery'
import { Button, Dialog, Select, LoadingState } from '../../ui'
import { errorMessage, oq } from './client'

const HISTORY = [50, 100, 200, 500, 1000, 2000]
const AUDIT_DAYS = [30, 90, 180, 365]
const ENVIRONMENTS: { id: ConnectionEnvironment; label: string }[] = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Development' }, { id: 'prod', label: 'Production' }]

/** OxeQuery's own settings: how long things are kept, and how much an agent may be given by kind of environment. */
export function PreferencesDialog({ onClose }: { onClose: () => void }): ReactElement {
  const [value, setValue] = useState<OxeQueryPreferences | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    oq('preferences.get', {}).then(result => { if (alive) setValue(result) }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [])

  const save = async (): Promise<void> => {
    if (!value) return
    setBusy(true); setError(''); setSaved(false)
    try { setValue(await oq('preferences.set', value)); setSaved(true) } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const change = (patch: Partial<OxeQueryPreferences>): void => { setSaved(false); setValue(current => current ? { ...current, ...patch } : current) }

  return <Dialog className="oq-scope" title="OxeQuery settings" description="What is kept, and how far agents may go." size="md" onClose={onClose} testId="oxequery-preferences"
    footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} disabled={!value} onClick={() => void save()}>Save</Button></>}>
    {error && <p role="alert">{error}</p>}
    {!value && !error ? <LoadingState label="Loading preferences…" /> : value && <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Select label="Statements kept per connection" hint="The query history under Library. Older statements are dropped." value={String(value.historyLimit)}
        onChange={event => change({ historyLimit: Number(event.target.value) })} options={[...new Set([...HISTORY, value.historyLimit])].sort((a, b) => a - b).map(item => ({ value: String(item), label: `${item}` }))} />
      <Select label="Keep the agent audit log for" hint="Every request an agent made through OxeQuery, with what was decided." value={String(value.auditRetentionDays)}
        onChange={event => change({ auditRetentionDays: Number(event.target.value) })} options={[...new Set([...AUDIT_DAYS, value.auditRetentionDays])].sort((a, b) => a - b).map(item => ({ value: String(item), label: `${item} days` }))} />
      <fieldset style={{ display: 'grid', gap: 'var(--space-3)', border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>The most an agent may be given on a connection that is…</legend>
        {ENVIRONMENTS.map(environment => <Select key={environment.id} label={environment.label} value={value.agentCeiling[environment.id]}
          onChange={event => change({ agentCeiling: { ...value.agentCeiling, [environment.id]: event.target.value as AgentAccess } })}
          options={[{ value: 'off', label: 'No access' }, { value: 'read', label: 'Read, with approval' }, { value: 'write', label: 'Read and write, with approval', disabled: environment.id === 'prod' }]} />)}
        <small style={{ color: 'var(--text-muted)' }}>A connection's own agent setting can only be lower than this. Agents never write to production.</small>
      </fieldset>
      {saved && <p role="status">Saved.</p>}
    </div>}
  </Dialog>
}
