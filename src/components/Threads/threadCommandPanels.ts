import type { ConversationThread, ThreadCommandResult } from '../../../shared/types/thread'
import type { DelegationTask } from '../../../shared/types/delegation'
import type { SessionSummary } from '../../../shared/types/session'

/** What the "Resume work" dialog lists, loaded when /resume opens it. */
export interface ThreadResumeData {
  tasks: DelegationTask[]
  notice: string
  nativeSessions: SessionSummary[]
  nativeNotice: string
}

/** A command result shown in the conversation dialog, with resume data when it is the resume surface. */
export type ThreadPanelState = ThreadCommandResult & { resume?: ThreadResumeData }

const NATIVE_SESSION_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export async function loadResumeData(thread: ConversationThread): Promise<ThreadResumeData> {
  const tasks: DelegationTask[] = []
  let notice = '', nativeNotice = ''
  let nativeSessions: SessionSummary[] = []
  try {
    let cursor: string | undefined
    let inspected = 0
    do {
      const page = await window.oxe.delegation.status(thread.workspaceId, cursor, 100)
      inspected += page.tasks.length
      tasks.push(...page.tasks.filter(task => task.destinationThreadId || task.nativeSession))
      cursor = page.nextCursor ?? undefined
    } while (cursor && inspected < 1000)
    if (cursor) notice = 'Showing sessions from the first 1,000 tasks. Search the complete history in Delegated Work.'
  } catch { notice = 'Delegated sessions could not be loaded. Saved conversations are still available.' }
  try {
    if (!window.oxe.session?.list) throw Error('Session discovery is unavailable')
    const sessions = await window.oxe.session.list({ workspaceId: thread.workspaceId, workspaceRootPath: thread.rootPath, provider: thread.provider })
    nativeSessions = sessions.filter(session => session.provider === thread.provider && NATIVE_SESSION_ID.test(session.sessionId))
  } catch { nativeNotice = 'Could not list provider sessions. You can still enter an exact native session ID below.' }
  return { tasks, notice, nativeSessions, nativeNotice }
}

/** /delegations lists the project's delegated work; `/delegations <id>` shows one task. */
export async function loadDelegationPanel(thread: ConversationThread, result: ThreadCommandResult): Promise<ThreadPanelState> {
  if (result.text) {
    let cursor: string | undefined
    let found: DelegationTask | undefined
    do {
      const page = await window.oxe.delegation.status(thread.workspaceId, cursor, 100)
      found = page.tasks.find(task => task.id === result.text)
      cursor = page.nextCursor ?? undefined
    } while (!found && cursor)
    if (!found) throw Error(`Delegation ${result.text} was not found in this project.`)
    return { kind: 'panel', title: found.objective, rows: [
      { label: 'Task ID', detail: found.id }, { label: 'State', detail: found.state },
      { label: 'Branch', detail: found.branch }, { label: 'Worktree', detail: found.path },
      { label: 'Base commit', detail: found.baseSha }, { label: 'Provider', detail: found.nativeSession?.provider ?? found.agentProfileId },
      { label: 'Native session', detail: found.nativeSession?.nativeSessionId ?? 'Not yet observed' },
      { label: 'Handoff revision', detail: String(found.knowledgeBundle?.revision ?? 1) }
    ], text: found.context ?? found.handoff }
  }
  const status = await window.oxe.delegation.status(thread.workspaceId, undefined, 100)
  return { ...result, title: 'Delegated work', rows: status.tasks.map(task => ({
    label: task.objective, detail: `${task.branch} · ${task.state}\nTask ${task.id}\n${task.path}${task.nativeSession ? `\n${task.nativeSession.provider} session ${task.nativeSession.nativeSessionId} · generation ${task.nativeSession.generation}` : ''}`,
    ...(task.destinationThreadId ? { id: task.destinationThreadId } : {})
  })) }
}
