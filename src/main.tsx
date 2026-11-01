import React from 'react'
import ReactDOM from 'react-dom/client'
// Mandacaru typography, bundled so it loads offline: IBM Plex for the
// interface and code, Bricolage Grotesque for display (docs/design/brand.md).
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource-variable/bricolage-grotesque'
import { App } from './App'
import { ShortcutGuideHost } from './components/Keyboard/ShortcutGuideHost'
import { TerminalFocusHost } from './components/Keyboard/TerminalFocusHost'
import { ReportProblemHost } from './components/Diagnostics/ReportProblemHost'
import { AboutHost } from './components/About/AboutHost'
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

// The interface language loads before the first render, so no text flashes in the other language.
void initI18n().catch(error => console.error('[i18n] could not start the translator', error)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      {/* A crash anywhere above the views' own boundaries shows OXESpace's message, never a blank window. */}
      <ErrorBoundary id="root" page label="OXESpace"><App /></ErrorBoundary>
      <ShortcutGuideHost />
      <TerminalFocusHost />
      <ReportProblemHost />
      <AboutHost />
      <StartupInteractiveMark />
    </React.StrictMode>
  )
})
