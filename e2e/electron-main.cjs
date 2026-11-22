const { pathToFileURL } = require('node:url')
const { dirname, join } = require('node:path')
const { app, dialog } = require('electron')
const { installNativeDialogStubs } = require('./helpers/native-dialogs.cjs')

// No native dialog on the runner's screen, before main can open one (opt in: OXESPACE_E2E_NATIVE_DIALOGS=1).
installNativeDialogStubs(dialog, process.env)

// The interface follows the system language; specs assert English text, so they pin it unless a spec asks otherwise.
process.env.OXESPACE_LOCALE ||= 'en-US'

if (process.env.OXESPACE_E2E_MOCK_NATIVE === '1' && process.env.OXESPACE_E2E_PREVIEW_HANDLERS) {
  globalThis.previewHandlers = import(pathToFileURL(process.env.OXESPACE_E2E_PREVIEW_HANDLERS).href)
}

// OXE-331: a workspace made from the first run's wizard keeps the first run on screen (Step 2) instead of ejecting to
// OxeCode. Most specs create a workspace only to get to OxeCode, so after a wizard launch the harness leaves the first
// run through its footer "OxeCode", the way a person would. Specs about the first run opt out with
// OXESPACE_E2E_FIRST_RUN=stay (launchApp's `firstRun: 'stay'`). Harness only: nothing in the product changes.
if (process.env.OXESPACE_E2E_FIRST_RUN !== 'stay') {
  const leaveFirstRun = `(() => {
    if (window.__oxeE2eLeaveFirstRun) return
    window.__oxeE2eLeaveFirstRun = true
    let launched = false
    let launchedAt = 0
    document.addEventListener('click', (event) => {
      const target = event.target
      if (target && target.closest && target.closest('[data-testid="wizard-launch-btn"]')) { launched = true; launchedAt = Date.now() }
    }, true)
    const tick = () => {
      if (launched && Date.now() - launchedAt > 30000) launched = false
      if (!launched || document.querySelector('[data-testid="wizard-launch-btn"]')) return
      const firstRun = document.querySelector('[data-testid="first-run"]')
      if (!firstRun) return
      const button = [...firstRun.querySelectorAll('button')].find((node) => /^OxeCode\\b/.test((node.getAttribute('aria-label') || node.textContent || '').trim()))
      if (!button) return
      launched = false
      button.click()
    }
    new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true })
    setInterval(tick, 250)
  })()`
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('dom-ready', () => { win.webContents.executeJavaScript(leaveFirstRun).catch(() => undefined) })
  })
}

// Every E2E launch gets a unique database path. Keep Chromium/Electron state in
// the same isolated root as well; otherwise localStorage, caches and lock files
// leak between tests and make performance results order-dependent.
if (process.env.OXESPACE_DB_PATH) {
  app.setPath('userData', join(dirname(process.env.OXESPACE_DB_PATH), 'user-data'))
}

import(pathToFileURL(join(__dirname, '..', 'out', 'main', 'index.js')).href).catch((error) => {
  console.error(error)
  process.exit(1)
})
