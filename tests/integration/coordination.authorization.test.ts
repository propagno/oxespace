import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { CoordinationAuthorization } from '../../electron/main/services/coordination/authorization'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture(role = 'requester') {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare('INSERT INTO delegations VALUES (?, ?, ?, ?, ?)').run('task', 'old', 'key', 'a', '{}')
  db.prepare('INSERT INTO coordination_scopes VALUES (?, ?, ?, ?, ?, ?)').run('task', 'a', 'project-a', 'b', 'project-b', 1)
  db.prepare('INSERT INTO coordination_participants VALUES (?, ?, ?, ?, ?)').run('member', 'task', role, 'a', 'project-a')
  const registry = new ExecutionRegistry()
  const launch = () => { registry.register({ paneId: 'pane', workspaceId: 'a', cwd: 'project-a' }); return registry.forPane('pane')! }
  let now = 100
  const auth = new CoordinationAuthorization(db, registry, async cwd => cwd, () => now)
  return { db, registry, launch, auth, expire: () => { now = 200 } }
}
describe('coordination authorization', () => {
  test('denies by default and requires both explicit consent and a binding', async () => {
    const f = fixture(); const execution = f.launch()
    await expect(f.auth.bindFromTrustedConsent('member', execution)).rejects.toThrow('DENIED')
    f.auth.grantFromTrustedConsent('member', 'read', 200)
    await expect(f.auth.authorize('member', 'task', execution, 'read')).rejects.toThrow('DENIED')
    await f.auth.bindFromTrustedConsent('member', execution)
    await expect(f.auth.authorize('member', 'task', execution, 'read')).resolves.toBeUndefined()
    await expect(f.auth.authorize('member', 'other-task', execution, 'read')).rejects.toThrow('DENIED')
    await expect(f.auth.authorize('member', 'task', execution, 'control')).rejects.toThrow('DENIED')
  })
  test.each(['executor', 'observer'])('%s cannot acquire requester control', role => {
    const f = fixture(role)
    expect(() => f.auth.grantFromTrustedConsent('member', 'control', 200)).toThrow('Invalid')
  })
  test('replacement and restart require adoption; old tokens never revive', async () => {
    const f = fixture(); const old = f.launch()
    f.auth.grantFromTrustedConsent('member', 'read', 200)
    await f.auth.bindFromTrustedConsent('member', old)
    const current = f.launch()
    await expect(f.auth.authorize('member', 'task', old, 'read')).rejects.toThrow()
    await expect(f.auth.authorize('member', 'task', current, 'read')).rejects.toThrow('DENIED')
    await f.auth.bindFromTrustedConsent('member', current)
    const restarted = new CoordinationAuthorization(f.db, f.registry, async cwd => cwd, () => 100)
    await expect(restarted.authorize('member', 'task', current, 'read')).rejects.toThrow('DENIED')
  })
  test('rejects expired/revoked grants and a different project', async () => {
    const f = fixture(); const execution = f.launch()
    f.auth.grantFromTrustedConsent('member', 'read', 200)
    await f.auth.bindFromTrustedConsent('member', execution)
    f.expire()
    await expect(f.auth.authorize('member', 'task', execution, 'read')).rejects.toThrow('DENIED')
    f.auth.grantFromTrustedConsent('member', 'read', 300)
    f.auth.revoke('member')
    await expect(f.auth.authorize('member', 'task', execution, 'read')).rejects.toThrow('DENIED')
    f.registry.register({ paneId: 'foreign', workspaceId: 'a', cwd: 'project-b' })
    f.auth.grantFromTrustedConsent('member', 'read', 300)
    await expect(f.auth.bindFromTrustedConsent('member', f.registry.forPane('foreign')!)).rejects.toThrow('DENIED')
    await expect(f.auth.bindFromTrustedConsent('member', { ...f.registry.forPane('foreign')!, cwd: 'project-a' })).rejects.toThrow('DENIED')
  })
})
