import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { registerTeamIpc } from '../../electron/main/ipc/team.ipc'

const hooks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), identify: vi.fn(async () => '/same/git'), window: vi.fn(() => ({})) }))
vi.mock('electron', () => ({ app: { getPath: () => '' }, BrowserWindow: { fromWebContents: hooks.window }, ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => hooks.handlers.set(name, handler) } }))
vi.mock('../../electron/main/services/memory/memory-project.service', () => ({ projectIdentity: hooks.identify }))
const databases: AppDatabase[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()); hooks.handlers.clear(); hooks.identify.mockReset(); hooks.identify.mockResolvedValue('/same/git'); hooks.window.mockReset(); hooks.window.mockReturnValue({}) })
function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.exec("INSERT INTO workspaces(id,name,root_path,layout,default_shell_profile_id) VALUES('ws','Repo','/repo','1x1','builtin-claude'); INSERT INTO thread_projects(id,identity,root_path,display_name,created_at,updated_at) VALUES('project','/same/git','/repo','Repo',1,1)")
  registerTeamIpc(db)
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

