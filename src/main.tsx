import React from 'react'
import ReactDOM from 'react-dom/client'
// Mandacaru Noite typography, bundled so it loads offline: Instrument Sans (one variable
// file, latin and latin-ext) for interface and display, IBM Plex Mono for code (docs/design/brand.md).
import '@fontsource-variable/instrument-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { App } from './App'
import { ShortcutGuideHost } from './components/Keyboard/ShortcutGuideHost'
import { TerminalFocusHost } from './components/Keyboard/TerminalFocusHost'
import { ReportProblemHost } from './components/Diagnostics/ReportProblemHost'
import { AboutHost } from './components/About/AboutHost'
import { WhatsNewHost } from './components/Updates/whatsNew'
import { ApprovalsHost } from './components/Approvals/ApprovalsHost'
import { StartupInteractiveMark } from './lib/startupTiming'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { installRendererErrorReporting } from './lib/rendererErrorsBoot'
import { applyMode, resolveMode, savedAppearance } from './design/mode'
import { initI18n } from './i18n'
import { installCloseGuard } from './lib/closeGuard'
import { applyMotion, resolveMotion, savedMotion } from './design/motion'
// Layer order and the base reset load before every other stylesheet.
import './styles/reset.css'
import './styles.css'
// Workspace color (A8): [data-ws] maps to the --ws tokens.
import './design/workspace-color.css'
import '@xyflow/react/dist/style.css'

// Crashes nothing caught reach the incident journal, as names and a stack hash only.
installRendererErrorReporting()
// Apply the saved light/dark and motion choices before the first paint, so the window never flashes the other mode.
applyMode(resolveMode(savedAppearance()))
applyMotion(resolveMotion(savedMotion()))
// Lets the frameless title bar reserve room for macOS traffic lights.
document.documentElement.dataset.platform = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux'

// Before anything renders: main asks the window before it closes, and a window that never answers is closed anyway.
installCloseGuard()

/**
 * T87: main could not open the database; ask before anything renders, so the normal interface never mounts empty.
 * Main registers the answer before the window exists, so it comes at once; a main that never answers must not leave
 * the window blank, so after 1.5 s the normal start goes on (FE review on #597).
 */
const startupFailure = (): Promise<import('../shared/types/app').StartupFailure | null> => Promise.race([
  (window.oxe?.app?.startupFailure?.() ?? Promise.resolve(null)).catch(() => null),
  new Promise<null>(resolve => { setTimeout(() => resolve(null), 1_500) })
])

/** The screen's own chunk failed to load: the reason still shows, as plain text. */
function plainFailure(failure: import('../shared/types/app').StartupFailure): void {
  const root = document.getElementById('root') as HTMLElement
  const box = document.createElement('main')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'padding:48px 24px;font:14px system-ui;white-space:pre-wrap;-webkit-app-region:drag'
  box.textContent = `OXESpace could not open its data (${failure.code}).\n\n${failure.message}\n\nBackups: ${failure.backupsPath}`
  root.replaceChildren(box)
}

// The interface language loads before the first render, so no text flashes in the other language.
void Promise.all([initI18n().catch(error => console.error('[i18n] could not start the translator', error)), startupFailure()]).then(async ([, failure]) => {
  if (failure) {
    try {
      const { StartupFailureScreen } = await import('./components/Startup/StartupFailureScreen')
      ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<StartupFailureScreen failure={failure} />)
    } catch { plainFailure(failure) }
    return
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      {/* A crash anywhere above the views' own boundaries shows OXESpace's message, never a blank window. */}
      <ErrorBoundary id="root" page label="OXESpace"><App /></ErrorBoundary>
      <ShortcutGuideHost />
      <TerminalFocusHost />
      <ReportProblemHost />
      <AboutHost />
      <WhatsNewHost />
      {/* Approval requests from main, in the window instead of a native dialog (F18). Its window loads at idle. */}
      <ApprovalsHost />
      <StartupInteractiveMark />
    </React.StrictMode>
  )
}).catch(error => console.error('[startup] the first screen could not load', error))
