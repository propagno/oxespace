import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog } from '../../ui'
import { bindingLabel, scopeLabel } from '../../keyboard/labels'
import { bindingsForView, chordsFor, shortcutLabel, type AppView, type KeybindingId } from '../../keyboard/keybindings'
import { useSettingsStore } from '../../store/settings.store'
import { useUIStore } from '../../store/ui.store'
import { KeyChords } from './KeyChord'
import styles from './Keyboard.module.css'

const VIEW_NAMES: Record<AppView, string> = { code: 'OxeCode', thread: 'OxeChat', data: 'OxeQuery', pods: 'OxePod', post: 'OxePost' }

/** The shortcuts that work on the current screen, read from the keybinding registry. */
export function ShortcutGuide({ view, onClose }: { view: AppView; onClose: () => void }): ReactElement {
  // Re-render when the user changes a shortcut in Settings.
  useSettingsStore(state => state.keybindingOverrides)
  const { t } = useTranslation()
  const customize = (): void => { onClose(); useUIStore.getState().openSettingsPage('keyboard') }
  // A pane can send F6 to its program (mc, htop, tig); the toggle is then its way out. Only while the toggle has a key.
  const toggle = shortcutLabel('terminal.tabMovesFocus')
  return <Dialog title={t('keys.guide.title')} description={t('keys.guide.description', { view: VIEW_NAMES[view] })} onClose={onClose} testId="shortcut-guide"
    footer={<Button onClick={customize}>{t('keys.guide.customize')}</Button>}>
    <div className={styles.guide}>
      {bindingsForView(view).map(group => <section key={group.scope} className={styles.group} aria-labelledby={`shortcut-group-${group.scope}`}>
        <h3 id={`shortcut-group-${group.scope}`} className={styles.groupTitle}>{scopeLabel(group.scope)}</h3>
        <ul className={styles.list}>
          {group.bindings.map(binding => <li key={binding.id} className={styles.row}>
            <span>{bindingLabel(binding)}</span><KeyChords chords={chordsFor(binding.id as KeybindingId)} />
          </li>)}
        </ul>
        {toggle && group.bindings.some(binding => binding.id === 'focus.nextRegion')
          ? <p className={styles.note} data-testid="shortcut-guide-f6-note">{t('keys.guide.f6ToProgram', { toggle })}</p> : null}
      </section>)}
    </div>
  </Dialog>
}
