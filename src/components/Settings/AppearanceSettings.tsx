import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Check, Maximize2, Minimize2, Monitor, Moon, Sun } from 'lucide-react'
import type { UiDensity } from '../../../shared/types/workspace'
import { UI_SCALE_STEPS, UI_SCALE_DEFAULT } from '../../../shared/uiScale'
import type { Appearance } from '../../design/mode'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useSettingsStore } from '../../store/settings.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, SegmentedControl } from '../../ui'
import styles from './AppearanceSettings.module.css'

const OPTIONS: Array<{ id: Appearance; label: string; hint: string; icon: typeof Sun }> = [
  { id: 'system', label: 'System', hint: 'Follows your operating system', icon: Monitor },
  { id: 'light', label: 'Light', hint: 'Light surfaces with green accents', icon: Sun },
  { id: 'dark', label: 'Dark', hint: 'Dark surfaces with warm yellow accents', icon: Moon }
]

const percent = (factor: number): string => `${Math.round(factor * 100)}%`
const SCALE_OPTIONS = UI_SCALE_STEPS.map(step => ({ value: String(step), label: percent(step) }))
const DENSITY_OPTIONS: Array<{ value: UiDensity; label: string; icon: ReactElement }> = [
  { value: 'compact', label: 'Compact', icon: <Minimize2 size={14} aria-hidden="true" /> },
  { value: 'comfortable', label: 'Comfortable', icon: <Maximize2 size={14} aria-hidden="true" /> }
]

function Preview({ mode }: { mode: Appearance }): ReactElement {
  const half = (tone: 'light' | 'dark') => <div className={styles.half} data-mode={tone}><div className={styles.side} /><div className={styles.body}><span className={styles.line} /><span className={styles.line} /></div></div>
  return <div className={styles.preview} data-preview={mode} aria-hidden="true">{mode === 'system' ? <>{half('light')}{half('dark')}</> : half(mode)}</div>
}

function ModeOptions(): ReactElement {
  const appearance = useSettingsStore(state => state.appearance)
  const setAppearance = useSettingsStore(state => state.setAppearance)
  return <div className={styles.options} role="radiogroup" aria-label="Appearance">
    {OPTIONS.map(({ id, label, hint, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={appearance === id} className={styles.option} onClick={() => setAppearance(id)}>
      <Preview mode={id} />
      <span className={styles.label}><Icon size={14} aria-hidden="true" />{label}{appearance === id && <Check size={14} aria-hidden="true" />}</span>
      <span className={styles.hint}>{hint}</span>
    </button>)}
  </div>
}

/** Interface scale and app-wide density; shown only in the app's Settings, not per workspace. */
function ScaleAndDensity(): ReactElement {
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
  return <>
    <section className={styles.group} aria-labelledby="appearance-scale-title">
      <h3 id="appearance-scale-title" className={styles.groupTitle}>Interface scale</h3>
      <p className={styles.hint}>Makes text, controls and the terminal larger or smaller across the app. Currently {percent(uiScale)}.</p>
      <SegmentedControl label="Interface scale" value={String(scale)} options={SCALE_OPTIONS} onChange={value => setUiScale(Number(value))} />
    </section>
    <section className={styles.group} aria-labelledby="appearance-density-title">
      <h3 id="appearance-density-title" className={styles.groupTitle}>Density</h3>
      <p className={styles.hint}>How tightly controls and lists sit. Workspaces and the Thread list follow this unless you set their own.</p>
      <SegmentedControl label="Density" value={density} options={DENSITY_OPTIONS} onChange={setDensity} />
      {ownDensity.length > 0 && <p className={styles.override} data-testid="workspace-density-override">
        <span>{ownDensity.length === 1 ? '1 workspace uses its own density.' : `${ownDensity.length} workspaces use their own density.`}</span>
        <Button variant="ghost" size="sm" onClick={() => { for (const workspaceId of ownDensity) void updateWorkspace({ workspaceId, uiDensity: 'default' }).catch(() => {}) }}>Use app density in all workspaces</Button>
      </p>}
      {threadDensity !== null && <p className={styles.override} data-testid="thread-density-override">
        <span>The Thread list uses its own density: {threadDensity === 'compact' ? 'Compact' : 'Comfortable'}.</span>
        <Button variant="ghost" size="sm" onClick={() => setThreadDensity(null)}>Use app density in the Thread list</Button>
      </p>}
    </section>
  </>
}

/**
 * Light, dark or system mode for the whole app. With `global`, also the
 * interface scale and the app-wide density (Settings › Appearance); workspace
 * settings show the mode only.
 */
export function AppearanceSettings({ global = false }: { global?: boolean }): ReactElement {
  if (!global) return <ModeOptions />
  return <div className={styles.stack}>
    <section className={styles.group} aria-labelledby="appearance-mode-title">
      <h3 id="appearance-mode-title" className={styles.groupTitle}>Mode</h3>
      <ModeOptions />
    </section>
    <ScaleAndDensity />
  </div>
}
