import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ConnectionStore, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { PickedFiles } from '../../electron/main/services/oxequery/picked-files'
import { MAX_WORKSPACE_TABS, WorkspaceInputError, WorkspaceStore, normalizeWorkspace } from '../../electron/main/services/oxequery/workspace-store'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const cipher: SecretCipher = { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() }

function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  const store = new ConnectionStore(db, cipher, new PickedFiles())
  const connection = store.save({ name: 'one', engine: 'postgres', host: 'db', port: 5432 })
  return { db, store, connection, workspaces: new WorkspaceStore(db, () => 1_700_000_000_000) }
}

describe('workspace store', () => {
  it('keeps the tabs of a connection and gives them back', () => {
    const { workspaces, connection } = setup()
    expect(workspaces.load(connection.id)).toBeNull()
    workspaces.save(connection.id, { v: 1, activeId: 'q2', tabs: [{ id: 'q1', title: 'Orders', sql: 'SELECT 1' }, { id: 'q2', title: 'Query 2', sql: 'SELECT 2;\nSELECT 3', pinned: true }] })
    expect(workspaces.load(connection.id)).toEqual({ v: 1, activeId: 'q2', tabs: [{ id: 'q1', title: 'Orders', sql: 'SELECT 1' }, { id: 'q2', title: 'Query 2', sql: 'SELECT 2;\nSELECT 3', pinned: true }] })
    workspaces.save(connection.id, { v: 1, activeId: 'q1', tabs: [{ id: 'q1', title: 'Only', sql: '' }] })
    expect(workspaces.load(connection.id)?.tabs).toHaveLength(1)
  })

  it('goes away with the connection', () => {
    const { workspaces, connection, store, db } = setup()
    workspaces.save(connection.id, { v: 1, activeId: 'q1', tabs: [{ id: 'q1', title: 'T', sql: 'SELECT 1' }] })
    store.delete(connection.id)
    expect(db.prepare('SELECT count(*) AS n FROM oxequery_workspaces').get()).toEqual({ n: 0 })
  })

  it('accepts only a bounded list of well-formed tabs', () => {
    expect(() => normalizeWorkspace(null)).toThrow(WorkspaceInputError)
    expect(() => normalizeWorkspace({ tabs: [] })).toThrow(/at least one/)
    expect(() => normalizeWorkspace({ tabs: [{ id: '../x', title: 't', sql: '' }] })).toThrow(/invalid id/)
    const many = normalizeWorkspace({ activeId: 'nope', tabs: Array.from({ length: 40 }, (_, index) => ({ id: `q${index}`, title: 't', sql: '' })) })
    expect(many.tabs).toHaveLength(MAX_WORKSPACE_TABS)
    expect(many.activeId).toBe('q0')
    expect(() => normalizeWorkspace({ tabs: Array.from({ length: 12 }, (_, index) => ({ id: `q${index}`, title: 't', sql: 'x'.repeat(150_000) })) })).toThrow(/too large/)
  })
})
