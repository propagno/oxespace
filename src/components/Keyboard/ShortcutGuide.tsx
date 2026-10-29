import type { ReactElement } from 'react'
import { Button, Dialog } from '../../ui'
import { SCOPE_LABELS, bindingsForView, chordsFor, type AppView, type KeybindingId } from '../../keyboard/keybindings'
import { useSettingsStore } from '../../store/settings.store'
import { useUIStore } from '../../store/ui.store'
import { KeyChords } from './KeyChord'
import styles from './Keyboard.module.css'

const VIEW_NAMES: Record<AppView, string> = { code: 'Code', thread: 'Thread', data: 'OxeQuery', pods: 'OxePod' }

/** The shortcuts that work on the current screen, read from the keybinding registry. */
export function ShortcutGuide({ view, onClose }: { view: AppView; onClose: () => void }): ReactElement {
  // Re-render when the user changes a shortcut in Settings.
  useSettingsStore(state => state.keybindingOverrides)
  const customize = (): void => { onClose(); useUIStore.getState().openSettingsPage('keyboard') }
  return <Dialog title="Keyboard shortcuts" description={`What works in ${VIEW_NAMES[view]} right now.`} onClose={onClose} testId="shortcut-guide"
    footer={<Button onClick={customize}>Customize shortcuts</Button>}>
    <div className={styles.guide}>
      {bindingsForView(view).map(group => <section key={group.scope} className={styles.group} aria-labelledby={`shortcut-group-${group.scope}`}>
        <h3 id={`shortcut-group-${group.scope}`} className={styles.groupTitle}>{SCOPE_LABELS[group.scope]}</h3>
        <ul className={styles.list}>
          {group.bindings.map(binding => <li key={binding.id} className={styles.row}>
            <span>{binding.label}</span><KeyChords chords={chordsFor(binding.id as KeybindingId)} />
          </li>)}
        </ul>
      </section>)}
    </div>
  </Dialog>
}
