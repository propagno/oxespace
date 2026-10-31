import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { DEFAULT_PREFERENCES, PreferenceInputError, PreferenceStore, effectiveAgentAccess, normalizePreferences } from '../../electron/main/services/oxequery/preferences'
import { QueryLibrary } from '../../electron/main/services/oxequery/query-library'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const open = (): AppDatabase => { const db = openInMemoryDatabase(); databases.push(db); return db }

describe('OxeQuery preferences', () => {
  it('start at the defaults, keep what is set, and survive a restart', () => {
    const db = open()
    expect(new PreferenceStore(db).get()).toEqual(DEFAULT_PREFERENCES)
    new PreferenceStore(db).set({ historyLimit: 50, agentCeiling: { dev: 'read' } })
    const again = new PreferenceStore(db).get()
    expect(again).toMatchObject({ historyLimit: 50, auditRetentionDays: 90, agentCeiling: { local: 'write', dev: 'read', prod: 'read' } })
  })

  it('refuses nonsense when set, never lets agents write to production, and repairs what is stored', () => {
    const store = new PreferenceStore(open())
    expect(() => store.set({ historyLimit: 5 })).toThrow(PreferenceInputError)
    expect(() => store.set({ auditRetentionDays: 9999 })).toThrow(/between/)
    expect(() => store.set({ agentCeiling: { dev: 'root' as never } })).toThrow(/off, read or write/)
    expect(store.set({ agentCeiling: { prod: 'write' } }).agentCeiling.prod).toBe('read')
    expect(normalizePreferences({ historyLimit: 'many', agentCeiling: { prod: 'write', dev: 'nope' } })).toMatchObject({ historyLimit: 200, agentCeiling: { prod: 'read', dev: 'write' } })
  })

  it('takes the lower of the connection and its environment', () => {
    expect(effectiveAgentAccess('write', 'read')).toBe('read')
    expect(effectiveAgentAccess('read', 'write')).toBe('read')
    expect(effectiveAgentAccess('write', 'off')).toBe('off')
    expect(effectiveAgentAccess('off', 'write')).toBe('off')
  })

  it('sets how many statements a connection keeps', () => {
    const db = open()
    db.prepare("INSERT INTO oxequery_connections (id, name, engine, host, port, created_at, updated_at) VALUES ('c', 'c', 'postgres', 'h', 5432, 1, 1)").run()
    let limit = 3
    const library = new QueryLibrary(db, Date.now, () => limit)
    for (let index = 0; index < 6; index++) library.record('c', { sql: `SELECT ${index}`, durationMs: 1, rows: 1, ok: true })
    expect(library.list('c').history.map(item => item.sql)).toEqual(['SELECT 5', 'SELECT 4', 'SELECT 3'])
    limit = 2
    expect(library.list('c').history).toHaveLength(2)
  })
})
