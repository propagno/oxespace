import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { findTool, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'

describe('MCP normal Thread handoff', () => {
  test('creates once, sends once, and limits the destination to its origin', async () => {
    const db = openInMemoryDatabase()
    try {
      const root = process.cwd(), now = Date.now()
      const source: ConversationThread = { id: randomUUID(), workspaceId: 'thread:project', projectId: 'project', rootPath: root,
        provider: 'codex', nativeSessionId: null, title: 'Source', pinned: false, status: 'running', createdAt: now, updatedAt: now, generation: 1 }
      db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('project', root, root, 'Project', now, now)
      db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('project', root)
      db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
        .run(source.id, source.workspaceId, source.projectId, JSON.stringify(source), '[]')
      const snapshots = new Map<string, ThreadSnapshot>([[source.id, { thread: source, events: [] }]])
      const manager = {
        read: (id: string) => { const value = snapshots.get(id); if (!value) throw new Error('Thread not found'); return value },
        create: (context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider'>) => {
          const thread: ConversationThread = { ...context, id: randomUUID(), nativeSessionId: null, title: 'New thread', pinned: false, status: 'idle', createdAt: now, updatedAt: now, generation: 1 }
          db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
            .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
          const snapshot = { thread, events: [] }
          snapshots.set(thread.id, snapshot)
          return snapshot
        },
        send: vi.fn(async () => undefined)
      }
      const executions = new ExecutionRegistry()
      const env = executions.register({ owner: { kind: 'thread', id: source.id }, workspaceId: source.workspaceId, cwd: root })
      const ctx = { db, threads: Promise.resolve(manager), executions, workspaceId: source.workspaceId,
        executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN } as unknown as ToolContext
      const create = findTool('oxespace_thread_create')!
      const send = findTool('oxespace_thread_send')!
      const first = JSON.parse((await create.handler({ key: 'create-123' }, ctx)).content[0].text!) as { threadId: string; created: boolean }
      const repeated = JSON.parse((await create.handler({ key: 'create-123' }, ctx)).content[0].text!) as { threadId: string; created: boolean }
      expect(first.created).toBe(true)
      expect(repeated).toMatchObject({ threadId: first.threadId, created: false })
      expect(db.prepare('SELECT COUNT(*) AS n FROM mcp_thread_handoffs').get()).toEqual({ n: 1 })
      const message = { threadId: first.threadId, key: 'send-12345', text: `${root}\\screenshots` }
      const submitted = await send.handler(message, ctx)
      expect(JSON.parse(submitted.content[0].text!)).toMatchObject({ threadId: first.threadId, state: 'submitted' })
      expect(JSON.parse((await send.handler(message, ctx)).content[0].text!)).toMatchObject({ repeated: true, state: 'submitted' })
      expect(manager.send).toHaveBeenCalledOnce()
      await expect(send.handler({ ...message, threadId: source.id, key: 'send-other' }, ctx)).rejects.toThrow('not created by this origin')
      await expect(send.handler({ ...message, text: 'different' }, ctx)).rejects.toThrow('different message')
    } finally { db.close() }
  })
})
