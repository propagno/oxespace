import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { TEAM_COORDINATOR_ACTIONS, type TeamCoordinatorAction, type TeamRole, type TeamScope } from '../../../shared/types/team'
import { projectIdentity } from '../services/memory/memory-project.service'
import { TeamRepository } from '../services/coordination/team-repository'
import type { TeamAccess } from '../services/coordination/team-access'
import type { ExecutionOwner } from '../services/execution-registry'
import { coordinatorOptions } from '../services/conversation/coordinator-authority'

/** After a Team change moved the project's coordinator, the thread runtime revokes, suspends and notifies (B1.4 · S7.5). */
export interface TeamCoordinatorHooks { changed(ids: string[]): Promise<void> }

export function registerTeamIpc(db: AppDatabase, access?: TeamAccess, hooks?: TeamCoordinatorHooks): void {
  const repository = new TeamRepository(db)
  const resolve = async (event: IpcMainInvokeEvent, scope: TeamScope) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw Error('Team requires the application main frame')
    if (!scope || !['code', 'thread'].includes(scope.kind) || typeof scope.id !== 'string' || scope.id.length > 256) throw Error('Invalid team scope')
    const query = scope.kind === 'code' ? 'SELECT root_path AS root,name FROM workspaces WHERE id=?' : 'SELECT root_path AS root,display_name AS name FROM thread_projects WHERE id=?'
    const source = db.prepare(query).get(scope.id) as { root: string; name: string } | undefined
    if (!source) throw Error('Project is no longer available')
    const identity = await projectIdentity(source.root)
    const current = db.prepare(query).get(scope.id) as { root: string } | undefined
    if (current?.root !== source.root) throw Error('Project changed; reopen Team')
    return repository.ensure(identity, source.name)
  }
  ipcMain.handle(IPC_CHANNELS.team.messages, async (event, scope: TeamScope, memberId: string, before?: number) => {
    const team = await resolve(event, scope)
    return repository.activity(team.id, memberId, before)
  })
  ipcMain.handle(IPC_CHANNELS.team.send, async (event, scope: TeamScope, memberId: string, key: string, body: string) => {
    const team = await resolve(event, scope)
    return repository.send({ teamId: team.id, senderId: null, recipientId: memberId, key, body, kind: 'request' })
  })
  ipcMain.handle(IPC_CHANNELS.team.command, async (event, scope: TeamScope, action: string, revision: number, nameOrId: string, role: TeamRole, owner: ExecutionOwner, options: unknown) => {
    if (!['read', 'add', 'coordinator', 'archive', 'connect', 'disconnect', 'delivery-on', 'delivery-off'].includes(action)) throw Error('Invalid team action')
    const parsed = coordinatorOptions(options)
    const team = await resolve(event, scope)
    if ((TEAM_COORDINATOR_ACTIONS as readonly string[]).includes(action)) return coordinatorAction(team.id, action as TeamCoordinatorAction, revision, nameOrId, owner, parsed)
    if (action === 'delivery-on' || action === 'delivery-off') {
      if (!access) throw Error('Team delivery is unavailable')
      access.setDeliveryFromUi(team.id, revision, nameOrId, action === 'delivery-on')
      return access.snapshotFromUi(team.id)
    }
    if (action === 'connect' || action === 'disconnect') {
      if (!access) throw Error('Team session connections are unavailable')
      if (action === 'connect') await access.connectFromUi(team.id, revision, nameOrId, owner)
      else access.disconnectFromUi(team.id, revision, nameOrId)
      return access.snapshotFromUi(team.id)
    }
    if (action === 'add') repository.add(team.id, revision, nameOrId, role)
    return access ? access.snapshotFromUi(team.id) : repository.get(team.id)
  })
  /**
   * The four Team actions that move the project's coordinator conversation go through its one write path. A preview
   * returns what would change and writes nothing; otherwise the snapshot carries `coordinatorChange`, and the thread
   * runtime hears of each conversation whose flag changed, after the commit.
   */
  async function coordinatorAction(teamId: string, action: TeamCoordinatorAction, revision: number, memberId: string, owner: ExecutionOwner, options: ReturnType<typeof coordinatorOptions>) {
    const { ProjectCoordinatorService } = await import('../services/conversation/project-coordinators')
    const coordinators = new ProjectCoordinatorService(db, projectIdentity)
    const sessions = () => { if (!access) throw Error('Team session connections are unavailable'); return access }
    const change = action === 'coordinator' ? await coordinators.setMemberCoordinator(teamId, revision, memberId, options)
      : action === 'connect' ? await coordinators.connectMember(sessions(), teamId, revision, memberId, owner, options)
        : action === 'disconnect' ? coordinators.teamChange(teamId, () => sessions().disconnectFromUi(teamId, revision, memberId), () => {
          if (repository.get(teamId).revision !== revision) throw Error('Team changed; refresh before disconnecting')
          db.prepare('DELETE FROM agent_team_execution_links WHERE member_id=?').run(memberId)
        }, options)
          : coordinators.teamChange(teamId, () => repository.archive(teamId, revision, memberId), () => repository.archive(teamId, revision, memberId), options)
    if (options.preview) return change
    if (change.changed.length) await hooks?.changed(change.changed).catch(() => {})
    return { ...(access ? access.snapshotFromUi(teamId) : repository.get(teamId)), coordinatorChange: change }
  }
}
