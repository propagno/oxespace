import { homedir } from 'node:os'
import type { AppDatabase } from '../../db'
import type { BackgroundJobStatus } from '../../../../shared/types/background'
import type { AgentLifecycleState } from '../../../../shared/types/agent-state'
import type {
  ConversationThread, ThreadDelta, ThreadHistoryPage, ThreadPendingRefusal, ThreadRequest, ThreadRequestResponse, ThreadSnapshot, ThreadSyncCursor
} from '../../../../shared/types/thread'

/**
 * What the gateway may read from and do on the desktop (B9 · M4–M5), and nothing more. The gateway is given this
 * object; it never imports the services behind it, so it cannot reach MCP, executions or accounts. Every value here is
 * raw desktop data: the topics and commands filter it before anything is sent.
 */

export interface RemotePaneRow {
  id: string
  type: string
  displayName: string | null
  agentName: string | null
  shellName: string | null
  agent?: string
  agentState?: AgentLifecycleState
}
export interface RemoteWorkspaceRow { id: string; name: string; rootPath: string; active: boolean; panes: RemotePaneRow[] }
export interface RemoteJobRow { id: string; workspaceId: string; label: string; status: BackgroundJobStatus; exitCode: number | null; startedAt: number; finishedAt: number | null }
export interface RemoteDelegationRow { id: string; workspaceId: string; objective: string; state: string; error?: string; branch?: string; destinationThreadId?: string; updatedAt: number }
export interface RemotePendingRow { thread: ConversationThread; request: ThreadRequest }
export interface RemoteTerminalRead { session: string; seq: number; data: string; truncated: boolean }
export type RemoteRespondOutcome = { ok: true; resolution: string } | { ok: false; refusal: ThreadPendingRefusal }

export interface RemoteDesktop {
  /** Directories whose absolute paths become `.` or `…` in what is sent: project roots and the home directory. */
  roots(): string[]
  workspaces(): RemoteWorkspaceRow[]
  threads(): ConversationThread[]
  pendingRequests(): RemotePendingRow[]
  readThread(id: string): ConversationThread
  threadWindow(id: string): ThreadSnapshot
  threadSince(id: string, cursor: ThreadSyncCursor): ThreadDelta
  threadPage(id: string, before: number, limit: number): Promise<ThreadHistoryPage>
  /** `'*'` hears every conversation. */
  onThreadChanged(id: string, listener: () => void): () => void
  send(id: string, text: string): Promise<void>
  steer(id: string, text: string): Promise<void>
  interrupt(id: string): Promise<void>
  respond(id: string, requestId: string, generation: number, response: ThreadRequestResponse): Promise<RemoteRespondOutcome>
  terminal(paneId: string, seq: number): RemoteTerminalRead | null
  onTerminalOutput(listener: (paneId: string) => void): () => void
  writeTerminal(paneId: string, data: string): Promise<boolean>
  jobs(): RemoteJobRow[]
  delegations(): RemoteDelegationRow[]
}

// ---- The production adapter --------------------------------------------------------------------------------------

/** The conversation service, as far as the gateway uses it (the app's `ThreadManager` has this shape). */
export interface RemoteThreadHost {
  list(): ConversationThread[]
  readThread(id: string): ConversationThread
  readForRenderer(id: string): ThreadSnapshot
  readSinceForRenderer(id: string, cursor: ThreadSyncCursor): ThreadDelta
  historyPage(id: string, before?: number, limit?: number): Promise<ThreadHistoryPage>
  subscribe(id: string, listener: (id: string) => void): () => void
  send(id: string, text: string, attachmentIds?: string[]): Promise<void>
  steer(id: string, text: string, attachmentIds?: string[]): Promise<void>
  interrupt(id: string): Promise<void>
  respond(id: string, requestId: string, response: ThreadRequestResponse, listedGeneration?: number): Promise<unknown>
}
export interface RemoteTerminalHost {
  readSince(paneId: string, seq: number): RemoteTerminalRead | null
  onOutput(listener: (paneId: string) => void): () => void
  hasSession(paneId: string): boolean
  write(input: { paneId: string; data: string }): Promise<void>
}
export interface RemoteAgentStateHost { list(): Array<{ paneId: string; agent: string; state: AgentLifecycleState }> }

export interface RemoteDesktopHosts { db: AppDatabase; threads: RemoteThreadHost; terminals: RemoteTerminalHost; agentState: RemoteAgentStateHost }

const LIST_LIMIT = 200

/**
 * The refusal of an answer, from the registry's typed error (B1.1, PR #166) when it is there, else from the messages
 * the orchestrator throws today. Anything else is not a refusal and rejects.
 */
export function refusalOf(error: unknown): ThreadPendingRefusal | undefined {
  const typed = (error as { refusal?: unknown } | null)?.refusal
  if (typed === 'notPending' || typed === 'staleGeneration' || typed === 'alreadyResponding' || typed === 'unanswered') return typed
  const message = error instanceof Error ? error.message : ''
  if (/no longer pending|has no live execution/i.test(message)) return 'notPending'
  if (/older conversation generation/i.test(message)) return 'staleGeneration'
  if (/already being sent/i.test(message)) return 'alreadyResponding'
  if (/answer every question/i.test(message)) return 'unanswered'
  return undefined
}

export function createRemoteDesktop(hosts: RemoteDesktopHosts): RemoteDesktop {
  const { db, threads, terminals, agentState } = hosts
  const home = homedir()
  return {
    roots() {
      const rows = db.prepare(`SELECT root_path AS root FROM workspaces UNION SELECT root_path FROM thread_project_contexts
        UNION SELECT json_extract(data_json, '$.rootPath') FROM conversation_threads`).all() as Array<{ root: string | null }>
      return [...rows.map(row => row.root).filter((root): root is string => typeof root === 'string' && root.length > 0), home]
    },
    workspaces() {
      const states = new Map(agentState.list().map(state => [state.paneId, state]))
      const panes = db.prepare(`SELECT p.id, p.workspace_id, p.type, p.display_name, p.agent_name, s.name AS shell_name FROM panes p
        LEFT JOIN workspaces w ON w.id = p.workspace_id LEFT JOIN shell_profiles s ON s.id = COALESCE(p.shell_profile_id, w.default_shell_profile_id)
        ORDER BY p.workspace_id, p.row_index, p.column_index`).all() as Array<{ id: string; workspace_id: string; type: string; display_name: string | null; agent_name: string | null; shell_name: string | null }>
      return (db.prepare('SELECT id, name, root_path, is_active FROM workspaces ORDER BY created_at, id LIMIT ?').all(LIST_LIMIT) as Array<{ id: string; name: string; root_path: string; is_active: number }>)
        .map(row => ({
          id: row.id, name: row.name, rootPath: row.root_path, active: row.is_active === 1,
          panes: panes.filter(pane => pane.workspace_id === row.id).map(pane => {
            const state = states.get(pane.id)
            return { id: pane.id, type: pane.type, displayName: pane.display_name, agentName: pane.agent_name, shellName: pane.shell_name, ...(state ? { agent: state.agent, agentState: state.state } : {}) }
          })
        }))
    },
    threads: () => threads.list(),
    pendingRequests() {
      const rows = db.prepare(`SELECT t.data_json AS thread_json, e.data_json AS event_json
        FROM conversation_threads t CROSS JOIN conversation_events e ON e.thread_id = t.id
        WHERE json_extract(t.data_json, '$.status') = 'approval' AND json_extract(e.data_json, '$.type') = 'request' AND json_extract(e.data_json, '$.request.state') = 'pending'
        ORDER BY e.thread_id, e.seq LIMIT ?`).all(LIST_LIMIT) as Array<{ thread_json: string; event_json: string }>
      return rows.map(row => ({ thread: JSON.parse(row.thread_json) as ConversationThread, request: (JSON.parse(row.event_json) as { request: ThreadRequest }).request }))
    },
    readThread: id => threads.readThread(id),
    threadWindow: id => threads.readForRenderer(id),
    threadSince: (id, cursor) => threads.readSinceForRenderer(id, cursor),
    threadPage: (id, before, limit) => threads.historyPage(id, before, limit),
    onThreadChanged: (id, listener) => threads.subscribe(id, () => listener()),
    send: (id, text) => threads.send(id, text),
    steer: (id, text) => threads.steer(id, text),
    interrupt: id => threads.interrupt(id),
    async respond(id, requestId, generation, response) {
      // The generation is checked here too, so an answer for an older one is refused even before B1.1 lands.
      if ((threads.readThread(id).generation ?? 1) !== generation) return { ok: false, refusal: 'staleGeneration' }
      try {
        await threads.respond(id, requestId, response, generation)
        return { ok: true, resolution: resolutionOf(response) }
      } catch (error) {
        const refusal = refusalOf(error)
        if (!refusal) throw error
        return { ok: false, refusal }
      }
    },
    terminal: (paneId, seq) => terminals.readSince(paneId, seq),
    onTerminalOutput: listener => terminals.onOutput(listener),
    async writeTerminal(paneId, data) {
      if (!terminals.hasSession(paneId)) return false
      await terminals.write({ paneId, data })
      return true
    },
    jobs() {
      return (db.prepare('SELECT id, workspace_id, label, status, exit_code, started_at, finished_at FROM background_jobs ORDER BY started_at DESC LIMIT ?').all(LIST_LIMIT) as
        Array<{ id: string; workspace_id: string; label: string; status: BackgroundJobStatus; exit_code: number | null; started_at: number; finished_at: number | null }>)
        .map(row => ({ id: row.id, workspaceId: row.workspace_id, label: row.label, status: row.status, exitCode: row.exit_code, startedAt: row.started_at, finishedAt: row.finished_at }))
    },
    delegations() {
      return (db.prepare(`SELECT i.task_id, i.workspace_id, i.objective, i.state, i.branch, i.updated_at,
        json_extract(d.payload, '$.error') AS error, json_extract(d.payload, '$.destinationThreadId') AS thread_id
        FROM delegation_task_index i JOIN delegations d ON d.id = i.task_id ORDER BY i.updated_at DESC LIMIT ?`).all(LIST_LIMIT) as
        Array<{ task_id: string; workspace_id: string; objective: string; state: string; branch: string; updated_at: number; error: string | null; thread_id: string | null }>)
        .map(row => ({ id: row.task_id, workspaceId: row.workspace_id, objective: row.objective, state: row.state, updatedAt: row.updated_at,
          ...(row.branch ? { branch: row.branch } : {}), ...(row.error ? { error: row.error } : {}), ...(row.thread_id ? { destinationThreadId: row.thread_id } : {}) }))
    }
  }
}

/** What the phone is told happened, in the words of `ThreadRequestResolution`. */
export function resolutionOf(response: ThreadRequestResponse): string {
  if (response.decision === 'decline') return 'declined'
  if (response.decision === 'cancel') return 'cancelled-by-user'
  if (response.decision === 'accept') return 'approved'
  return 'answered'
}
