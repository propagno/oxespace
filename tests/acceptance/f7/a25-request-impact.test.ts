// Frozen acceptance test for 1.5.0 A25 and A28 (OXE program, phase F7), SECURITY: every approval request carries its
// impact facts, built in main: what kind of change, where it runs, what it affects, whether it can be undone and how,
// the risk, and the exact text. TECH LEAD's HML-F7-1 decision (08/11): critical only for production database writes,
// any push, destructive commands and writes outside the checkpointed places; a non-production database write is high
// and irreversible. Critical reaches the phone as critical (T78); a database write is answered only at the computer.
// Values, never sentences (C3).
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A25, §A28; DESIGN 1.5.0-f7-design.md U7.2, U7.6.
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { requestImpact } from '../../../electron/main/services/approvals/request-impact'
import { toPendingRequest } from '../../../electron/main/services/remote/filters'
import type { ConversationThread, ThreadRequest } from '../../../shared/types/thread'

const ROOT = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop'
const SECRET = `sk-ant-${'z'.repeat(40)}`
const request = (over: Partial<ThreadRequest>): ThreadRequest => ({ id: 'r1', nativeId: 'n1', nativeMethod: 'm', kind: 'approval', title: 'Run a command', generation: 1, createdAt: 1, state: 'pending', ...over }) as ThreadRequest
const ctx = { root: ROOT, workspaceName: 'shop' }

describe('A25 · the impact facts', () => {
  test('A25: a read-only command is a reversible, low-risk command, with the exact text and where it runs', () => {
    const impact = requestImpact(request({ toolName: 'Bash', command: 'npm test', cwd: join(ROOT, 'web') }), ctx)
    expect(impact).toMatchObject({ kind: 'command', reversible: true, risk: 'low', text: 'npm test', lang: 'shell', where: 'shop', whereSub: 'web' })
  })

  test('A25: a destructive command is irreversible and critical; a forced push is kind push, critical', () => {
    expect(requestImpact(request({ toolName: 'Bash', command: 'rm -rf dist build' }), ctx)).toMatchObject({ kind: 'command', reversible: false, risk: 'critical' })
    expect(requestImpact(request({ toolName: 'Bash', command: 'git push --force origin main' }), ctx)).toMatchObject({ kind: 'push', reversible: false, risk: 'critical' })
  })

  test('A25: a file edit is reversible from the checkpoint, and affects its files', () => {
    const impact = requestImpact(request({ toolName: 'Edit', paths: [join(ROOT, 'src', 'a.ts'), join(ROOT, 'src', 'b.ts')] }), ctx)
    expect(impact).toMatchObject({ kind: 'file', reversible: true, undoHow: 'checkpoint', affects: { count: 2, unit: 'files' } })
    expect(impact.risk).not.toBe('critical')
  })

  test('HML-F7-1: a local or test database write is high and irreversible (no snapshot); the same write on production is critical', () => {
    const sql = 'UPDATE orders SET status = \'paid\' WHERE id = 7'
    for (const env of ['dev', 'local', 'test', 'staging']) {
      expect(requestImpact(request({ toolName: 'oxespace_db_execute', command: sql }), { ...ctx, database: { name: 'shop', env, engine: 'postgres' } }), env)
        .toMatchObject({ kind: 'db', reversible: false, risk: 'high', lang: 'sql', where: 'shop', whereSub: env, affects: { count: null, unit: 'rows' } })
    }
    expect(requestImpact(request({ toolName: 'oxespace_db_execute', command: sql }), { ...ctx, database: { name: 'shop-prod', env: 'production', engine: 'postgres' } })).toMatchObject({ kind: 'db', reversible: false, risk: 'critical' })
  })

  test('HML-F7-1: any push is critical whatever the remote; destructive commands are critical', () => {
    for (const text of ['git push origin feature', 'git push', 'git push --tags', 'gh pr merge 3', 'npm publish', 'docker push shop/api']) expect(requestImpact(request({ toolName: 'Bash', command: text }), ctx), text).toMatchObject({ kind: 'push', reversible: false, risk: 'critical' })
    for (const text of ['rm notes.txt', 'git reset --hard HEAD~1', 'git clean -fd', 'git branch -D topic']) expect(requestImpact(request({ toolName: 'Bash', command: text }), ctx), text).toMatchObject({ reversible: false, risk: 'critical' })
  })

  test('HML-714-6: an edit outside the checkpointed places (outside the project, the home folder) and a shell redirection into a file are irreversible and critical', () => {
    const outside = process.platform === 'win32' ? 'C:\\Users\\dev\\.bashrc' : '/home/dev/.bashrc'
    expect(requestImpact(request({ toolName: 'Edit', paths: [outside] }), ctx)).toMatchObject({ kind: 'file', reversible: false, risk: 'critical' })
    expect(requestImpact(request({ toolName: 'Edit', paths: [join(ROOT, 'src', 'a.ts'), outside] }), ctx)).toMatchObject({ reversible: false, risk: 'critical' })
    expect(requestImpact(request({ toolName: 'Bash', command: 'echo token=1 > .env' }), ctx)).toMatchObject({ reversible: false, risk: 'critical' })
    expect(requestImpact(request({ toolName: 'Bash', command: 'npm test >> log.txt' }), ctx)).toMatchObject({ reversible: false, risk: 'critical' })
  })

  test('A25: a container stop is reversible (start it again); a container removal is not', () => {
    expect(requestImpact(request({ toolName: 'oxespace_container_action', command: 'stop api' }), ctx)).toMatchObject({ kind: 'container', reversible: true, undoHow: 'start', affects: { count: 1, unit: 'resources' } })
    expect(requestImpact(request({ toolName: 'oxespace_container_action', command: 'remove api' }), ctx)).toMatchObject({ kind: 'container', reversible: false, risk: 'critical' })
  })

  test('A25: the text is redacted; nothing in the impact is an app sentence', () => {
    const impact = requestImpact(request({ toolName: 'Bash', command: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com` }), ctx)
    expect(JSON.stringify(impact)).not.toContain(SECRET)
    expect(JSON.stringify(impact)).not.toMatch(/can't be undone|Hold Approve|Where it runs/i)
  })
})

describe('A28 · the phone sees critical', () => {
  const thread = { id: 't1', workspaceId: 'ws1', rootPath: ROOT, title: 'Fix', provider: 'claude' } as ConversationThread
  test('A28: an irreversible request reaches the phone as risk critical, whatever the shell level said', () => {
    const shown = toPendingRequest({ thread, request: request({ toolName: 'Bash', command: 'rm -rf dist', policy: { decision: 'ask', reasons: [], level: 'orange' }, impact: requestImpact(request({ toolName: 'Bash', command: 'rm -rf dist' }), ctx) } as Partial<ThreadRequest>) }, [ROOT])
    expect(shown.risk).toBe('critical')
  })

  test('A28: a database write is answered only at the computer: the phone gets it with no decisions', () => {
    const impact = requestImpact(request({ toolName: 'oxespace_db_execute', command: 'DELETE FROM carts WHERE id = 1' }), { ...ctx, database: { name: 'shop', env: 'dev', engine: 'postgres' } })
    const shown = toPendingRequest({ thread, request: request({ toolName: 'oxespace_db_execute', command: 'DELETE FROM carts WHERE id = 1', impact } as Partial<ThreadRequest>) }, [ROOT])
    expect(shown).toMatchObject({ answerable: false, decisions: [] })
    // The path is live: a reversible command stays answerable from the phone.
    const ok = toPendingRequest({ thread, request: request({ toolName: 'Bash', command: 'npm test', impact: requestImpact(request({ toolName: 'Bash', command: 'npm test' }), ctx) } as Partial<ThreadRequest>) }, [ROOT])
    expect(ok.answerable).toBe(true)
  })
})
