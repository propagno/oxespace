import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, runMigrations, type AppDatabase } from '../../electron/main/db'
import { CoordinationTaskRepository } from '../../electron/main/services/coordination/task-repository'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function legacyFixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.exec('DROP TABLE coordination_subscriptions; DROP TABLE coordination_grants; DROP TABLE coordination_participants; DROP TABLE coordination_scopes; PRAGMA user_version = 49;')
  const payload = JSON.stringify({ project: 'project-a', state: 'interrupted', handoff: 'Keep this evidence' })
  db.prepare('INSERT INTO delegations VALUES (?, ?, ?, ?, ?)').run('task', 'old-execution', 'request', 'workspace-a', payload)
  db.prepare('INSERT INTO delegation_events(task_id, kind, text, created_at) VALUES (?, ?, ?, ?)').run('task', 'interrupted', 'Preserved', 1)
  return { db, payload }
}
describe('coordination identity foundation', () => {
  test('upgrades legacy tasks without changing payload, events or granting access', () => {
    const { db, payload } = legacyFixture()
    runMigrations(db)
    const repository = new CoordinationTaskRepository(db)
    expect(repository.getScope('task')).toEqual({ taskId: 'task', originWorkspaceId: 'workspace-a',
      originProjectId: 'project-a', targetWorkspaceId: 'workspace-a', targetProjectId: 'project-a', revision: 1 })
    expect(db.prepare('SELECT payload FROM delegations').get()).toEqual({ payload })
    expect(db.prepare('SELECT text FROM delegation_events').get()).toEqual({ text: 'Preserved' })
    const members = db.prepare('SELECT role FROM coordination_participants ORDER BY role').all()
    expect(members).toEqual([{ role: 'executor' }, { role: 'requester' }])
    expect(db.pragma('foreign_key_check')).toEqual([])
    runMigrations(db)
    expect(db.prepare('SELECT role FROM coordination_participants ORDER BY role').all()).toEqual(members)
  })
  test('rejects stale revisions and missing tasks', () => {
    const { db } = legacyFixture(); runMigrations(db)
    const repository = new CoordinationTaskRepository(db)
    expect(repository.advanceRevision('task', 1)).toBe(2)
    expect(() => repository.advanceRevision('task', 1)).toThrow('conflict')
    expect(() => repository.advanceRevision('missing', 1)).toThrow('conflict')
    expect(() => repository.advanceRevision('task', NaN)).toThrow('Invalid')
    expect(repository.getScope('task')?.revision).toBe(2)
  })
  test('rolls back migration if a statement fails', () => {
    const { db, payload } = legacyFixture()
    db.exec('CREATE VIEW coordination_participants AS SELECT 1 AS incompatible')
    expect(() => runMigrations(db)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(49)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'coordination_scopes'").get()).toBeUndefined()
    expect(db.prepare('SELECT payload FROM delegations').get()).toEqual({ payload })
  })
})
