import { randomUUID } from 'node:crypto'
import type { Schedule, ScheduleTokenUsage } from '../../../../shared/schedule'
import type { WorktreeProvisionReport } from '../../../../shared/types/repo-config'
import type { ThreadOrchestrator } from '../conversation/thread-orchestrator'
import { MainRefusal } from '../main-refusal'
import { provisionAutomationWorktree, type AutomationWorktreeHost } from './automation-worktree'
import type { SchedulerDeps, StartRunContext, StartRunResult } from './scheduler'

export interface ScheduleThreadService extends Pick<ThreadOrchestrator, 'create' | 'command' | 'configure' | 'send' | 'read'> {
  interrupt?: (id: string) => Promise<void>
  subscribe?: (id: string, listener: (id: string) => void) => () => void
  usageSummary?: (id: string) => Promise<{ totalInputTokens?: number; totalOutputTokens?: number; totalCostUsd?: number } | null>
}

export interface ScheduleThreadHost {
  /** The conversation service, as the window's own "New conversation" reaches it. */
  service: () => Promise<ScheduleThreadService>
  /** The project and folder as OxeChat knows them; throws for a project that is gone or a folder that is not its. */
  context: (projectId: string, rootPath: string) => { projectId: string; rootPath: string }
  /** Optional OXE-444 worktree host. When provided, `workspace-write` runs MANDATORILY execute in an isolated worktree. */
  worktrees?: AutomationWorktreeHost
  /** Whether to attach live completion observation via `service.subscribe` (true in production app). */
  observeLifecycle?: boolean
}

function extractAssistantSummary(snapshot: ReturnType<ScheduleThreadService['read']>): string | null {
  const events = (snapshot as { events?: Array<{ type?: string; role?: string; text?: string; content?: string }> }).events
  if (!Array.isArray(events)) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i]
    const text = typeof entry?.text === 'string' ? entry.text.trim() : typeof entry?.content === 'string' ? entry.content.trim() : ''
    if (text && (entry.type === 'assistant_message' || entry.type === 'message' || entry.role === 'assistant')) {
      return text.slice(0, 4000)
    }
  }
  return null
}

function observeThreadLifecycle(
  service: ScheduleThreadService,
  threadId: string,
  onWaitingApproval?: () => void
): Promise<{ status: 'completed' | 'failed'; summaryMd?: string | null; detail?: string | null; tokenUsage?: ScheduleTokenUsage | null }> {
  return new Promise((resolve) => {
    if (!service.subscribe) {
      resolve({ status: 'completed', summaryMd: null })
      return
    }
    let sawApproval = false
    let settled = false
    const finish = (result: { status: 'completed' | 'failed'; summaryMd?: string | null; detail?: string | null; tokenUsage?: ScheduleTokenUsage | null }) => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve(result)
    }
    const check = () => {
      try {
        const snapshot = service.read(threadId)
        const status = snapshot.thread.status
        if (status === 'approval') {
          if (!sawApproval) {
            sawApproval = true
            onWaitingApproval?.()
          }
          return
        }
        if (status === 'running') return
        const summaryMd = extractAssistantSummary(snapshot)
        if (status === 'failed' || status === 'interrupted') {
          finish({ status: 'failed', summaryMd, detail: `Conversation ended with status ${status}.` })
          return
        }
        finish({ status: 'completed', summaryMd })
      } catch (cause) {
        finish({ status: 'failed', detail: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    const unsubscribe = service.subscribe(threadId, () => check())
    check()
  })
}

/**
 * A schedule's run, through the same calls the window makes for "New conversation": create, name, configure, send.
 * When `host.worktrees` is configured, every `workspace-write` run MANDATORILY provisions an isolated worktree
 * (`automation/<slug>-<shortRunId>`) via OXE-444's `createWorktree` and NEVER mutates the main checkout.
 */
export function scheduleThreadRunner(
  host: ScheduleThreadHost
): Pick<SchedulerDeps, 'start' | 'busy' | 'knownProject' | 'interrupt' | 'worktrees'> {
  return {
    start: async (schedule: Schedule, runContext?: StartRunContext): Promise<StartRunResult> => {
      // Checked again at the run: a stored row is never the way to full access.
      if (schedule.access !== 'read-only' && schedule.access !== 'workspace-write') {
        throw new MainRefusal('thread.invalidInput', {})
      }
      const context = host.context(schedule.projectId, schedule.rootPath)
      const service = await host.service()

      let targetRoot = context.rootPath
      let worktreePath: string | null = null
      let branchName: string | null = null
      let baseSha: string | null = null
      let provisionReport: WorktreeProvisionReport | undefined

      if (schedule.access === 'workspace-write' && host.worktrees) {
        const provisioned = await provisionAutomationWorktree(
          host.worktrees,
          context.rootPath,
          schedule.name,
          runContext?.runId ?? randomUUID()
        )
        targetRoot = provisioned.worktreePath
        worktreePath = provisioned.worktreePath
        branchName = provisioned.branchName
        baseSha = provisioned.baseSha
        provisionReport = provisioned.report
      }

      const created = service.create({
        workspaceId: `thread:${context.projectId}`,
        projectId: context.projectId,
        rootPath: targetRoot,
        provider: schedule.provider
      })
      const threadId = created.thread.id
      // Named before the request is sent: the first message would otherwise name it.
      await service.command(threadId, `/rename ${schedule.name}`)
      await service.configure(
        threadId,
        { access: schedule.access, ...(schedule.model ? { model: schedule.model } : {}) },
        service.read(threadId).thread.configurationRevision ?? 0
      )
      await service.send(threadId, schedule.prompt)

      const waitForCompletion =
        host.observeLifecycle && service.subscribe
          ? observeThreadLifecycle(service, threadId, runContext?.onWaitingApproval)
          : undefined

      return {
        threadId,
        ...(worktreePath ? { worktreePath } : {}),
        ...(branchName ? { branchName } : {}),
        ...(baseSha ? { baseSha } : {}),
        ...(provisionReport ? { provisionReport } : {}),
        ...(waitForCompletion ? { waitForCompletion } : {})
      }
    },
    busy: async (threadId) => {
      try {
        const { thread } = (await host.service()).read(threadId)
        return thread.status === 'running' || thread.status === 'approval'
      } catch {
        // A conversation that was deleted is not at work.
        return false
      }
    },
    knownProject: (projectId, rootPath) => {
      try {
        host.context(projectId, rootPath)
        return true
      } catch {
        return false
      }
    },
    interrupt: async (threadId) => {
      const service = await host.service()
      await service.interrupt?.(threadId)
    },
    ...(host.worktrees ? { worktrees: host.worktrees } : {})
  }
}
