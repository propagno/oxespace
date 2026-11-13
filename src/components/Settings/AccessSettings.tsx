import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { isThreadAccess, THREAD_ACCESS_LEVELS, type ThreadAccess } from '../../../shared/threadAccess'
import { applyWithUndo, Notice, Select, Switch } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

/**
 * Settings > Agents: the access a conversation the person creates starts with. Kept in main; each conversation can
 * still be changed from its own access chip, and the ones that exist keep theirs.
 */
export function NewConversationAccessSetting(): ReactElement | null {
  const { t } = useTranslation('settings')
  const api = window.oxe?.thread
  const [access, setAccess] = useState<ThreadAccess | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(api?.newConversationAccess?.())
      .then((value) => { if (!cancelled && isThreadAccess(value)) setAccess(value) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  if (access === null || !api?.setNewConversationAccess) return null

  const change = async (next: string): Promise<void> => {
    if (!isThreadAccess(next)) return
    setError('')
    try { setAccess(await api.setNewConversationAccess!(next)) }
    catch (cause) { setError(humanizeError(cause, t('newAccess.saveFailed'))) }
  }

  return (
    <div className="settings-form-group" data-testid="new-conversation-access">
      <h3 className="settings-form-group-title">{t('newAccess.title')}</h3>
      <label className="settings-field">
        <span>{t('newAccess.label')}</span>
        <Select aria-label={t('newAccess.label')} value={access} onChange={(event) => void change(event.target.value)}>
          {THREAD_ACCESS_LEVELS.map((value) => <option key={value} value={value}>{t(`newAccess.options.${value}`)}</option>)}
        </Select>
        <span className="settings-field-hint">{t(`newAccess.hint.${access}`)} {t('newAccess.perConversation')}</span>
      </label>
      {error && <Notice intent="danger">{error}</Notice>}
    </div>
  )
}

/**
 * Settings > Terminal: agents the person starts in a pane skip their permission prompts unless this is turned off.
 * Kept in main, where only the window changes it. Nothing is shown until the stored value is read.
 */
export function AgentsFullAccessSetting(): ReactElement | null {
  const { t } = useTranslation('settings')
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    void window.oxe?.terminal?.agentsFullAccess?.().then(value => { if (live) setEnabled(value) }, () => undefined)
    return () => { live = false }
  }, [])

  if (enabled === null) return null

  const change = (next: boolean): void => {
    const set = window.oxe?.terminal?.setAgentsFullAccess
    if (!set) return
    if (next) void applyWithUndo({ apply: () => set(true).then(setEnabled), undo: () => set(false).then(setEnabled), done: t('terminal.agentsFullAccessOn') })
    else void set(false).then(setEnabled, () => undefined)
  }

  return (
    <div className="settings-toggle-row" data-testid="terminal-agents-full-access">
      <span>
        <strong>{t('terminal.agentsFullAccess')}</strong>
        <small>{t('terminal.agentsFullAccessHint')}</small>
      </span>
      <Switch checked={enabled} onChange={change} ariaLabel={t('terminal.agentsFullAccess')} />
    </div>
  )
}
