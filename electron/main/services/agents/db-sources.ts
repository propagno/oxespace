/**
 * S7.1 · The read model's sources, read from where each already lives: conversations and their pending requests and
 * Agent Work runs from the app database, delegations through their repository, pane states from the agent-state
 * service, B10 approvals from the approval center. Each read is one item (or one query at the first read).
 */
import type { AppDatabase } from '../../db'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { ApprovalRequest } from '../../../../shared/types/approvals'
import type { ConversationThread, ThreadEvent, ThreadRequest } from '../../../../shared/types/thread'
import type { WorkRunStatus } from '../../../../shared/types/work'
import type { Workspace } from '../../../../shared/types/workspace'
import { DelegationRepository } from '../delegation/delegation.repository'
import type { ConversationFacts, WorkFacts } from './agent-rows'
import type { AgentSources } from './read-model'

const PENDING = "json_extract(data_json, '$.type') = 'request' AND json_extract(data_json, '$.request.state') = 'pending'"

export interface DbSourceDeps {
  db: AppDatabase
  panes: { list(): PaneAgentState[]; get(paneId: string): PaneAgentState | null }
  approvals: { list(): ApprovalRequest[] }
  workspaces(): Workspace[]
  profiles(): Array<{ agentProfileId: string; provider: string; parentProvider?: string | null }>
}

export function dbAgentSources(deps: DbSourceDeps): AgentSources {
  const { db } = deps
  const delegations = new DelegationRepository(db)
  const requestsOf = (threadId: string): ThreadRequest[] =>
    (db.prepare(`SELECT data_json FROM conversation_events WHERE thread_id = ? AND ${PENDING} ORDER BY seq LIMIT 100`).all(threadId) as { data_json: string }[])
      .map(row => (JSON.parse(row.data_json) as Extract<ThreadEvent, { type: 'request' }>).request)
  // The latest turn's completion, for a conversation that settled after a completed turn (restart `since`).
  const completedAtOf = (threadId: string): number | undefined => {
    const row = db.prepare("SELECT max(json_extract(data_json, '$.completedAt')) AS at FROM conversation_turns WHERE thread_id = ?").get(threadId) as { at: number | null } | undefined
    return typeof row?.at === 'number' ? row.at : undefined
  }
  const conversation = (id: string, json: string, requests?: ThreadRequest[], withCompletion = false): ConversationFacts => {
    const thread = { ...(JSON.parse(json) as ConversationThread), id }
    const completedAt = withCompletion && thread.status === 'idle' && thread.lastTurnStatus === 'completed' ? completedAtOf(id) : undefined
    // As the conversation's own view: a request counts while the conversation waits on it (ThreadHistory does the same).
    return { thread, requests: thread.status === 'approval' ? requests ?? requestsOf(id) : [], ...(completedAt !== undefined ? { completedAt } : {}) }
  }
  type RunRow = { id: string; supervisor_thread_id: string; workspace_id: string; title: string; status: WorkRunStatus; updated_at: number }
  const runFacts = (run: RunRow, tasks: { status: string; thread_id: string | null }[]): WorkFacts => ({
    run: { id: run.id, supervisorThreadId: run.supervisor_thread_id, workspaceId: run.workspace_id, title: run.title, status: run.status, updatedAt: run.updated_at },
    tasks: tasks.map(task => ({ status: task.status, threadId: task.thread_id }))
  })
  const RUN = 'SELECT id, supervisor_thread_id, workspace_id, title, status, updated_at FROM work_runs'

  return {
    panes: deps.panes,
    conversations: {
      all: () => {
        const pending = new Map<string, ThreadRequest[]>()
        // Only the conversations waiting for the person have requests that count, so only their events are read.
        const waiting = `thread_id IN (SELECT id FROM conversation_threads WHERE json_extract(data_json, '$.status') = 'approval')`
        for (const row of db.prepare(`SELECT thread_id, data_json FROM conversation_events WHERE ${waiting} AND ${PENDING} ORDER BY thread_id, seq`).all() as { thread_id: string; data_json: string }[]) {
          pending.set(row.thread_id, [...(pending.get(row.thread_id) ?? []), (JSON.parse(row.data_json) as Extract<ThreadEvent, { type: 'request' }>).request])
        }
        return (db.prepare("SELECT id, data_json FROM conversation_threads WHERE coalesce(json_extract(data_json, '$.archived'), 0) = 0").all() as { id: string; data_json: string }[])
          .map(row => conversation(row.id, row.data_json, pending.get(row.id) ?? [], true))
      },
      get: id => {
        const row = db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(id) as { data_json: string } | undefined
        return row ? conversation(id, row.data_json) : null
      }
    },
    delegations: { all: () => delegations.all(), get: id => delegations.get(id) ?? null },
    work: {
      all: () => {
        const tasks = new Map<string, { status: string; thread_id: string | null }[]>()
        for (const task of db.prepare('SELECT run_id, status, thread_id FROM work_tasks ORDER BY position').all() as { run_id: string; status: string; thread_id: string | null }[]) {
          tasks.set(task.run_id, [...(tasks.get(task.run_id) ?? []), task])
        }
        return (db.prepare(RUN).all() as RunRow[]).map(run => runFacts(run, tasks.get(run.id) ?? []))
      },
      get: id => {
        const run = db.prepare(`${RUN} WHERE id = ?`).get(id) as RunRow | undefined
        return run ? runFacts(run, db.prepare('SELECT status, thread_id FROM work_tasks WHERE run_id = ? ORDER BY position').all(id) as { status: string; thread_id: string | null }[]) : null
      }
    },
    approvals: deps.approvals,
    workspaces: deps.workspaces,
    providerOf: id => {
      const profile = deps.profiles().find(item => item.agentProfileId === id)
      return profile ? (profile.parentProvider ?? profile.provider) : undefined
    }
  }
}
