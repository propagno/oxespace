import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAccess, ConnectionEnvironment, OxeQueryPreferences } from '../../../shared/types/oxequery'
import { Button, Dialog, ErrorState, Select, LoadingState } from '../../ui'
import { errorMessage, oq } from './client'
import { formatNumber } from '../../utils/formatTime'

const HISTORY = [50, 100, 200, 500, 1000, 2000]
const AUDIT_DAYS = [30, 90, 180, 365]
const ENVIRONMENTS: ConnectionEnvironment[] = ['local', 'dev', 'prod']

/** OxeQuery's own settings: how long things are kept, and how much an agent may be given by kind of environment. */
export function PreferencesDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
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

  return <Dialog className="oq-scope" title={t('preferences.title')} description={t('preferences.description')} size="md" onClose={onClose} closeLabel={t('common.close')} testId="oxequery-preferences"
    footer={<><Button variant="ghost" onClick={onClose}>{t('common.close')}</Button><Button variant="primary" loading={busy} disabled={!value} onClick={() => void save()}>{t('common.save')}</Button></>}>
    {error && <ErrorState compact title={t(value ? 'preferences.saveFailed' : 'preferences.loadFailed')} message={error} />}
    {!value && !error ? <LoadingState label={t('preferences.loading')} /> : value && <div className="oq-preferences">
      <Select label={t('preferences.history')} hint={t('preferences.historyHint')} value={String(value.historyLimit)}
        onChange={event => change({ historyLimit: Number(event.target.value) })} options={[...new Set([...HISTORY, value.historyLimit])].sort((a, b) => a - b).map(item => ({ value: String(item), label: formatNumber(item) }))} />
      <Select label={t('preferences.audit')} hint={t('preferences.auditHint')} value={String(value.auditRetentionDays)}
        onChange={event => change({ auditRetentionDays: Number(event.target.value) })} options={[...new Set([...AUDIT_DAYS, value.auditRetentionDays])].sort((a, b) => a - b).map(item => ({ value: String(item), label: t('preferences.days', { count: item }) }))} />
      <fieldset className="oq-preferences-ceiling">
        <legend>{t('preferences.ceiling')}</legend>
        {ENVIRONMENTS.map(environment => <Select key={environment} label={t(`environment.${environment}`)} value={value.agentCeiling[environment]}
          onChange={event => change({ agentCeiling: { ...value.agentCeiling, [environment]: event.target.value as AgentAccess } })}
          options={[{ value: 'off', label: t('preferences.access.off') }, { value: 'read', label: t('preferences.access.read') }, { value: 'write', label: t('preferences.access.write'), disabled: environment === 'prod' }]} />)}
        <small>{t('preferences.ceilingHint')}</small>
      </fieldset>
      {saved && <p role="status">{t('preferences.saved')}</p>}
    </div>}
  </Dialog>
}
