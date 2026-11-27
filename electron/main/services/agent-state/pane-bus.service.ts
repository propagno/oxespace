import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db/index'
import { maskLogLine } from '../oxequery/agent-output'

export const MAX_BUS_HOPS = 3
export const BUS_RATE_LIMIT_PER_MIN = 30
export const DEFAULT_BUS_TTL_MS = 30 * 60_000
export const MAX_BUS_TTL_MS = 24 * 60 * 60_000
export const MAX_BUS_PAYLOAD_BYTES = 16_384
export const MAX_BUS_WAIT_MS = 100_000

const RATE_WINDOW_MS = 60_000

export class PaneBusError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'max-hops' | 'rate-limit' | 'not-found') {
    super(message)
  }
}

export interface PaneBusMessage {
  id: string
  workspaceId: string
  fromPaneId: string
  toPaneId: string
  fromActor: string
  fromProvider: string | null
  topic: string
  correlationId: string | null
  replyToId: string | null
  payload: unknown
  attachments: string[]
  hops: number
  createdAt: number
  expiresAt: number
  ackedAt: number | null
}

export interface PaneBusSendInput {
  workspaceId: string
  fromPaneId: string
  toPaneId: string
  fromActor: string
  fromProvider?: string | null
  topic: string
  correlationId?: string | null
  replyToId?: string | null
  payload?: unknown
  attachments?: string[]
  ttlMs?: number
}

export interface PaneBusInboxQuery {
  toPaneId: string
  topic?: string
  correlationId?: string
  includeAcked?: boolean
  limit?: number
}

export interface PaneBusWaitQuery {
  toPaneId: string
  correlationId?: string
  replyToId?: string
  topic?: string
  timeoutMs?: number
}

export interface PaneOwnerRecord {
  paneId: string
  ownerActorKey: string
  ownerPaneId: string | null
  workspaceId: string
  createdAt: number
}

interface MessageRow {
  id: string
  workspace_id: string
  from_pane_id: string
  to_pane_id: string
  from_actor: string
  from_provider: string | null
  topic: string
  correlation_id: string | null
  reply_to_id: string | null
  payload_json: string
  attachments_json: string
  hops: number
  created_at: number
  expires_at: number
  acked_at: number | null
}

interface Waiter {
  query: PaneBusWaitQuery
  resolve: (result: { timedOut: boolean; message: PaneBusMessage | null }) => void
  timer: ReturnType<typeof setTimeout>
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]'
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return maskLogLine(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizePayload(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[key] = sanitizePayload(entry, depth + 1)
    }
    return out
  }
  return maskLogLine(String(value))
}

function rowToMessage(row: MessageRow): PaneBusMessage {
  let payload: unknown
  let attachments: string[] = []
  try { payload = JSON.parse(row.payload_json) } catch { payload = row.payload_json }
  try {
    const parsed = JSON.parse(row.attachments_json)
    if (Array.isArray(parsed)) attachments = parsed.filter((item): item is string => typeof item === 'string')
  } catch { attachments = [] }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    fromPaneId: row.from_pane_id,
    toPaneId: row.to_pane_id,
    fromActor: row.from_actor,
    fromProvider: row.from_provider,
    topic: row.topic,
    correlationId: row.correlation_id,
    replyToId: row.reply_to_id,
    payload,
    attachments,
    hops: row.hops,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ackedAt: row.acked_at
  }
}

export class PaneBusService {
  private readonly rateBuckets = new Map<string, number[]>()
  private readonly waiters = new Set<Waiter>()
  private readonly now: () => number

  constructor(private readonly db: AppDatabase, now: () => number = Date.now) {
    this.now = now
  }

  send(input: PaneBusSendInput): PaneBusMessage {
    const now = this.now()
    this.pruneExpired(now)

    const topic = input.topic.trim()
    if (!topic || topic.length > 120) throw new PaneBusError('topic must be 1-120 characters.', 'invalid')
    if (!input.toPaneId.trim() || !input.fromPaneId.trim()) throw new PaneBusError('fromPaneId and toPaneId are required.', 'invalid')
    if (input.fromPaneId === input.toPaneId) throw new PaneBusError('A pane cannot send a bus message to itself.', 'invalid')

    this.checkRateLimit(input.fromActor, now)

    let hops = 0
    if (input.replyToId) {
      const parent = this.db.prepare('SELECT hops FROM pane_bus_messages WHERE id = ?').get(input.replyToId) as { hops: number } | undefined
      if (parent) hops = parent.hops + 1
    }
    if (hops > MAX_BUS_HOPS) {
      throw new PaneBusError(`Pane-bus message chain exceeded maxHops (${MAX_BUS_HOPS}).`, 'max-hops')
    }

    const sanitizedPayload = sanitizePayload(input.payload ?? null)
    const payloadJson = JSON.stringify(sanitizedPayload)
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_BUS_PAYLOAD_BYTES) {
      throw new PaneBusError(`Payload exceeds maximum size of ${MAX_BUS_PAYLOAD_BYTES} bytes.`, 'invalid')
    }

    const attachments = (input.attachments ?? []).filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 500).slice(0, 25)
    const ttlMs = Math.max(1000, Math.min(Math.trunc(input.ttlMs ?? DEFAULT_BUS_TTL_MS), MAX_BUS_TTL_MS))
    const message: PaneBusMessage = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      fromPaneId: input.fromPaneId,
      toPaneId: input.toPaneId,
      fromActor: input.fromActor,
      fromProvider: input.fromProvider ?? null,
      topic,
      correlationId: input.correlationId?.trim() || null,
      replyToId: input.replyToId?.trim() || null,
      payload: sanitizedPayload,
      attachments,
      hops,
      createdAt: now,
      expiresAt: now + ttlMs,
      ackedAt: null
    }

    this.db.prepare(`
      INSERT INTO pane_bus_messages (
        id, workspace_id, from_pane_id, to_pane_id, from_actor, from_provider,
        topic, correlation_id, reply_to_id, payload_json, attachments_json,
        hops, created_at, expires_at, acked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      message.id,
      message.workspaceId,
      message.fromPaneId,
      message.toPaneId,
      message.fromActor,
      message.fromProvider,
      message.topic,
      message.correlationId,
      message.replyToId,
      payloadJson,
      JSON.stringify(message.attachments),
      message.hops,
      message.createdAt,
      message.expiresAt
    )

    this.notifyWaiters(message)
    return message
  }

  inbox(query: PaneBusInboxQuery): PaneBusMessage[] {
    const now = this.now()
    this.pruneExpired(now)
    const limit = Math.max(1, Math.min(Math.trunc(query.limit ?? 50), 100))
    const conditions = ['to_pane_id = ?', 'expires_at > ?']
    const params: unknown[] = [query.toPaneId, now]
    if (!query.includeAcked) conditions.push('acked_at IS NULL')
    if (query.topic) {
      conditions.push('topic = ?')
      params.push(query.topic)
    }
    if (query.correlationId) {
      conditions.push('correlation_id = ?')
      params.push(query.correlationId)
    }
    params.push(limit)
    const rows = this.db.prepare(`
      SELECT * FROM pane_bus_messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at ASC
      LIMIT ?
    `).all(...params) as MessageRow[]
    return rows.map(rowToMessage)
  }

  ack(toPaneId: string, messageId: string): { acknowledged: boolean; messageId: string; ackedAt: number | null } {
    const now = this.now()
    const row = this.db.prepare('SELECT acked_at FROM pane_bus_messages WHERE id = ? AND to_pane_id = ?').get(messageId, toPaneId) as { acked_at: number | null } | undefined
    if (!row) return { acknowledged: false, messageId, ackedAt: null }
    const ackedAt = row.acked_at ?? now
    if (row.acked_at === null) {
      this.db.prepare('UPDATE pane_bus_messages SET acked_at = ? WHERE id = ? AND to_pane_id = ?').run(ackedAt, messageId, toPaneId)
    }
    return { acknowledged: true, messageId, ackedAt }
  }

  hasInboundCorrelation(paneId: string, correlationId: string): boolean {
    const now = this.now()
    const row = this.db.prepare(
      'SELECT 1 AS found FROM pane_bus_messages WHERE to_pane_id = ? AND correlation_id = ? AND expires_at > ? LIMIT 1'
    ).get(paneId, correlationId, now) as { found: number } | undefined
    return Boolean(row)
  }

  waitForReply(query: PaneBusWaitQuery): Promise<{ timedOut: boolean; message: PaneBusMessage | null }> {
    const existing = this.inbox({
      toPaneId: query.toPaneId,
      topic: query.topic,
      correlationId: query.correlationId,
      includeAcked: false,
      limit: 50
    }).find((msg) => !query.replyToId || msg.replyToId === query.replyToId)
    if (existing) return Promise.resolve({ timedOut: false, message: existing })

    const timeoutMs = Math.max(100, Math.min(Math.trunc(query.timeoutMs ?? 30_000), MAX_BUS_WAIT_MS))
    return new Promise((resolve) => {
      const waiter: Waiter = {
        query,
        resolve: (result) => {
          this.waiters.delete(waiter)
          clearTimeout(waiter.timer)
          resolve(result)
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          resolve({ timedOut: true, message: null })
        }, timeoutMs)
      }
      waiter.timer.unref?.()
      this.waiters.add(waiter)
    })
  }

  setOwner(paneId: string, ownerActorKey: string, workspaceId: string, ownerPaneId: string | null = null): void {
    this.db.prepare(`
      INSERT INTO pane_agent_owners (pane_id, owner_actor_key, owner_pane_id, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pane_id) DO UPDATE SET
        owner_actor_key = excluded.owner_actor_key,
        owner_pane_id = excluded.owner_pane_id,
        workspace_id = excluded.workspace_id,
        created_at = excluded.created_at
    `).run(paneId, ownerActorKey, ownerPaneId, workspaceId, this.now())
  }

  getOwner(paneId: string): PaneOwnerRecord | null {
    const row = this.db.prepare(
      'SELECT pane_id, owner_actor_key, owner_pane_id, workspace_id, created_at FROM pane_agent_owners WHERE pane_id = ?'
    ).get(paneId) as { pane_id: string; owner_actor_key: string; owner_pane_id: string | null; workspace_id: string; created_at: number } | undefined
    if (!row) return null
    return {
      paneId: row.pane_id,
      ownerActorKey: row.owner_actor_key,
      ownerPaneId: row.owner_pane_id,
      workspaceId: row.workspace_id,
      createdAt: row.created_at
    }
  }

  deleteOwner(paneId: string): void {
    this.db.prepare('DELETE FROM pane_agent_owners WHERE pane_id = ?').run(paneId)
  }

  pruneExpired(now = this.now()): number {
    return this.db.prepare('DELETE FROM pane_bus_messages WHERE expires_at <= ?').run(now).changes
  }

  private checkRateLimit(actor: string, now: number): void {
    const cutoff = now - RATE_WINDOW_MS
    const bucket = (this.rateBuckets.get(actor) ?? []).filter((ts) => ts > cutoff)
    if (bucket.length >= BUS_RATE_LIMIT_PER_MIN) {
      this.rateBuckets.set(actor, bucket)
      throw new PaneBusError(`Pane-bus rate limit exceeded (${BUS_RATE_LIMIT_PER_MIN} messages per minute).`, 'rate-limit')
    }
    bucket.push(now)
    this.rateBuckets.set(actor, bucket)
  }

  private notifyWaiters(message: PaneBusMessage): void {
    for (const waiter of [...this.waiters]) {
      const { query } = waiter
      if (query.toPaneId !== message.toPaneId) continue
      if (query.topic && query.topic !== message.topic) continue
      if (query.correlationId && query.correlationId !== message.correlationId) continue
      if (query.replyToId && query.replyToId !== message.replyToId) continue
      waiter.resolve({ timedOut: false, message })
    }
  }
}
