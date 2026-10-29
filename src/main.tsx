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
import { StartupInteractiveMark } from './lib/startupTiming'
import { applyMode, resolveMode, savedAppearance } from './design/mode'
import { initI18n } from './i18n'
// Layer order and the base reset load before every other stylesheet.
import './styles/reset.css'
import './styles.css'
import '@xyflow/react/dist/style.css'

// Apply the saved light/dark choice before the first paint, so the window never flashes the other mode.
applyMode(resolveMode(savedAppearance()))
// Lets the frameless title bar reserve room for macOS traffic lights.
document.documentElement.dataset.platform = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux'

// The interface language loads before the first render, so no text flashes in the other language.
void initI18n().catch(error => console.error('[i18n] could not start the translator', error)).finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
      <ShortcutGuideHost />
      <StartupInteractiveMark />
    </React.StrictMode>
  )
})
