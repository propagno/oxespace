import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, runMigrations, type AppDatabase } from '../../electron/main/db'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const open = () => { const db = openInMemoryDatabase(); databases.push(db); return db }
const root = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'

describe('the read-only list switch', () => {
  it('is on until a person turns it off, and the choice is remembered', () => {
    const db = open()
    const store = new ThreadPermissionStore(db)
    expect(store.autoApproveReads()).toBe(true)
    expect(store.evaluate(root, { kind: 'approval', command: 'git status' })).toMatchObject({ decision: 'allow', safeList: true })
    expect(store.setAutoApproveReads(false)).toBe(false)
    expect(new ThreadPermissionStore(db).autoApproveReads()).toBe(false)
    expect(store.evaluate(root, { kind: 'approval', command: 'git status' })?.decision).toBe('ask')
    store.setAutoApproveReads(true)
    expect(store.evaluate(root, { kind: 'approval', command: 'git status' })?.decision).toBe('allow')
  })

  it('keeps rules a person saved working while the list is off', () => {
    const store = new ThreadPermissionStore(open())
    store.add({ projectRoot: null, kind: 'command', pattern: 'git status', decision: 'allow' })
    store.setAutoApproveReads(false)
    expect(store.evaluate(root, { kind: 'approval', command: 'git status' })).toMatchObject({ decision: 'allow', reasons: ['Covered by the project permission rules.'] })
    expect(store.evaluate(root, { kind: 'approval', command: 'ls' })?.decision).toBe('ask')
  })

  it('turns the list off, not on, when the setting cannot be read', () => {
    const db = open()
    const store = new ThreadPermissionStore(db)
    db.exec('DROP TABLE thread_settings')
    expect(store.autoApproveReads()).toBe(false)
    expect(store.evaluate(root, { kind: 'approval', command: 'git status' })?.decision).toBe('ask')
  })

  it('a database from before the table existed gets it on upgrade, with the list on, and a second open changes nothing', () => {
    const db = open()
    db.exec('DROP TABLE thread_settings')
    db.pragma('user_version = 73')
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    const store = new ThreadPermissionStore(db)
    expect(store.autoApproveReads()).toBe(true)
    store.setAutoApproveReads(false)
    runMigrations(db)
    expect(new ThreadPermissionStore(db).autoApproveReads()).toBe(false)
  })
})
