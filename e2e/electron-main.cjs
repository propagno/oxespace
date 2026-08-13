const { pathToFileURL } = require('node:url')
const { dirname, join } = require('node:path')
const { app } = require('electron')

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
