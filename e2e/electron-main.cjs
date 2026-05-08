const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

import(pathToFileURL(join(__dirname, '..', 'out', 'main', 'index.js')).href).catch((error) => {
  console.error(error)
  process.exit(1)
})
