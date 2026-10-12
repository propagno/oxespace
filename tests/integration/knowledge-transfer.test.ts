import { describe, expect, test } from 'vitest'
import { KnowledgeTransferService } from '../../electron/main/services/delegation/knowledge-transfer.service'
import type { DelegationTask } from '../../shared/types/delegation'

const task = (): DelegationTask => ({ id: 'task', key: 'key', agentProfileId: 'codex', objective: 'Implement auth', handoff: 'Use access_token=secret-value and preserve redirects', acceptance: 'Tests pass',
  workspaceId: 'workspace', project: 'project', originPaneId: 'origin', originExecutionId: 'execution', cwd: '/repo', path: '/worktree', branch: 'feature/auth', baseSha: 'abc',
  localChanges: ' M private.env', state: 'preparing', createdAt: 1, updatedAt: 1, evidence: [{ path: 'docs/decision.md', commit: 'abcdef1234567890', sha256: 'source-hash', text: 'Use HttpOnly cookies.' }] })

describe('KnowledgeTransferService', () => {
  test('produces a bounded, attributable and redacted revision without copying dirty contents', () => {
    const value = new KnowledgeTransferService().build(task(), 'Memory says password=hunter2')
    expect(value.version).toBe(1)
    expect(value.sha256).toHaveLength(64)
    expect(value.sources.map(source => source.kind)).toEqual(['handoff', 'acceptance', 'memory', 'evidence'])
    expect(value.context).toContain('private.env')
    expect(value.context).not.toContain('secret-value')
    expect(value.context).not.toContain('hunter2')
    expect(value.context).toContain('[REDACTED]')
    expect(Buffer.byteLength(value.context)).toBeLessThanOrEqual(24 * 1024)
  })

  test('increments immutable bundle revisions', () => {
    const service = new KnowledgeTransferService(), firstTask = task()
    const first = service.build(firstTask, '')
    firstTask.knowledgeBundle = first
    expect(service.build(firstTask, '').revision).toBe(2)
  })
  test('includes selected conversation snapshots alongside AI Memory with source identity', () => {
    const value = new KnowledgeTransferService().build({ ...task(), sessionContext: [
      { threadId: 'thread-a', title: 'Architecture', provider: 'claude', capturedAt: 1, text: 'User: Preserve the current API.' },
      { threadId: 'thread-b', title: 'Implementation', provider: 'codex', capturedAt: 2, text: 'Assistant: The migration is staged.' }
    ] }, { memory: 'project uses SQLite', code: 'CodeGraph found App.tsx' })
    expect(value.sources.map(source => source.kind)).toEqual(['handoff', 'acceptance', 'memory', 'session', 'session', 'evidence', 'code'])
    expect(value.context).toContain('thread-a')
    expect(value.context).toContain('thread-b')
    expect(value.context).toContain('project uses SQLite')
    expect(value.context).toContain('CodeGraph found App.tsx')
  })
  test('truncates multibyte context without exceeding its byte budget or corrupting Unicode', () => {
    const value = new KnowledgeTransferService().build(task(), 'Contexto verificado 🎯 ação '.repeat(5000))
    expect(Buffer.byteLength(value.context)).toBeLessThanOrEqual(24 * 1024)
    expect(value.context).not.toContain('\uFFFD')
  })
  test('reserves space for AI Memory and every selected conversation under a large handoff', () => {
    const source = task()
    source.handoff = 'H'.repeat(16000)
    source.localChanges = ' M changed-file.ts\n'.repeat(500)
    source.sessionContext = Array.from({ length: 5 }, (_, index) => ({
      threadId: `thread-${index}`, title: `Source ${index}`, provider: 'codex' as const,
      capturedAt: 1, text: `Decision ${index} ` + 'D'.repeat(2900)
    }))
    const bundle = new KnowledgeTransferService().build(source, { memory: 'AI memory decision ' + 'M'.repeat(3900) })
    expect(bundle.sources.filter(item => item.kind === 'session')).toHaveLength(5)
    expect(bundle.sources.some(item => item.kind === 'memory')).toBe(true)
    expect(bundle.context).toContain('AI memory decision')
    expect(bundle.sources.find(item => item.kind === 'handoff')).toMatchObject({ bytes: 6000, availableBytes: 16000, truncated: true })
    expect(bundle.sources.find(item => item.kind === 'acceptance')).toMatchObject({ truncated: false })
    expect(bundle.sources.filter(item => item.kind === 'session').every(item => item.truncated)).toBe(true)
    expect(Buffer.byteLength(bundle.context)).toBeLessThanOrEqual(24 * 1024)
  })
})
