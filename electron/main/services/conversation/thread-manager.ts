import { ThreadOrchestrator } from './thread-orchestrator'
import { coordinatorIds, hasCoordinatorRow, isThreadCoordinator, revokeThreadTools, withCoordinator } from './thread-coordinator'
import { ProjectCoordinatorService, reconcileProjectCoordinators } from './project-coordinators'
import { suspendConversation } from './thread-idle'
import { threadToolRoles, toolSearchEnvironment } from './thread-mcp'
import { projectToolModes, sessionToolPlan, usesToolSearch } from './tool-groups'
import { loadRepoConfig } from '../repo-config/loader'
import { projectIdentity } from '../memory/memory-project.service'
import type { ConversationThread, ProjectCoordinatorOptions, ProjectCoordinatorOutcome, ThreadCommandResult, ThreadDelta, ThreadSnapshot, ThreadSyncCursor } from '../../../../shared/types/thread'

/**
 * Stable public boundary for Thread IPC/runtime consumers. Runtime coordination
 * lives in ThreadOrchestrator; persistence, requests, sessions, exports,
 * portable packages and checkpoints are separate services behind it.
 *
 * The coordinator flag (B1.4) lives in its own table, so the threads served to
 * the window carry it as the authority check grants it; it is never stored in a thread's data.
 */
export class ThreadManager extends ThreadOrchestrator {
  /** How a project root becomes its identity; tests stand in for Git here. */
  coordinatorIdentity: (root: string) => Promise<string> = projectIdentity

  override list(): ConversationThread[] {
    const ids = coordinatorIds(this.db)
    return super.list().map(thread => withCoordinator(thread, ids))
  }

  override readForRenderer(id: string): ThreadSnapshot {
    const window = super.readForRenderer(id)
    return { ...window, thread: withCoordinator(window.thread, coordinatorIds(this.db)) }
  }

  override readSinceForRenderer(id: string, cursor: ThreadSyncCursor): ThreadDelta {
    const delta = super.readSinceForRenderer(id, cursor)
    return delta.ok ? { ...delta, thread: withCoordinator(delta.thread, coordinatorIds(this.db)) } : delta
  }

  /** `/archive` is the one way a conversation is archived; an archived coordinator stops being one, and un-archiving does not restore it. */
  override async command(id: string, text: string): Promise<ThreadCommandResult> {
    const was = isThreadCoordinator(this.db, id)
    const result = await super.command(id, text)
    if (hasCoordinatorRow(this.db, id) && this.readThread(id)?.archived) {
      this.db.prepare('DELETE FROM project_coordinators WHERE thread_id = ?').run(id)
      if (was) await this.coordinatorsChanged([id])
    }
    return result
  }

  /**
   * The person's choice only (`thread:set-coordinator`); never an MCP tool. Another conversation of the project
   * identity stops being it, and the Team follows (ProjectCoordinatorService). A preview changes nothing.
   */
  async setCoordinator(id: string, coordinator: boolean, options: ProjectCoordinatorOptions = {}): Promise<ProjectCoordinatorOutcome> {
    const outcome = await new ProjectCoordinatorService(this.db, this.coordinatorIdentity).setForThread(id, coordinator, options)
    if (!options.preview) await this.coordinatorsChanged(outcome.changed)
    return outcome
  }

  /** The boot pass: drops drifted rows and backfills them from the Team's coordinator links. */
  async reconcileCoordinators(): Promise<void> {
    await this.coordinatorsChanged(await reconcileProjectCoordinators(this.db, this.coordinatorIdentity))
  }

  /**
   * What a coordinator change does to running sessions, wherever it was made (here, the Team, a project relink, the
   * boot pass). A session keeps the tool list it started with, so each conversation whose role changed has its
   * process closed when nothing holds it (the next message resumes the session with the right tools); the tools a
   * demoted coordinator loses are refused by the server meanwhile.
   */
  async coordinatorsChanged(ids: readonly string[]): Promise<void> {
    const now = coordinatorIds(this.db)
    for (const threadId of new Set(ids)) {
      let thread: ConversationThread | undefined
      try { thread = this.readThread(threadId) } catch { continue } // deleted meanwhile
      if (thread && !now.has(threadId)) revokeThreadTools(threadId, await this.lostCoordinatorTools(thread))
      await suspendConversation(this.idleHost(), threadId)
      this.changed(threadId)
    }
  }

  /** The tools the role gave this session that it would not have without it, as the runtime plans a session. */
  private async lostCoordinatorTools(thread: ConversationThread): Promise<string[]> {
    const modes = projectToolModes((await loadRepoConfig(thread.rootPath).catch(() => null))?.thread)
    const search = usesToolSearch(thread.provider, { ...process.env, ...toolSearchEnvironment(thread.provider) })
    const roles = threadToolRoles(this.db, thread.id)
    const as = sessionToolPlan(search, { ...roles, coordinator: true }, modes)
    const plain = sessionToolPlan(search, { ...roles, coordinator: false }, modes)
    const kept = new Set([...plain.tools, ...Object.values(plain.enableable).flat()])
    return as.tools.filter(tool => !kept.has(tool))
  }
}
