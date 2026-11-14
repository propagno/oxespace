import type { Schedule } from '../../../../shared/schedule'
import type { ThreadOrchestrator } from '../conversation/thread-orchestrator'
import type { SchedulerDeps } from './scheduler'

export interface ScheduleThreadHost {
  /** The conversation service, as the window's own "New conversation" reaches it. */
  service: () => Promise<Pick<ThreadOrchestrator, 'create' | 'command' | 'configure' | 'send' | 'read'>>
  /** The project and folder as OxeChat knows them; throws for a project that is gone or a folder that is not its. */
  context: (projectId: string, rootPath: string) => { projectId: string; rootPath: string }
}

/**
 * A schedule's run, through the same calls the window makes for "New conversation": create, name, configure, send.
 * So the project's policy, the agent's account and the approvals are the ones any conversation has. The access is the
 * schedule's own (never full access) and the approval policy is left at the conversation's default: a run asks, and
 * waits, like a person's conversation does.
 */
export function scheduleThreadRunner(host: ScheduleThreadHost): Pick<SchedulerDeps, 'start' | 'busy' | 'knownProject'> {
  return {
    start: async (schedule: Schedule) => {
      const context = host.context(schedule.projectId, schedule.rootPath)
      const service = await host.service()
      const created = service.create({ workspaceId: `thread:${context.projectId}`, projectId: context.projectId, rootPath: context.rootPath, provider: schedule.provider })
      const threadId = created.thread.id
      // Named before the request is sent: the first message would otherwise name it.
      await service.command(threadId, `/rename ${schedule.name}`)
      await service.configure(threadId, { access: schedule.access, ...(schedule.model ? { model: schedule.model } : {}) }, service.read(threadId).thread.configurationRevision ?? 0)
      await service.send(threadId, schedule.prompt)
      return { threadId }
    },
    busy: async threadId => {
      try {
        const { thread } = (await host.service()).read(threadId)
        return thread.status === 'running' || thread.status === 'approval'
      } catch {
        // A conversation that was deleted is not at work.
        return false
      }
    },
    knownProject: (projectId, rootPath) => {
      try { host.context(projectId, rootPath); return true } catch { return false }
    }
  }
}
