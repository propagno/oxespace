// OXE-298: advanced handoff between providers. Part A, CA-4: a completed handoff leaves an append-only trail that names,
// for every step, the session that authored it, its provider and model, and when it happened in UTC (ISO-8601). The
// trail is read back with oxespace_thread_read. CA-1 to CA-3 follow in their own parts.
import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { findTool, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function setup() {
  const db = openInMemoryDatabase()
  const root = process.cwd(), now = Date.now()
  const source: ConversationThread = { id: randomUUID(), workspaceId: 'thread:project', projectId: 'project', rootPath: root,
    provider: 'claude', nativeSessionId: 'native-claude-1', title: 'Source', pinned: false, status: 'running', createdAt: now, updatedAt: now, generation: 1 }
  db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('project', root, root, 'Project', now, now)
  db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('project', root)
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
    .run(source.id, source.workspaceId, source.projectId, JSON.stringify(source), '[]')
  const snapshots = new Map<string, ThreadSnapshot>([[source.id, {
    thread: source,
    events: [{ type: 'configuration', model: 'claude-sonnet-4-5' }]
  } as unknown as ThreadSnapshot]])
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
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await findTool(name)!.handler(args, ctx)).content[0].text!)
  return { db, source, manager, call }
}

describe('OXE-298 cross-provider handoff', () => {
  test('completed cross-provider handoff records author session, model and UTC timestamp trail', async () => {
    const { db, source, call } = setup()
    try {
      const before = Date.now()
      const created = await call('oxespace_thread_create', { key: 'create-trail-1' }) as { threadId: string }
      await call('oxespace_thread_send', { threadId: created.threadId, key: 'send-trail-1', text: 'Continue the review' })
      // A retried key repeats nothing, in the conversation or in the trail.
      await call('oxespace_thread_create', { key: 'create-trail-1' })
      await call('oxespace_thread_send', { threadId: created.threadId, key: 'send-trail-1', text: 'Continue the review' })
      const after = Date.now()

      const read = await call('oxespace_thread_read', { threadId: created.threadId }) as { trail: Array<Record<string, unknown>> }
      expect(read.trail.map(entry => entry.step)).toEqual(['create', 'send'])
      for (const entry of read.trail) {
        expect(entry).toMatchObject({
          authorSessionId: source.id,
          authorNativeSessionId: 'native-claude-1',
          provider: 'claude',
          model: 'claude-sonnet-4-5',
          destinationThreadId: created.threadId
        })
        expect(entry.timestampUtc).toMatch(ISO_UTC)
        const at = Date.parse(entry.timestampUtc as string)
        expect(at).toBeGreaterThanOrEqual(before - 1)
        expect(at).toBeLessThanOrEqual(after + 1)
      }
      expect(read.trail[1]).toMatchObject({ state: 'submitted' })

      // Append-only: a trail entry is never rewritten.
      expect(() => db.prepare("UPDATE mcp_thread_handoff_trail SET provider = 'codex'").run()).toThrow(/append-only/)
      expect(db.prepare('SELECT COUNT(*) AS n FROM mcp_thread_handoff_trail').get()).toEqual({ n: 2 })
    } finally { db.close() }
  })
})
