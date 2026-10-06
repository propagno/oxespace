import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { TeamRole, TeamScope } from '../../../shared/types/team'
import { projectIdentity } from '../services/memory/memory-project.service'
import { TeamRepository } from '../services/coordination/team-repository'
import type { TeamAccess } from '../services/coordination/team-access'
import type { ExecutionOwner } from '../services/execution-registry'

export function registerTeamIpc(db: AppDatabase, access?: TeamAccess): void {
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
  ipcMain.handle(IPC_CHANNELS.team.command, async (event, scope: TeamScope, action: string, revision: number, nameOrId: string, role: TeamRole, owner: ExecutionOwner) => {
    if (!['read', 'add', 'coordinator', 'archive', 'connect', 'disconnect', 'delivery-on', 'delivery-off'].includes(action)) throw Error('Invalid team action')
    const team = await resolve(event, scope)
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
    if (action === 'coordinator') repository.replaceCoordinator(team.id, revision, nameOrId)
    if (action === 'archive') repository.archive(team.id, revision, nameOrId)
    return access ? access.snapshotFromUi(team.id) : repository.get(team.id)
  })
}
