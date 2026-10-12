import { createHash } from 'node:crypto'
import type { ToolContext, ToolEntry } from './tool-registry'
import { ThreadProjectService } from '../services/conversation/thread-projects'

function input(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
  return args as Record<string, unknown>
}

function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new Error('key must contain 8–100 letters, digits, _ or -')
  return value
}

function origin(ctx: ToolContext): string {
  const execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
  if (!execution || execution.owner.kind !== 'thread') throw new Error('Open this tool from a live OXESpace Thread execution')
  return execution.owner.id
}

function result(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

const requestKey = { type: 'string', minLength: 8, maxLength: 100, description: 'Stable caller-generated idempotency key. Reuse the same key only when retrying the same action.' }

export const THREAD_HANDOFF_TOOLS: ToolEntry[] = [
  {
    descriptor: { name: 'oxespace_thread_create', description: 'Create a new normal Thread in the same project and provider as this live Thread. Requires a stable key; retrying the key returns the same destination.', inputSchema: {
      type: 'object', properties: { key: requestKey }, required: ['key'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const originId = origin(ctx), requestKey = key(input(args).key)
      if (!ctx.db || !ctx.threads) throw new Error('Thread service is unavailable')
      const manager = await ctx.threads
      const source = manager.read(originId).thread
      const project = new ThreadProjectService(ctx.db).context(source.projectId, source.rootPath)
      const existing = ctx.db.prepare('SELECT destination_thread_id FROM mcp_thread_handoffs WHERE origin_thread_id = ? AND request_key = ?')
        .get(originId, requestKey) as { destination_thread_id: string } | undefined
      if (existing) return result({ threadId: existing.destination_thread_id, created: false, projectId: project.projectId })
      const count = ctx.db.prepare('SELECT COUNT(*) AS value FROM mcp_thread_handoffs WHERE origin_thread_id = ?').get(originId) as { value: number }
      if (count.value >= 5) throw new Error('This origin Thread has reached the limit of 5 MCP-created destinations')
      const created = ctx.db.transaction(() => {
        const snapshot = manager.create({ workspaceId: `thread:${project.projectId}`, projectId: project.projectId, rootPath: project.rootPath, provider: source.provider })
        ctx.db!.prepare('INSERT INTO mcp_thread_handoffs (origin_thread_id, request_key, destination_thread_id, created_at) VALUES (?, ?, ?, ?)')
          .run(originId, requestKey, snapshot.thread.id, Date.now())
        return snapshot.thread.id
      })()
      return result({ threadId: created, created: true, projectId: project.projectId, next: 'Use oxespace_thread_send with this threadId and a new idempotency key.' })
    }
  },
  {
    descriptor: { name: 'oxespace_thread_send', description: 'Send one text message to a Thread created by this origin via oxespace_thread_create. Requires a stable key; an uncertain prior delivery is never repeated automatically.', inputSchema: {
      type: 'object', properties: { threadId: { type: 'string' }, key: requestKey, text: { type: 'string', minLength: 1, maxLength: 65536 } }, required: ['threadId', 'key', 'text'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const originId = origin(ctx), values = input(args), requestKey = key(values.key)
      if (!ctx.db || !ctx.threads) throw new Error('Thread service is unavailable')
      const threadId = values.threadId
      const message = values.text
      if (typeof threadId !== 'string' || !threadId || typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 65536) throw new Error('Provide a destination threadId and a nonempty message up to 65536 bytes')
      const owned = ctx.db.prepare('SELECT 1 FROM mcp_thread_handoffs WHERE origin_thread_id = ? AND destination_thread_id = ?').get(originId, threadId)
      if (!owned) throw new Error('Destination Thread was not created by this origin execution')
      const hash = createHash('sha256').update(message).digest('hex')
      const previous = ctx.db.prepare('SELECT text_sha256, state FROM mcp_thread_handoff_sends WHERE destination_thread_id = ? AND request_key = ?')
        .get(threadId, requestKey) as { text_sha256: string; state: string } | undefined
      if (previous) {
        if (previous.text_sha256 !== hash) throw new Error('This key was already used for a different message')
        return result({ threadId, state: previous.state, repeated: true, ...(previous.state === 'started' || previous.state === 'unknown' ? { delivery: 'unknown', next: 'Inspect the destination Thread before deciding whether to send a new message.' } : {}) })
      }
      const count = ctx.db.prepare('SELECT COUNT(*) AS value FROM mcp_thread_handoff_sends WHERE destination_thread_id = ?').get(threadId) as { value: number }
      if (count.value >= 20) throw new Error('This destination Thread has reached the limit of 20 MCP messages')
      ctx.db.prepare('INSERT INTO mcp_thread_handoff_sends (destination_thread_id, request_key, text_sha256, state, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(threadId, requestKey, hash, 'started', Date.now())
      try {
        await (await ctx.threads).send(threadId, message)
        ctx.db.prepare("UPDATE mcp_thread_handoff_sends SET state = 'submitted', updated_at = ? WHERE destination_thread_id = ? AND request_key = ?")
          .run(Date.now(), threadId, requestKey)
        return result({ threadId, state: 'submitted', delivery: 'accepted-by-thread', note: 'The agent turn may still be running.' })
      } catch (error) {
        ctx.db.prepare("UPDATE mcp_thread_handoff_sends SET state = 'unknown', updated_at = ? WHERE destination_thread_id = ? AND request_key = ?")
          .run(Date.now(), threadId, requestKey)
        return result({ threadId, state: 'unknown', delivery: 'unknown', error: error instanceof Error ? error.message : 'Thread submission failed', next: 'Inspect the destination Thread before deciding whether to send a new message.' }, true)
      }
    }
  }
]
