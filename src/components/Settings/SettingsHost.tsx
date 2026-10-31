import { X } from 'lucide-react'
import { Suspense, type ComponentProps, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { LoadingState } from '../../ui'
import type { SettingsCenter as SettingsCenterView } from './SettingsCenter'
import { chunk, lazyFrom } from '../../lib/chunk'
// In the boot stylesheet, so the shell below already has the full-screen layout the real Settings fills in.
import './SettingsCenter.css'

/** Preloaded at idle (src/lib/idlePreload.ts); once it has arrived, Settings opens without the shell. */
export const SETTINGS_CHUNK = chunk(() => import('./SettingsCenter'))
const LazySettingsCenter = lazyFrom(SETTINGS_CHUNK, module => module.SettingsCenter)

/**
 * Settings as the click opens it, before its chunk has loaded: the same full-screen frame (its navigation column at
 * the default width), title and close button, with a loading state where the page goes. The real Settings replaces
 * it in place.
 */
export function SettingsShell({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('settings')
  return <ModalRoot open onOpenChange={open => { if (!open) onClose() }}>
    <ModalSurface className="settings-center" scrimClassName="settings-center-overlay" aria-describedby={undefined} aria-busy="true">
      <aside className="settings-center-nav"><ModalTitle className="settings-center-title">{t('center.title')}</ModalTitle></aside>
      <main className="settings-center-main">
        <header className="settings-center-toolbar">
          <span />
          <button type="button" aria-label={t('center.close')} title={t('center.closeTitle')} onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="settings-center-content"><LoadingState /></div>
      </main>
    </ModalSurface>
  </ModalRoot>
}

/** Settings, lazily: the first click shows the shell at once, and the chunk (usually preloaded at idle) fills it. */
export function SettingsCenter(props: ComponentProps<typeof SettingsCenterView>): ReactElement {
  return <Suspense fallback={<SettingsShell onClose={props.onClose} />}><LazySettingsCenter {...props} /></Suspense>
}
