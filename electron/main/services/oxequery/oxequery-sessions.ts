import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { Client, ClientConfig } from 'pg'
import type { MongoClient } from 'mongodb'
import { mainMessage } from '../../../../shared/messages'
import { OxeQueryError, type ResolvedConnection, type SessionRole } from './oxequery-errors'
import type { Endpoint } from './connection-options'
import type { OpenTunnel } from './ssh-tunnel'
import type { OpenPage } from './oxequery-paging'
import type { MongoOperation } from './mongo-cancel'

/**
 * The worker's sessions, kept per connection AND role (B14). The person's and an agent's never share, reopen or close
 * each other, so an agent's read cannot roll back the person's transaction. A busy session is never closed: a caller
 * that would need it closed is refused with `conflict`. Each connection and role holds a bounded number of driver
 * connections, and an agent's idle session closes sooner than the person's.
 */

/** A session nobody used for this long is closed; it reopens on the next request. */
const IDLE_MS = 10 * 60_000
/** An agent's session is closed sooner: agents read in bursts, and an idle one only holds a server connection. */
export const AGENT_IDLE_MS = 2 * 60_000
const MAX_SESSIONS = 12
/**
 * Driver connections one connection may hold for one role: the session's client, the catalog client a "Load more"
 * page needs, and the short-lived one that cancels a statement. One more is refused with `limit`.
 */
export const MAX_CONNECTIONS_PER_SLOT = 3

/** open: a transaction the person began; failed: a statement in it failed, so only ROLLBACK is accepted. */
export type TxState = 'none' | 'open' | 'failed'
interface Slotted { key: string; slot: string; role: SessionRole; /** Gives back the session client's place under the cap. */ release: () => void; lastUsed: number; tunnel?: OpenTunnel }
export interface PgSession extends Slotted { releaseMeta?: () => void; client: Client; running: boolean; endpoint: Endpoint; tx: TxState; txStatements: number; txSince?: number; config: ClientConfig; page?: OpenPage; meta?: Client }
export interface MongoSession extends Slotted { client: MongoClient; /** The running find or aggregate, so it can be stopped. */ operation?: MongoOperation }

/**
 * Everything that changes how a session is built; a change reopens it (unless the session is busy). Read-only is not
 * part of it: it never changes how a session is built, since each read-only statement gets its own `BEGIN READ ONLY`
 * and Mongo checks it per call. It was part of it before B14, and the agent gateway forces read-only, so an agent's
 * read closed the person's session.
 */
export function sessionKey(connection: ResolvedConnection): string {
  return createHash('sha256').update(JSON.stringify([
    connection.engine, connection.host, connection.port, connection.database, connection.username, connection.password ?? '', connection.sslMode,
    connection.tls ?? null, connection.mongo ?? null, connection.ssh ?? null, connection.statementTimeoutMs ?? null
  ])).digest('hex')
}

/** The sessions of one connection for one role. */
export function slotOf(connection: Pick<ResolvedConnection, 'id' | 'role'>): string {
  return JSON.stringify([connection.id, connection.role ?? 'person'])
}

export class SessionRegistry {
  readonly pg = new Map<string, PgSession>()
  readonly mongo = new Map<string, MongoSession>()
  /** Sessions being opened, by slot: a second caller waits for the same one instead of opening (and leaking) another. */
  private readonly opening = new Map<string, Promise<unknown>>()
  /** Driver connections held per slot, against MAX_CONNECTIONS_PER_SLOT. */
  private readonly opened = new Map<string, number>()
  /** Worker requests running per slot (`track`): a slot with one running is busy. */
  private readonly inflight = new Map<string, number>()
  /** The slot of the request this code runs for, so a request does not count itself as someone else's work. */
  private readonly current = new AsyncLocalStorage<string>()

  /** Runs one worker request for a connection. While it runs, its slot is busy: no key change or reaper closes it. */
  async track<T>(connection: ResolvedConnection, run: () => Promise<T>): Promise<T> {
    const slot = slotOf(connection)
    this.inflight.set(slot, (this.inflight.get(slot) ?? 0) + 1)
    try { return await this.current.run(slot, run) } finally {
      const left = (this.inflight.get(slot) ?? 1) - 1
      if (left > 0) this.inflight.set(slot, left); else this.inflight.delete(slot)
    }
  }

  /** Requests running on a slot besides the caller's own. */
  private othersActive(slot: string): number {
    return (this.inflight.get(slot) ?? 0) - (this.current.getStore() === slot ? 1 : 0)
  }

  /** A transaction open or failed, a statement running, or another request on it: closing would lose work. */
  pgBusy(session: PgSession): boolean {
    return session.running || session.tx !== 'none' || this.othersActive(session.slot) > 0
  }

  /** A find or aggregate running, or another request (an import, an export, a bulk write) on it. */
  mongoBusy(session: MongoSession): boolean {
    return Boolean(session.operation) || this.othersActive(session.slot) > 0
  }

  /**
   * How many of the person's sessions would lose work if the worker stopped now. The worker reports it with every
   * answer, and the main process never restarts a worker while it is above zero.
   */
  personAtRisk(): number {
    const atRisk = new Set<string>()
    for (const session of this.pg.values()) if (session.role === 'person' && (session.running || session.tx !== 'none')) atRisk.add(session.slot)
    for (const [slot, running] of this.inflight) if (running > 0 && (JSON.parse(slot) as [string, SessionRole])[1] === 'person') atRisk.add(slot)
    return atRisk.size
  }

  busyRefusal(): OxeQueryError {
    return new OxeQueryError('conflict', 'This connection has a transaction open or a command running, so it cannot be reopened now. Commit or roll back the transaction, or wait for the command, then try again.',
      [], {}, mainMessage('oxequery.session.busy', {}))
  }

  /** Takes one of the slot's driver connections, or refuses with `limit`; the returned function gives it back (once). */
  reserve(slot: string): () => void {
    const used = this.opened.get(slot) ?? 0
    if (used >= MAX_CONNECTIONS_PER_SLOT) {
      throw new OxeQueryError('limit', `This connection already has ${MAX_CONNECTIONS_PER_SLOT} database connections open. Wait for one to finish, then try again.`,
        [], {}, mainMessage('oxequery.session.limit', { limit: MAX_CONNECTIONS_PER_SLOT }))
    }
    this.opened.set(slot, used + 1)
    let held = true
    return () => {
      if (!held) return
      held = false
      const left = (this.opened.get(slot) ?? 1) - 1
      if (left > 0) this.opened.set(slot, left); else this.opened.delete(slot)
    }
  }

  /** One open per slot at a time: a caller that finds one under way waits for it, then looks again. */
  async openOnce<T>(slot: string, look: () => Promise<T>, open: () => Promise<T>): Promise<T> {
    const pending = this.opening.get(slot)
    if (pending) { await pending.catch(() => undefined); return look() }
    const opening = open()
    this.opening.set(slot, opening)
    try { return await opening } finally { if (this.opening.get(slot) === opening) this.opening.delete(slot) }
  }

  /** The session leaves the map (if it is still the slot's) and gives its connections back to the cap. */
  forgetPg(session: PgSession): void {
    if (this.pg.get(session.slot) === session) this.pg.delete(session.slot)
    session.release(); session.releaseMeta?.()
  }

  forgetMongo(session: MongoSession): void {
    if (this.mongo.get(session.slot) === session) this.mongo.delete(session.slot)
    session.release()
  }

  /** The slots to close: idle past their role's limit, then the least recently used beyond MAX_SESSIONS. Never a busy one. */
  reapable(now: number): string[] {
    const idleMs = (role: SessionRole): number => role === 'agent' ? AGENT_IDLE_MS : IDLE_MS
    const sessions = [
      ...[...this.pg.values()].filter(session => !this.pgBusy(session)),
      ...[...this.mongo.values()].filter(session => !this.mongoBusy(session))
    ].map(session => ({ slot: session.slot, lastUsed: session.lastUsed, idleMs: idleMs(session.role) })).sort((a, b) => a.lastUsed - b.lastUsed)
    const total = this.slots().length
    const stale = sessions.filter(session => now - session.lastUsed > session.idleMs).map(session => session.slot)
    const surplus = total > MAX_SESSIONS ? sessions.filter(session => !stale.includes(session.slot)).slice(0, total - MAX_SESSIONS).map(session => session.slot) : []
    return [...new Set([...stale, ...surplus])]
  }

  slots(): string[] {
    return [...new Set([...this.pg.keys(), ...this.mongo.keys()])]
  }
}
