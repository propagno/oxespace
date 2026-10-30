import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RichText } from '../../i18n/RichText'
import { Button } from '../../ui'
import { eventToChord } from '../../keyboard/chords'
import {
  KEYBINDINGS, chordsFor, conflictsFor, isOverridden, type Keybinding, type KeybindingId, type KeybindingScope
} from '../../keyboard/keybindings'
import { bindingLabel, scopeLabel } from '../../keyboard/labels'
import { useSettingsStore } from '../../store/settings.store'
import { KeyChords } from '../Keyboard/KeyChord'
import styles from '../Keyboard/Keyboard.module.css'

const SCOPES: KeybindingScope[] = ['global', 'code', 'terminal', 'thread', 'oxequery', 'oxepod', 'oxepost']

/** Settings › Keyboard: every shortcut, changeable one by one, with a warning when two share a key. */
export function KeyboardSettings(): ReactElement {
  const overrides = useSettingsStore(state => state.keybindingOverrides)
  const setOverride = useSettingsStore(state => state.setKeybindingOverride)
  const resetAll = useSettingsStore(state => state.resetKeybindings)
  const [capturing, setCapturing] = useState<KeybindingId | null>(null)
  const { t } = useTranslation('settings')

  useEffect(() => {
    if (!capturing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      // Capture phase plus stopPropagation keeps Escape from also closing Settings
      // and the chord from reaching the app's own shortcuts (as the voice hotkey capture does).
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { setCapturing(null); return }
      const chord = eventToChord(event)
      if (!chord) return
      setOverride(capturing, [chord])
      setCapturing(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing, setOverride])

  const groups = SCOPES.map(scope => ({ scope, bindings: (KEYBINDINGS as readonly Keybinding[]).filter(binding => binding.scope === scope) }))
    .filter(group => group.bindings.length > 0)
  const customized = Object.keys(overrides).length

  return <section className="settings-general" data-testid="keyboard-settings"><h2>{t('keyboard.title')}</h2>
    <p><RichText text={t('keyboard.intro')} /></p>
    {groups.map(group => <div key={group.scope}>
      <h3>{scopeLabel(group.scope)}</h3>
      <div className="settings-general-card">
        <ul className={`${styles.list} ${styles.settingsList}`} aria-label={t('keyboard.shortcuts', { scope: scopeLabel(group.scope) })}>
          {group.bindings.map(binding => {
            const id = binding.id as KeybindingId
            const conflicts = conflictsFor(id)
            const active = capturing === id
            const name = bindingLabel(binding)
            return <li key={id} className={`${styles.row} ${styles.settingsRow}`} data-keybinding={id}>
              <span className={styles.settingsLabel}>
                <span>{name}</span>
                {conflicts.length > 0 && <span className={styles.warning} role="status">
                  {t('keyboard.alsoUsed', { bindings: conflicts.map(other => `${bindingLabel(other)} (${scopeLabel(other.scope)})`).join(', ') })}
                </span>}
                {active && <span className={styles.capturing} role="status">{t('keyboard.capturing')}</span>}
              </span>
              <span className={styles.actions}>
                <KeyChords chords={chordsFor(id)} />
                <Button size="sm" variant="ghost" aria-pressed={active} aria-label={t('keyboard.changeLabel', { name })}
                  onClick={() => setCapturing(active ? null : id)}>{active ? t('keyboard.pressKeys') : t('keyboard.change')}</Button>
                <Button size="sm" variant="ghost" disabled={!isOverridden(id)} aria-label={t('keyboard.resetLabel', { name })} onClick={() => setOverride(id, null)}>{t('keyboard.reset')}</Button>
                <Button size="sm" variant="ghost" disabled={chordsFor(id).length === 0} aria-label={t('keyboard.offLabel', { name })} onClick={() => setOverride(id, [])}>{t('keyboard.off')}</Button>
              </span>
            </li>
          })}
        </ul>
      </div>
    </div>)}
    <div className="settings-inline-actions">
      <Button variant="ghost" disabled={!customized} onClick={resetAll}>{t('keyboard.resetAll')}</Button>
    </div>
  </section>
}
