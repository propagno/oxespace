import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Notice, Select, SegmentedControl, SettingRow, SettingsSection } from '../../ui'
import { THREAD_IDLE_SUSPEND_CHOICES } from '../../../shared/threadLimits'
import { humanizeError } from '../../utils/humanizeError'
import { useThreadPrefs } from '../../store/thread-prefs.store'
import { SEND_KEY_MODES, sendKeyLabel, type SendKeyMode } from '../Threads/sendKey'

/** The conversation settings at the end of Settings › Agents: idle conversations and the send key (OXE-131). */
export function ConversationSettings(): ReactElement {
  return <>
    <IdleConversationsSetting />
    <SendKeySetting />
  </>
}

/** Which key sends a message from the composer and answers an agent question; applies at once, kept across restarts. */
function SendKeySetting(): ReactElement {
  const { t } = useTranslation('settings')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const setSendKey = useThreadPrefs(state => state.setSendKey)
  return <SettingsSection title={t('sendKey.title')}>
    <SettingRow label={t('sendKey.label')} description={t('sendKey.hint')}
      control={<SegmentedControl<SendKeyMode> label={t('sendKey.label')} value={sendKey} onChange={setSendKey} options={SEND_KEY_MODES.map(mode => ({ value: mode, label: sendKeyLabel(mode) }))} />} />
  </SettingsSection>
}

/** How long an idle Thread conversation keeps its agent process (and the MCP servers it started) running. */
function IdleConversationsSetting(): ReactElement | null {
  const { t } = useTranslation('settings')
  const api = window.oxe?.thread
  const [minutes, setMinutes] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(api?.idleSuspendMinutes?.())
      .then((value) => { if (!cancelled && typeof value === 'number') setMinutes(value) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  if (minutes === null || !api?.setIdleSuspendMinutes) return null

  const change = async (next: number): Promise<void> => {
    setError('')
    try { setMinutes(await api.setIdleSuspendMinutes!(next)) }
    catch (cause) { setError(humanizeError(cause, t('idle.saveFailed'))) }
  }

  return (
    <div className="settings-form-group">
      <h3 className="settings-form-group-title">{t('idle.title')}</h3>
      <label className="settings-field">
        <span>{t('idle.after')}</span>
        <Select aria-label={t('idle.afterLabel')} value={minutes} onChange={(event) => void change(Number(event.target.value))}>
          {THREAD_IDLE_SUSPEND_CHOICES.map((value) => (
            <option key={value} value={value}>{value === 0 ? t('idle.never') : t('idle.minutes', { count: value })}</option>
          ))}
        </Select>
        <span className="settings-field-hint">{t('idle.hint')}</span>
      </label>
      {error && <Notice intent="danger">{error}</Notice>}
    </div>
  )
}
