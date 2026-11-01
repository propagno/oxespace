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
