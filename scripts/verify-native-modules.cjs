const Database = require('better-sqlite3')
const pty = require('node-pty')

const db = new Database(':memory:')
try {
  db.exec('CREATE TABLE native_check (value TEXT)')
  db.prepare('INSERT INTO native_check (value) VALUES (?)').run('ok')
  if (db.prepare('SELECT value FROM native_check').get().value !== 'ok') {
    throw new Error('better-sqlite3 returned an unexpected result')
  }
  if (typeof pty.spawn !== 'function') throw new Error('node-pty did not expose spawn()')
  console.log(`Native Electron modules verified for ABI ${process.versions.modules}`)
} finally {
  db.close()
}
