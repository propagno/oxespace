import type { AppDatabase } from '../../db'
import type { AgentConversationAdapter, ConversationThread, ThreadSnapshot } from '../../../../shared/types/thread'
import { THREAD_IDLE_SUSPEND_CHOICES, THREAD_IDLE_SUSPEND_DEFAULT_MINUTES } from '../../../../shared/threadLimits'
import type { ThreadHistoryWriteOptions } from './thread-history'
import { recordRuntime } from '../runtime-diagnostics'
import { threadCapabilityManifest } from './thread-capabilities'

/** Minutes without activity before an idle conversation's agent process is closed; 0 keeps it open. */
export function idleSuspendMinutes(db: AppDatabase): number {
  try {
    const row = db.prepare("SELECT value FROM thread_settings WHERE key = 'idle_suspend_minutes'").get() as { value: string } | undefined
    const minutes = row ? Number(row.value) : THREAD_IDLE_SUSPEND_DEFAULT_MINUTES
    return THREAD_IDLE_SUSPEND_CHOICES.includes(minutes) ? minutes : THREAD_IDLE_SUSPEND_DEFAULT_MINUTES
  } catch { return 0 }
}

export function setIdleSuspendMinutes(db: AppDatabase, minutes: number): number {
  if (!THREAD_IDLE_SUSPEND_CHOICES.includes(minutes)) throw Error(`Choose one of ${THREAD_IDLE_SUSPEND_CHOICES.join(', ')} minutes`)
  db.prepare("INSERT INTO thread_settings (key, value, updated_at) VALUES ('idle_suspend_minutes', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(String(minutes), Date.now())
  return minutes
}

/** What idle suspension needs from the orchestrator, and nothing more. */
export interface IdleHost {
  db: AppDatabase
  isStopping(): boolean
  adapters(): Array<[string, AgentConversationAdapter]>
  hasAdapter(id: string): boolean
  lastActivity(id: string): number | undefined
  touch(id: string, at: number): void
  /** Removes the adapter and its activity record, so a new message opens a new process. */
  detach(id: string): void
  /** Lets a message sent during the close wait for it; cleared once the close ends. */
  trackClosing(id: string, closing: Promise<void>): void
  untrackClosing(id: string, closing: Promise<void>): void
  /** A turn, its finish, a reconfiguration, a provider observation or a session-only grant holds the process. */
  isHeld(id: string): boolean
  openRequests(id: string, generation: number): number
  closeSession(id: string, at: number): NonNullable<ConversationThread['connection']>
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void
}

function canSuspend(host: IdleHost, id: string): boolean {
  if (host.isHeld(id)) return false
  let snapshot: ThreadSnapshot
  try { snapshot = host.read(id) } catch { return false }
  const thread = snapshot.thread
  if (thread.status === 'running' || thread.status === 'approval' || thread.cliActive || thread.queue?.length) return false
  if (host.openRequests(id, thread.generation ?? 1)) return false
  return !snapshot.events.some(event => event.type === 'subagent' && event.state === 'running')
}

/**
 * Closes the agent process (and the MCP servers it started) of conversations idle longer than the setting.
 * Nothing is lost: the next message resumes the provider session. A conversation with a running turn, a
 * pending question, queued input, a background task or session-only grants keeps its process.
 */
export async function suspendIdle(host: IdleHost, now = Date.now()): Promise<string[]> {
  const minutes = idleSuspendMinutes(host.db)
  if (!minutes || host.isStopping()) return []
  const suspended: string[] = []
  for (const [id, adapter] of host.adapters()) {
    const since = host.lastActivity(id)
    if (since === undefined) { host.touch(id, now); continue }
    if (now - since < minutes * 60_000 || !canSuspend(host, id)) continue
    host.detach(id)
    const closing = adapter.dispose().catch(() => {})
    host.trackClosing(id, closing)
    try { await closing } finally { host.untrackClosing(id, closing) }
    // A message sent while the process was closing already started a new session.
    if (host.hasAdapter(id)) continue
    try {
      const snapshot = host.read(id)
      snapshot.thread.connection = { ...host.closeSession(id, now), suspendedAt: now }
      snapshot.thread.capabilities = threadCapabilityManifest(snapshot.thread.provider, adapter.capabilities, false, adapter.evidence, snapshot.thread)
      host.save(snapshot, { eventsFrom: snapshot.events.length })
    } catch { /* Deleted while closing. */ }
    recordRuntime('thread-suspend', { thread: id })
    suspended.push(id)
  }
  return suspended
}
