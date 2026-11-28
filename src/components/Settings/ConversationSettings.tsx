import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Notice, Select, SegmentedControl, SettingRow, SettingsSection, Switch, TextField } from '../../ui'
import { THREAD_IDLE_SUSPEND_CHOICES } from '../../../shared/threadLimits'
import { humanizeError } from '../../utils/humanizeError'
import {
  ACTIVE_TURN_SEND_ACTIONS,
  PASTE_AS_ATTACHMENT_PRESETS,
  THINKING_STYLES,
  useThreadPrefs,
  type ActiveTurnSendAction,
  type ThinkingStyle
} from '../../store/thread-prefs.store'
import { altSendKeyLabel, SEND_KEY_MODES, sendKeyLabel, type SendKeyMode } from '../Threads/sendKey'

type FoldChoice = 'fold' | 'expand'
type PastePreset = '10000' | '25000' | '0'

function pastePresetOf(threshold: number): PastePreset {
  if (threshold <= 0) return '0'
  if (threshold >= 20_000) return '25000'
  return '10000'
}

/** The conversation settings at the end of Settings › Agents: idle conversations, OxeChat preferences, utility model and the send key (OXE-131, OXE-479, OXE-487). */
export function ConversationSettings(): ReactElement {
  return <>
    <IdleConversationsSetting />
    <OxeChatPreferencesSetting />
    <UtilityModelSetting />
    <SendKeySetting />
  </>
}

/** Lean, high-value OxeChat conversation preferences (OXE-479): thinking style, folding, failures, active turn action, and paste threshold. */
function OxeChatPreferencesSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const thinkingStyle = useThreadPrefs(state => state.thinkingStyle)
  const setThinkingStyle = useThreadPrefs(state => state.setThinkingStyle)
  const foldCompletedTurns = useThreadPrefs(state => state.foldCompletedTurns)
  const setFoldCompletedTurns = useThreadPrefs(state => state.setFoldCompletedTurns)
  const autoExpandFailures = useThreadPrefs(state => state.autoExpandFailures)
  const setAutoExpandFailures = useThreadPrefs(state => state.setAutoExpandFailures)
  const activeTurnSendAction = useThreadPrefs(state => state.activeTurnSendAction)
  const setActiveTurnSendAction = useThreadPrefs(state => state.setActiveTurnSendAction)
  const pasteAsAttachmentThreshold = useThreadPrefs(state => state.pasteAsAttachmentThreshold)
  const setPasteAsAttachmentThreshold = useThreadPrefs(state => state.setPasteAsAttachmentThreshold)

  return <SettingsSection title={t('conversation.title')} description={t('conversation.description')}>
    <SettingRow
      label={t('conversation.thinkingStyle.label')}
      description={t('conversation.thinkingStyle.hint')}
      control={
        <SegmentedControl<ThinkingStyle>
          label={t('conversation.thinkingStyle.label')}
          value={thinkingStyle}
          onChange={setThinkingStyle}
          options={THINKING_STYLES.map(style => ({ value: style, label: t(`conversation.thinkingStyle.options.${style}`) }))}
        />
      }
    />
    <SettingRow
      label={t('conversation.foldCompleted.label')}
      description={t('conversation.foldCompleted.hint')}
      control={
        <SegmentedControl<FoldChoice>
          label={t('conversation.foldCompleted.label')}
          value={foldCompletedTurns ? 'fold' : 'expand'}
          onChange={choice => setFoldCompletedTurns(choice === 'fold')}
          options={[
            { value: 'fold', label: t('conversation.foldCompleted.fold') },
            { value: 'expand', label: t('conversation.foldCompleted.expand') }
          ]}
        />
      }
    />
    <SettingRow
      label={t('conversation.autoExpandFailures.label')}
      description={t('conversation.autoExpandFailures.hint')}
      control={
        <Switch
          checked={autoExpandFailures}
          onChange={setAutoExpandFailures}
          ariaLabel={t('conversation.autoExpandFailures.label')}
        />
      }
    />
    <SettingRow
      label={t('conversation.activeTurnAction.label')}
      description={t('conversation.activeTurnAction.hint', { key: sendKeyLabel(sendKey), altKey: altSendKeyLabel() })}
      control={
        <SegmentedControl<ActiveTurnSendAction>
          label={t('conversation.activeTurnAction.label')}
          value={activeTurnSendAction}
          onChange={setActiveTurnSendAction}
          options={ACTIVE_TURN_SEND_ACTIONS.map(action => ({ value: action, label: t(`conversation.activeTurnAction.options.${action}`) }))}
        />
      }
    />
    <SettingRow
      label={t('conversation.pasteThreshold.label')}
      description={t('conversation.pasteThreshold.hint')}
      control={
        <SegmentedControl<PastePreset>
          label={t('conversation.pasteThreshold.label')}
          value={pastePresetOf(pasteAsAttachmentThreshold)}
          onChange={choice => setPasteAsAttachmentThreshold(Number(choice))}
          options={PASTE_AS_ATTACHMENT_PRESETS.map(preset => ({
            value: String(preset) as PastePreset,
            label: preset === 0
              ? t('conversation.pasteThreshold.off')
              : preset === 25_000
                ? t('conversation.pasteThreshold.twentyFiveK')
                : t('conversation.pasteThreshold.tenK')
          }))}
        />
      }
    />
  </SettingsSection>
}

/** Optional fast/lightweight model for auxiliary tasks (side chats, quick helpers); empty = Auto with graceful fallback. */
function UtilityModelSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const utilityModel = useThreadPrefs(state => state.utilityModel)
  const setUtilityModel = useThreadPrefs(state => state.setUtilityModel)
  const [editing, setEditing] = useState<string | null>(null)
  const commit = (): void => {
    if (editing === null) return
    setUtilityModel(editing)
    setEditing(null)
  }
  return <SettingsSection title={t('utilityModel.title')}>
    <SettingRow label={t('utilityModel.label')} description={t('utilityModel.hint')}
      control={<TextField aria-label={t('utilityModel.label')} placeholder={t('utilityModel.placeholder')} value={editing ?? utilityModel}
        onChange={event => setEditing(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') commit() }} />} />
  </SettingsSection>
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
