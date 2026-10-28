import type { ReactElement } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, isLanguagePreference, resolveLanguage } from '../../../shared/i18n'
import type { Appearance } from '../../design/mode'
import { systemLocale } from '../../i18n'
import { useSettingsStore } from '../../store/settings.store'
import { Select } from '../../ui'
import styles from './AppearanceSettings.module.css'

const MODES: Array<{ id: Appearance; icon: typeof Sun }> = [
  { id: 'system', icon: Monitor },
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon }
]

function Preview({ mode }: { mode: Appearance }): ReactElement {
  const half = (tone: 'light' | 'dark') => <div className={styles.half} data-mode={tone}><div className={styles.side} /><div className={styles.body}><span className={styles.line} /><span className={styles.line} /></div></div>
  return <div className={styles.preview} data-preview={mode} aria-hidden="true">{mode === 'system' ? <>{half('light')}{half('dark')}</> : half(mode)}</div>
}

/** Light, dark or system mode for the whole app; named by `labelledBy`, or "Appearance". */
export function AppearanceModes({ labelledBy }: { labelledBy?: string }): ReactElement {
  const { t } = useTranslation('settings')
  const appearance = useSettingsStore(state => state.appearance)
  const setAppearance = useSettingsStore(state => state.setAppearance)
  return <div className={styles.options} role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : t('appearance.title')}>
    {MODES.map(({ id, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={appearance === id} className={styles.option} onClick={() => setAppearance(id)}>
      <Preview mode={id} />
      <span className={styles.label}><Icon size={14} aria-hidden="true" />{t(`appearance.mode.${id}.label`)}{appearance === id && <Check size={14} aria-hidden="true" />}</span>
      <span className={styles.hint}>{t(`appearance.mode.${id}.hint`)}</span>
    </button>)}
  </div>
}

/** Settings › Appearance: the mode and the interface language. */
export function AppearanceSettings(): ReactElement {
  const { t } = useTranslation(['settings', 'common'])
  const language = useSettingsStore(state => state.language)
  const setLanguage = useSettingsStore(state => state.setLanguage)
  // Each language is named in itself, so a person who cannot read the current one still finds theirs.
  const languages = [
    { value: 'system', label: t('appearance.language.system', { language: t(`common:languageName.${resolveLanguage(systemLocale())}`) }) },
    ...LANGUAGES.map(id => ({ value: id, label: t(`common:languageName.${id}`) }))
  ]
  return <>
    <div className="settings-form-group">
      <h3 className="settings-form-group-title" id="settings-appearance-mode">{t('appearance.mode.title')}</h3>
      <AppearanceModes labelledBy="settings-appearance-mode" />
    </div>
    <div className="settings-form-group">
      <Select label={t('appearance.language.title')} hint={t('appearance.language.hint')} options={languages} value={language} data-testid="settings-language"
        onChange={event => { if (isLanguagePreference(event.target.value)) setLanguage(event.target.value) }} />
    </div>
  </>
}
