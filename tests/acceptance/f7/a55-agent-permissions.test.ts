// Frozen acceptance test for 1.5.0 A55 / N4 (OXE program, phase F7), SECURITY: "What agents can do" lists, per
// provider, the always-allowed rules, the database access, the HTTP hosts agents called and the Policy, and everything
// but the Policy is revocable there, with an undo. Production databases offer only none and read. A host set to blocked
// is refused for the next agent call, and ask makes it ask. Temp project folders only.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A55; DESIGN 1.5.0-f7-design.md U7.4.
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { AgentPermissions } from '../../../electron/main/services/approvals/agent-permissions'
import { AlwaysAllow } from '../../../electron/main/services/approvals/always-allow'
import type { ThreadRequest } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) { try { removeTempDir(dir) } catch { /* temp */ } } })
const command = (text: string): ThreadRequest => ({ id: 'r1', nativeId: 'n1', nativeMethod: 'm', kind: 'approval', title: text, toolName: 'Bash', command: text, generation: 1, createdAt: 1, state: 'pending' }) as ThreadRequest

function setup() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f7-perm-')))
  temps.push(root)
  const allow = new AlwaysAllow({ projectRoot: () => root })
  const databases = new Map([['c-dev', { id: 'c-dev', name: 'shop', env: 'dev', access: 'read' }], ['c-prod', { id: 'c-prod', name: 'shop-prod', env: 'production', access: 'read' }]])
  const hosts = new Map<string, 'allowed' | 'ask' | 'blocked'>()
  const permissions = new AgentPermissions({
    alwaysAllow: allow,
    databases: { list: () => [...databases.values()], setAccess: (id, access) => { databases.get(id)!.access = access } },
    hosts: {
      observed: () => [{ host: 'api.example.com', callsToday: 4, production: false, insecure: false }, { host: 'api.prod.example', callsToday: 1, production: true, insecure: false }],
      get: (_workspaceId, host) => hosts.get(host) ?? 'allowed', set: (_workspaceId, host, access) => { hosts.set(host, access) }
    },
    policy: () => [{ section: 'hosts' as const, text: 'deny *.bank.example' }]
  })
  return { root, allow, permissions, databases, hosts }
}

describe('A55 · what agents can do', () => {
  test('A55: the page lists the always-allowed rules per provider, the databases with their access, the hosts with calls today, and the Policy', () => {
    const { root, allow, permissions } = setup()
    allow.apply(command('npm test'), 'claude', { threadId: 't1' })
    allow.apply(command('npm run build'), 'codex', { threadId: 't1' })
    const page = permissions.list({ workspaceId: 'ws1' })
    expect(page.rules.map(rule => [rule.provider, rule.text, rule.scope])).toEqual([['claude', 'Bash(npm test:*)', 'project'], ['codex', 'npm run build', 'session']])
    expect(page.rules[0].project).toBe(root)
    expect(page.databases).toEqual([{ id: 'c-dev', name: 'shop', env: 'dev', access: 'read' }, { id: 'c-prod', name: 'shop-prod', env: 'production', access: 'read' }])
    expect(page.hosts).toEqual([
      { host: 'api.example.com', access: 'allowed', callsToday: 4, production: false, insecure: false },
      { host: 'api.prod.example', access: 'allowed', callsToday: 1, production: true, insecure: false }
    ])
    expect(page.policy).toEqual([{ section: 'hosts', text: 'deny *.bank.example' }])
  })

  test('A55: revoking a rule removes it from the project file, and undo puts it back exactly once', () => {
    const { root, allow, permissions } = setup()
    allow.apply(command('npm test'), 'claude', { threadId: 't1' })
    const [rule] = permissions.list({ workspaceId: 'ws1' }).rules
    const revoked = permissions.revokeRule(rule.id)
    expect(revoked).toMatchObject({ ok: true, undoToken: expect.any(String) })
    const file = () => JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8'))
    expect(file().permissions.allow).toEqual([])
    expect(permissions.undo(revoked.undoToken!)).toEqual({ ok: true })
    expect(file().permissions.allow).toEqual(['Bash(npm test:*)'])
    expect(permissions.undo(revoked.undoToken!)).toMatchObject({ ok: false })
  })

  test('A55: database access: widening gives an undo; a production connection offers only none and read', () => {
    const { permissions, databases } = setup()
    const widened = permissions.setDatabaseAccess({ id: 'c-dev', access: 'write' })
    expect(widened).toMatchObject({ ok: true, undoToken: expect.any(String) })
    expect(databases.get('c-dev')!.access).toBe('write')
    permissions.undo(widened.undoToken!)
    expect(databases.get('c-dev')!.access).toBe('read')
    for (const access of ['write', 'ask-write'] as const) expect(permissions.setDatabaseAccess({ id: 'c-prod', access }), access).toEqual({ ok: false, code: 'permissions.production.readOnly' })
    expect(databases.get('c-prod')!.access).toBe('read')
    expect(permissions.setDatabaseAccess({ id: 'c-prod', access: 'none' })).toMatchObject({ ok: true })
  })

  test('A55 / U7.4d: a host set to blocked is refused for the next agent call; ask makes it ask; allowed lets it through', () => {
    const { permissions } = setup()
    expect(permissions.hostDecision({ workspaceId: 'ws1', host: 'api.example.com' })).toBe('allow')
    permissions.setHostAccess({ workspaceId: 'ws1', host: 'api.example.com', access: 'blocked' })
    expect(permissions.hostDecision({ workspaceId: 'ws1', host: 'api.example.com' })).toBe('deny')
    permissions.setHostAccess({ workspaceId: 'ws1', host: 'api.example.com', access: 'ask' })
    expect(permissions.hostDecision({ workspaceId: 'ws1', host: 'api.example.com' })).toBe('ask')
    // A Policy deny always wins, whatever the page says.
    permissions.setHostAccess({ workspaceId: 'ws1', host: 'pay.bank.example', access: 'allowed' })
    expect(permissions.hostDecision({ workspaceId: 'ws1', host: 'pay.bank.example' })).toBe('deny')
  })

  test('A55: Policy rows are read only: they cannot be revoked or changed from the page', () => {
    const { permissions } = setup()
    expect(permissions.revokeRule('policy:hosts:0')).toEqual({ ok: false, code: 'permissions.policy.readOnly' })
  })
})
