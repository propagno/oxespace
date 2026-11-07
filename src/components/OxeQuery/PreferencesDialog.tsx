import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAccess, ConnectionEnvironment, EnvironmentLimit, OxeQueryPreferences } from '../../../shared/types/oxequery'
import { Dialog, ErrorState, Select, LoadingState, toast } from '../../ui'
import { i18n } from '../../i18n'
import { errorMessage, oq } from './client'
import { formatNumber } from '../../utils/formatTime'

const HISTORY = [50, 100, 200, 500, 1000, 2000]
const AUDIT_DAYS = [30, 90, 180, 365]
const ENVIRONMENTS: ConnectionEnvironment[] = ['local', 'dev', 'prod']
const ROW_CEILINGS = [100, 500, 1000, 5000, 10_000, 50_000, 100_000]
const TIMEOUT_CEILINGS_MS = [5000, 10_000, 30_000, 60_000, 300_000, 900_000, 3_600_000]
/** `none` is the select's way of saying "leave the connection's own value". */
const asValue = (value: number | null): string => value === null ? 'none' : String(value)
const fromValue = (value: string): number | null => value === 'none' ? null : Number(value)
const ACCESS: AgentAccess[] = ['off', 'read', 'write']
/** Keeps less than before, or lets agents be given more on some kind of environment. */
function riskier(before: OxeQueryPreferences, after: OxeQueryPreferences): boolean {
  if (after.historyLimit < before.historyLimit || after.auditRetentionDays < before.auditRetentionDays) return true
  return (Object.keys(after.agentCeiling) as Array<keyof OxeQueryPreferences['agentCeiling']>)
    .some(environment => ACCESS.indexOf(after.agentCeiling[environment]) > ACCESS.indexOf(before.agentCeiling[environment]))
}

/** OxeQuery's own settings: how long things are kept, and how much an agent may be given by kind of environment. */
export function PreferencesDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [value, setValue] = useState<OxeQueryPreferences | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // What is saved now: Undo puts it back.
  const stored = useRef<OxeQueryPreferences | null>(null)

  useEffect(() => {
    let alive = true
    oq('preferences.get', {}).then(result => { if (alive) { stored.current = result; setValue(result) } }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [])

  const save = async (): Promise<void> => {
    if (!value) return
    setBusy(true); setError(''); setSaved(false)
    const before = stored.current
    try {
      const next = await oq('preferences.set', value)
      stored.current = next; setValue(next); setSaved(true)
      // U2: keeping less (history, the audit) can lose data, and a higher ceiling widens what agents may be given:
      // either says so, with Undo to what was saved.
      if (before && riskier(before, next)) toast({ title: t('preferences.riskySaved'), intent: 'info', action: { label: i18n.t('ui.undo'), run: () => {
        void oq('preferences.set', before).then(result => { stored.current = result; setValue(result) }, () => undefined)
      } } })
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  const change = (patch: Partial<OxeQueryPreferences>): void => { setSaved(false); setValue(current => current ? { ...current, ...patch } : current) }

  return <Dialog toasts title={t('preferences.title')} description={t('preferences.description')} size="md" onClose={onClose} closeLabel={t('common.close')} testId="oxequery-preferences"
    actions={{ cancel: { label: t('common.cancel') }, primary: { label: t('common.save'), loading: busy, disabled: !value, onClick: () => void save() } }}>
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
      <fieldset className="oq-preferences-ceiling">
        <legend>{t('preferences.limits')}</legend>
        {ENVIRONMENTS.map(environment => {
          const limit = value.environmentLimits[environment]
          const set = (patch: Partial<EnvironmentLimit>): void => change({ environmentLimits: { ...value.environmentLimits, [environment]: { ...limit, ...patch } } })
          const timeouts = [...new Set([...TIMEOUT_CEILINGS_MS, ...(limit.statementTimeoutMs === null ? [] : [limit.statementTimeoutMs])])].sort((a, b) => a - b)
          const rows = [...new Set([...ROW_CEILINGS, ...(limit.maxRows === null ? [] : [limit.maxRows])])].sort((a, b) => a - b)
          return <fieldset key={environment} className="oq-preferences-limits">
            <legend>{t(`environment.${environment}`)}</legend>
            <Select label={t('preferences.rows')} value={asValue(limit.maxRows)} onChange={event => set({ maxRows: fromValue(event.target.value) })}
              options={[{ value: 'none', label: t('preferences.noLimit') }, ...rows.map(item => ({ value: String(item), label: t('common.rows', { count: item, formatted: formatNumber(item) }) }))]} />
            <Select label={t('preferences.statementTime')} value={asValue(limit.statementTimeoutMs)} onChange={event => set({ statementTimeoutMs: fromValue(event.target.value) })}
              options={[{ value: 'none', label: t('preferences.noLimit') }, ...timeouts.map(item => ({ value: String(item), label: item >= 60_000 && item % 60_000 === 0 ? t('preferences.minutes', { minutes: formatNumber(item / 60_000) }) : t('preferences.seconds', { seconds: formatNumber(item / 1000) }) }))]} />
          </fieldset>
        })}
        <small>{t('preferences.limitsHint')}</small>
      </fieldset>
      {saved && <p role="status">{t('preferences.saved')}</p>}
    </div>}
  </Dialog>
}
