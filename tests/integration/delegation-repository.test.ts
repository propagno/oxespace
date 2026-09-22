import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { DelegationRepository } from '../../electron/main/services/delegation/delegation.repository'
import type { DelegationTask } from '../../shared/types/delegation'

function task(id: string, updatedAt: number): DelegationTask {
  return { id, schemaVersion: 2, key: `key-${id}`, agentProfileId: 'codex', objective: `Task ${id}`, handoff: 'handoff', acceptance: 'done',
    targetWorkspaceId: 'workspace', mode: 'isolated-change', surface: 'thread', branchIntent: { strategy: 'create', name: `work/${id}` },
    workspaceId: 'workspace', project: 'project', originPaneId: 'origin', originExecutionId: `execution-${id}`, cwd: '/repo', path: `/worktrees/${id}`,
    branch: `work/${id}`, baseSha: 'abc', localChanges: '', state: 'interrupted', createdAt: updatedAt, updatedAt,
    checkout: { strategy: 'create', requestedBranch: `work/${id}`, branch: `work/${id}`, baseRef: 'main', baseSha: 'abc', path: `/worktrees/${id}`,
      createBranch: true, reuseExistingWorktree: false, fetchBase: false, resolvedAt: updatedAt } }
}

describe('DelegationRepository', () => {
  test('indexes, paginates and persists exact session bindings', () => {
    const db = openInMemoryDatabase()
    try {
      const repository = new DelegationRepository(db)
      for (let index = 0; index < 1005; index++) repository.save(task(String(index).padStart(4, '0'), index + 1))
      const first = repository.byWorkspace('workspace', 100)
      expect(first.tasks).toHaveLength(100)
      expect(first.nextCursor).not.toBeNull()
      const second = repository.byWorkspace('workspace', 100, first.nextCursor!)
      expect(second.tasks).toHaveLength(100)
      expect(new Set([...first.tasks, ...second.tasks].map(value => value.id)).size).toBe(200)

      const selected = repository.get('1004')!
      selected.nativeSession = { provider: 'codex', nativeSessionId: 'native-1004', canonicalRoot: selected.path, generation: 2, observedAt: Date.now(), resumable: true }
      repository.save(selected)
      expect(db.prepare('SELECT provider, native_session_id AS id, generation FROM delegation_session_bindings WHERE task_id = ?').get('1004'))
        .toEqual({ provider: 'codex', id: 'native-1004', generation: 2 })
      expect(repository.get('1004')?.recoveryActions).toContain('resume')
      expect(repository.get('1004')?.recoveryActions).not.toContain('retry')
      const conflicting = repository.get('1003')!
      conflicting.nativeSession = selected.nativeSession
      expect(() => repository.save(conflicting)).toThrow()
      expect(repository.get('1003')?.nativeSession).toBeUndefined()
      expect(() => repository.byWorkspace('workspace', Number.NaN)).toThrow('page size')
      const durations: number[] = []
      for (let index = 0; index < 100; index++) {
        const started = performance.now()
        repository.byWorkspace('workspace', 50)
        durations.push(performance.now() - started)
      }
      const p95 = durations.sort((a, b) => a - b)[94]
      console.info(`Delegation repository: 1005 tasks, page 50, p95=${p95.toFixed(2)}ms`)
      expect(p95).toBeLessThan(50)
      repository.journal('1004', 'provider-resume', 3, 'running')
      expect(repository.settleRunningUnknown('restart')).toBe(1)
      expect(db.prepare('SELECT state, error FROM delegation_operation_journal WHERE task_id = ? AND operation = ?').get('1004', 'provider-resume'))
        .toEqual({ state: 'unknown', error: 'restart' })
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT task_id FROM delegation_task_index WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100").all('workspace') as Array<{ detail: string }>
      expect(plan.some(row => row.detail.includes('delegation_task_workspace_updated'))).toBe(true)
    } finally { db.close() }
  })
})
