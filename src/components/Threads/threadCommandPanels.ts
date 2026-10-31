import type { ConversationThread, ThreadCommandResult } from '../../../shared/types/thread'
import type { DelegationTask } from '../../../shared/types/delegation'
import type { SessionSummary } from '../../../shared/types/session'
import { i18n } from '../../i18n'

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
    if (cursor) notice = i18n.t('thread:resumeData.firstThousand')
  } catch { notice = i18n.t('thread:resumeData.delegatedFailed') }
  try {
    if (!window.oxe.session?.list) throw Error('Session discovery is unavailable')
    const sessions = await window.oxe.session.list({ workspaceId: thread.workspaceId, workspaceRootPath: thread.rootPath, provider: thread.provider })
    nativeSessions = sessions.filter(session => session.provider === thread.provider && NATIVE_SESSION_ID.test(session.sessionId))
  } catch { nativeNotice = i18n.t('thread:resumeData.nativeFailed') }
  return { tasks, notice, nativeSessions, nativeNotice }
}

/** /delegations lists the project's delegated work; `/delegations <id>` shows one task. */
export async function loadDelegationPanel(thread: ConversationThread, result: ThreadCommandResult): Promise<ThreadPanelState> {
  const t = i18n.t.bind(i18n)
  if (result.text) {
    let cursor: string | undefined
    let found: DelegationTask | undefined
    do {
      const page = await window.oxe.delegation.status(thread.workspaceId, cursor, 100)
      found = page.tasks.find(task => task.id === result.text)
      cursor = page.nextCursor ?? undefined
    } while (!found && cursor)
    if (!found) throw Error(t('thread:delegations.notFound', { id: result.text }))
    return { kind: 'panel', title: found.objective, rows: [
      { label: t('thread:delegations.taskId'), detail: found.id }, { label: t('thread:delegations.state'), detail: found.state },
      { label: t('thread:delegations.branch'), detail: found.branch }, { label: t('thread:delegations.worktree'), detail: found.path },
      { label: t('thread:delegations.baseCommit'), detail: found.baseSha }, { label: t('thread:delegations.provider'), detail: found.nativeSession?.provider ?? found.agentProfileId },
      { label: t('thread:delegations.nativeSession'), detail: found.nativeSession?.nativeSessionId ?? t('thread:delegations.notObserved') },
      { label: t('thread:delegations.handoffRevision'), detail: String(found.knowledgeBundle?.revision ?? 1) }
    ], text: found.context ?? found.handoff }
  }
  const status = await window.oxe.delegation.status(thread.workspaceId, undefined, 100)
  return { ...result, title: t('thread:delegations.title'), rows: status.tasks.map(task => ({
    label: task.objective, detail: [`${task.branch} · ${task.state}`, t('thread:delegations.task', { id: task.id }), task.path,
      ...(task.nativeSession ? [t('thread:delegations.session', { provider: task.nativeSession.provider, session: task.nativeSession.nativeSessionId, generation: task.nativeSession.generation })] : [])].join('\n'),
    ...(task.destinationThreadId ? { id: task.destinationThreadId } : {})
  })) }
}
