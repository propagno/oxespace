import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check, Maximize2, Minimize2, Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, isLanguagePreference, resolveLanguage } from '../../../shared/i18n'
import type { UiDensity } from '../../../shared/types/workspace'
import { UI_SCALE_STEPS, UI_SCALE_DEFAULT } from '../../../shared/uiScale'
import type { Appearance } from '../../design/mode'
import { systemLocale } from '../../i18n'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useSettingsStore } from '../../store/settings.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, SegmentedControl, Select } from '../../ui'
import styles from './AppearanceSettings.module.css'

const MODES: Array<{ id: Appearance; icon: typeof Sun }> = [
  { id: 'system', icon: Monitor },
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon }
]

const percent = (factor: number): string => `${Math.round(factor * 100)}%`
const SCALE_OPTIONS = UI_SCALE_STEPS.map(step => ({ value: String(step), label: percent(step) }))
const DENSITY_ICONS: Record<UiDensity, ReactElement> = {
  compact: <Minimize2 size={14} aria-hidden="true" />,
  comfortable: <Maximize2 size={14} aria-hidden="true" />
}

function Preview({ mode }: { mode: Appearance }): ReactElement {
  const half = (tone: 'light' | 'dark') => <div className={styles.half} data-mode={tone}><div className={styles.side} /><div className={styles.body}><span className={styles.line} /><span className={styles.line} /></div></div>
  return <div className={styles.preview} data-preview={mode} aria-hidden="true">{mode === 'system' ? <>{half('light')}{half('dark')}</> : half(mode)}</div>
}

/** Light, dark or system mode for the whole app; named by `labelledBy`, or "Appearance". */
function ModeOptions({ labelledBy }: { labelledBy?: string }): ReactElement {
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

/** Interface scale and app-wide density; shown only in the app's Settings, not per workspace. */
function ScaleAndDensity(): ReactElement {
  const { t } = useTranslation('settings')
  const uiScale = useSettingsStore(state => state.uiScale)
  const setUiScale = useSettingsStore(state => state.setUiScale)
  const density = useSettingsStore(state => state.density)
  const setDensity = useSettingsStore(state => state.setDensity)
  const threadDensity = useNavigationPrefs(state => state.threadDensity)
  const setThreadDensity = useNavigationPrefs(state => state.setThreadDensity)
  // Workspaces saved before density became app-wide keep the density they had, so they stay overrides until the person says otherwise.
  const ownDensity = useWorkspaceStore(useShallow(state => state.workspaces.filter(workspace => workspace.uiDensity !== 'default').map(workspace => workspace.id)))
  const updateWorkspace = useWorkspaceStore(state => state.updateSettings)
  const scale = UI_SCALE_STEPS.find(step => step === uiScale) ?? UI_SCALE_DEFAULT
  const densityOptions = (['compact', 'comfortable'] as const).map(value => ({ value, label: t(`appearance.density.${value}`), icon: DENSITY_ICONS[value] }))
  return <>
    <section className={styles.group} aria-labelledby="appearance-scale-title">
      <h3 id="appearance-scale-title" className={styles.groupTitle}>{t('appearance.scale.title')}</h3>
      <p className={styles.hint}>{t('appearance.scale.hint', { scale: percent(uiScale) })}</p>
      <SegmentedControl label={t('appearance.scale.title')} value={String(scale)} options={SCALE_OPTIONS} onChange={value => setUiScale(Number(value))} />
    </section>
    <section className={styles.group} aria-labelledby="appearance-density-title">
      <h3 id="appearance-density-title" className={styles.groupTitle}>{t('appearance.density.title')}</h3>
      <p className={styles.hint}>{t('appearance.density.hint')}</p>
      <SegmentedControl label={t('appearance.density.title')} value={density} options={densityOptions} onChange={setDensity} />
      {ownDensity.length > 0 && <p className={styles.override} data-testid="workspace-density-override">
        <span>{t('appearance.density.workspaceOverride', { count: ownDensity.length })}</span>
        <Button variant="ghost" size="sm" onClick={() => { for (const workspaceId of ownDensity) void updateWorkspace({ workspaceId, uiDensity: 'default' }).catch(() => {}) }}>{t('appearance.density.useAppInWorkspaces')}</Button>
      </p>}
      {threadDensity !== null && <p className={styles.override} data-testid="thread-density-override">
        <span>{t('appearance.density.threadOverride', { density: t(`appearance.density.${threadDensity}`) })}</span>
        <Button variant="ghost" size="sm" onClick={() => setThreadDensity(null)}>{t('appearance.density.useAppInThread')}</Button>
      </p>}
    </section>
  </>
}

/** The interface language; each language is named in itself, so a person who cannot read the current one still finds theirs. */
function LanguagePicker(): ReactElement {
  const { t } = useTranslation(['settings', 'common'])
  const language = useSettingsStore(state => state.language)
  const setLanguage = useSettingsStore(state => state.setLanguage)
  const languages = [
    { value: 'system', label: t('appearance.language.system', { language: t(`common:languageName.${resolveLanguage(systemLocale())}`) }) },
    ...LANGUAGES.map(id => ({ value: id, label: t(`common:languageName.${id}`) }))
  ]
  return <section className={styles.group}>
    <Select label={t('appearance.language.title')} hint={t('appearance.language.hint')} options={languages} value={language} data-testid="settings-language"
      onChange={event => { if (isLanguagePreference(event.target.value)) setLanguage(event.target.value) }} />
  </section>
}

/**
 * Light, dark or system mode for the whole app. With `global`, also the
 * interface scale, the app-wide density and the language (Settings › Appearance);
 * workspace settings show the mode only.
 */
export function AppearanceSettings({ global = false }: { global?: boolean }): ReactElement {
  const { t } = useTranslation('settings')
  if (!global) return <ModeOptions />
  return <div className={styles.stack}>
    <section className={styles.group} aria-labelledby="appearance-mode-title">
      <h3 id="appearance-mode-title" className={styles.groupTitle}>{t('appearance.mode.title')}</h3>
      <ModeOptions labelledBy="appearance-mode-title" />
    </section>
    <ScaleAndDensity />
    <LanguagePicker />
  </div>
}
