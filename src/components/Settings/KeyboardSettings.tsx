import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '../../ui'
import { eventToChord } from '../../keyboard/chords'
import {
  KEYBINDINGS, SCOPE_LABELS, chordsFor, conflictsFor, isOverridden, type Keybinding, type KeybindingId, type KeybindingScope
} from '../../keyboard/keybindings'
import { useSettingsStore } from '../../store/settings.store'
import { KeyChords } from '../Keyboard/KeyChord'
import styles from '../Keyboard/Keyboard.module.css'

const SCOPES: KeybindingScope[] = ['global', 'code', 'terminal', 'thread', 'oxequery']

/** Settings › Keyboard: every shortcut, changeable one by one, with a warning when two share a key. */
export function KeyboardSettings(): ReactElement {
  const overrides = useSettingsStore(state => state.keybindingOverrides)
  const setOverride = useSettingsStore(state => state.setKeybindingOverride)
  const resetAll = useSettingsStore(state => state.resetKeybindings)
  const [capturing, setCapturing] = useState<KeybindingId | null>(null)

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

  return <section className="settings-general" data-testid="keyboard-settings"><h2>Keyboard</h2>
    <p>Shortcuts work in the view named by each group. Press <strong>?</strong> outside a text field to see the ones for the current screen.
      A focused terminal keeps every key except the command palette, Settings and the sidebar shortcuts.</p>
    {groups.map(group => <div key={group.scope}>
      <h3>{SCOPE_LABELS[group.scope]}</h3>
      <div className="settings-general-card">
        <ul className={`${styles.list} ${styles.settingsList}`} aria-label={`${SCOPE_LABELS[group.scope]} shortcuts`}>
          {group.bindings.map(binding => {
            const id = binding.id as KeybindingId
            const conflicts = conflictsFor(id)
            const active = capturing === id
            return <li key={id} className={`${styles.row} ${styles.settingsRow}`} data-keybinding={id}>
              <span className={styles.settingsLabel}>
                <span>{binding.label}</span>
                {conflicts.length > 0 && <span className={styles.warning} role="status">
                  Also used by {conflicts.map(other => `${other.label} (${SCOPE_LABELS[other.scope]})`).join(', ')}
                </span>}
                {active && <span className={styles.capturing} role="status">Press the new shortcut, or Esc to cancel</span>}
              </span>
              <span className={styles.actions}>
                <KeyChords chords={chordsFor(id)} />
                <Button size="sm" variant="ghost" aria-pressed={active} aria-label={`Change shortcut for ${binding.label}`}
                  onClick={() => setCapturing(active ? null : id)}>{active ? 'Press keys…' : 'Change'}</Button>
                <Button size="sm" variant="ghost" disabled={!isOverridden(id)} aria-label={`Reset shortcut for ${binding.label}`} onClick={() => setOverride(id, null)}>Reset</Button>
                <Button size="sm" variant="ghost" disabled={chordsFor(id).length === 0} aria-label={`Turn off shortcut for ${binding.label}`} onClick={() => setOverride(id, [])}>Turn off</Button>
              </span>
            </li>
          })}
        </ul>
      </div>
    </div>)}
    <div className="settings-inline-actions">
      <Button variant="ghost" disabled={!customized} onClick={resetAll}>Reset all shortcuts</Button>
    </div>
  </section>
}
