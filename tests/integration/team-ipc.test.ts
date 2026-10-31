import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { registerTeamIpc } from '../../electron/main/ipc/team.ipc'

const hooks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), identify: vi.fn(async () => '/same/git'), window: vi.fn(() => ({})) }))
vi.mock('electron', () => ({ app: { getPath: () => '', isReady: () => false, getLocale: () => 'en' }, BrowserWindow: { fromWebContents: hooks.window }, ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => hooks.handlers.set(name, handler) } }))
vi.mock('../../electron/main/services/memory/memory-project.service', () => ({ projectIdentity: hooks.identify }))
const databases: AppDatabase[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); hooks.handlers.clear(); hooks.identify.mockReset(); hooks.identify.mockResolvedValue('/same/git'); hooks.window.mockReset(); hooks.window.mockReturnValue({}) })
process.env.OXESPACE_LOCALE = 'en'
function fixture(changed?: (ids: string[]) => Promise<void>) {
  const db = openInMemoryDatabase(); databases.push(db)
  db.exec("INSERT INTO workspaces(id,name,root_path,layout,default_shell_profile_id) VALUES('ws','Repo','/repo','1x1','builtin-claude'); INSERT INTO thread_projects(id,identity,root_path,display_name,created_at,updated_at) VALUES('project','/same/git','/repo','Repo',1,1)")
  registerTeamIpc(db, undefined, changed && { changed })
  const frame = {}, event = { sender: { mainFrame: frame }, senderFrame: frame }
  return { db, event, command: hooks.handlers.get('team:command')! }
}
describe('team trusted UI boundary', () => {
  it('resolves Code and Thread into the same team without accepting a caller project identity', async () => {
    const f = fixture(), code = await f.command(f.event, { kind: 'code', id: 'ws' }, 'read')
    expect(await f.command(f.event, { kind: 'thread', id: 'project' }, 'read')).toEqual(code)
    expect(hooks.identify).toHaveBeenCalledWith('/repo')
    await expect(f.command(f.event, { kind: 'code', id: 'missing' }, 'read')).rejects.toThrow('no longer available')
  })
  it('rejects guest frames before reading identity or modifying data', async () => {
    const f = fixture()
    await expect(f.command({ ...f.event, senderFrame: {} }, { kind: 'code', id: 'ws' }, 'read')).rejects.toThrow('main frame')
    expect(hooks.identify).not.toHaveBeenCalled()
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM agent_teams').get()).toEqual({ n: 0 })
  })
  it('rejects a project relocated during async identity lookup', async () => {
    const f = fixture()
    hooks.identify.mockImplementationOnce(async () => { f.db.prepare("UPDATE workspaces SET root_path='/elsewhere' WHERE id='ws'").run(); return '/same/git' })
    await expect(f.command(f.event, { kind: 'code', id: 'ws' }, 'read')).rejects.toThrow('Project changed')
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM agent_teams').get()).toEqual({ n: 0 })
  })
})

describe('team actions move the project\'s coordinator conversation (B1.4 · S7.5)', () => {
  it('previews a coordinator change without writing, confirms it with the token, and tells the thread runtime after the commit', async () => {
    const changed = vi.fn(async (_ids: string[]) => {})
    const f = fixture(changed), scope = { kind: 'thread', id: 'project' }
    let team = await f.command(f.event, scope, 'read') as { id: string; revision: number; members: { id: string; name: string; role: string }[] }
    team = await f.command(f.event, scope, 'add', team.revision, 'Ana', 'coordinator') as typeof team
    team = await f.command(f.event, scope, 'add', team.revision, 'Bia', 'developer') as typeof team
    const [ana, bia] = ['Ana', 'Bia'].map(name => team.members.find(m => m.name === name)!.id)
    for (const id of ['x', 'y']) f.db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, 'ws', 'project', ?, '[]')").run(id, JSON.stringify({ id, title: id }))
    f.db.prepare("INSERT INTO agent_team_execution_links VALUES (?, 'thread', 'y'), (?, 'thread', 'x')").run(ana, bia)
    const rows = () => f.db.prepare('SELECT project_identity AS identity, thread_id AS threadId FROM project_coordinators').all()
    const preview = await f.command(f.event, scope, 'coordinator', team.revision, bia, undefined, undefined, { preview: true }) as { changed: string[]; swap: unknown; token: unknown }
    expect(preview).toMatchObject({ changed: ['x'], swap: { promoted: 'Bia', demoted: 'Ana', demotedRole: 'developer', message: { code: 'thread.coordinator.swap', params: { member: 'Bia', previous: 'Ana', role: 'developer' } } } })
    expect(rows()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
    const done = await f.command(f.event, scope, 'coordinator', team.revision, bia, undefined, undefined, { expect: preview.token }) as typeof team & { coordinatorChange: { changed: string[] } }
    expect(done.coordinatorChange.changed).toEqual(['x'])
    expect(done.members.map(m => [m.name, m.role])).toEqual([['Ana', 'developer'], ['Bia', 'coordinator']])
    expect(rows()).toEqual([{ identity: '/same/git', threadId: 'x' }])
    expect(changed).toHaveBeenCalledWith(['x'])
    // The same token again is stale; the refusal is a C3 code and writes nothing.
    await expect(f.command(f.event, scope, 'coordinator', done.revision, ana, undefined, undefined, { expect: preview.token })).rejects.toThrow('thread.coordinator.changed')
    expect(rows()).toEqual([{ identity: '/same/git', threadId: 'x' }])
    await expect(f.command(f.event, scope, 'coordinator', done.revision, ana, undefined, undefined, { preview: 'yes' })).rejects.toThrow('Invalid coordinator options')
  })
})
