import type { ReactElement } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { Appearance } from '../../design/mode'
import { useSettingsStore } from '../../store/settings.store'
import styles from './AppearanceSettings.module.css'

const OPTIONS: Array<{ id: Appearance; label: string; hint: string; icon: typeof Sun }> = [
  { id: 'system', label: 'System', hint: 'Follows your operating system', icon: Monitor },
  { id: 'light', label: 'Light', hint: 'Caatinga green on clay', icon: Sun },
  { id: 'dark', label: 'Dark', hint: 'Sertão sun on the night', icon: Moon }
]

function Preview({ mode }: { mode: Appearance }): ReactElement {
  const half = (tone: 'light' | 'dark') => <div className={`${styles.half} ${styles[tone]}`}><div className={styles.side} /><div className={styles.body}><span className={styles.line} /><span className={styles.line} /></div></div>
  if (mode === 'system') return <div className={styles.preview} data-preview="system" aria-hidden="true">{half('light')}{half('dark')}</div>
  return <div className={`${styles.preview} ${styles[mode]}`} aria-hidden="true"><div className={styles.side} /><div className={styles.body}><span className={styles.line} /><span className={styles.line} /></div></div>
}

/** Light, dark or system mode for the whole app. */
export function AppearanceSettings(): ReactElement {
  const appearance = useSettingsStore(state => state.appearance)
  const setAppearance = useSettingsStore(state => state.setAppearance)
  return <div className={styles.options} role="radiogroup" aria-label="Appearance">
    {OPTIONS.map(({ id, label, hint, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={appearance === id} className={styles.option} onClick={() => setAppearance(id)}>
      <Preview mode={id} />
      <span className={styles.label}><Icon size={14} aria-hidden="true" />{label}{appearance === id && <Check size={13} aria-hidden="true" />}</span>
      <span className={styles.hint}>{hint}</span>
    </button>)}
  </div>
}
