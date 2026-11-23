// @vitest-environment node
// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A13). Written by the planner; the executor must not edit it.
// A workspace whose folder was moved or deleted. Only folders this test made in the temp directory are used.
// Contract:
// - TerminalManager option `rootExists?: (path: string) => boolean` (electron/main/index.ts passes existsSync): a pane
//   whose working folder is not there is refused before spawn;
// - 'workspace:root-status' (id) answers { available: boolean };
// - 'workspace:relink' ({ workspaceId, rootPath }) runs the same checks as create (normalizeWorkspaceRoot,
//   checkWorkspaceRoot, the first policy read), refuses a folder another workspace has, and returns the Workspace with
//   the new root and the same panes. It never creates, moves or deletes a folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../../helpers/fake-ipc-main'
import { removeTempDir } from '../../helpers/removeTempDir'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({ ipcMain, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }, dialog: { showOpenDialog: vi.fn() } }))

const { openInMemoryDatabase } = await import('../../../electron/main/db/index')
const { TerminalManager } = await import('../../../electron/main/services/terminal.service')
const { WorkspaceService } = await import('../../../electron/main/services/workspace.service')
const { registerWorkspaceIpc } = await import('../../../electron/main/ipc/workspace.ipc')

let temp: string
let original: string
let moved: string
let db: ReturnType<typeof openInMemoryDatabase>
let service: InstanceType<typeof WorkspaceService>
let workspace: ReturnType<InstanceType<typeof WorkspaceService>['create']>

async function invoke(channel: string, input: unknown): Promise<unknown> {
  expect(ipcMain.channels(), `main handles ${channel}`).toContain(channel)
  return ipcMain.invoke(channel, input)
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'oxe-p0-root-'))
  original = join(temp, 'api')
  moved = join(temp, 'api-moved')
  mkdirSync(original)
  db = openInMemoryDatabase()
  service = new WorkspaceService(db)
  workspace = service.create({ rootPath: original, layout: '1x2' })
  registerWorkspaceIpc(db, undefined, { workspaceService: service, shellProfileService: { list: () => [] } as never, agentService: { list: () => [] } as never })
})
afterEach(() => {
  for (const channel of ipcMain.channels()) ipcMain.removeHandler(channel)
  db.close()
  if (dirname(resolve(temp)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
  removeTempDir(temp)
})

describe('OXE-367 · a workspace folder that is gone', () => {
  test('a pane in a folder that is gone is refused before any PTY is spawned', async () => {
    renameSync(original, moved)
    const spawn = vi.fn(() => ({ pid: 0, cols: 80, rows: 24, process: 'sh', write() {}, resize() {}, kill() {}, pause() {}, resume() {}, clear() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }))
    const manager = new TerminalManager(db, { pty: { spawn }, rootExists: existsSync } as never)
    const started = await Promise.resolve().then(() => manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })).then(() => 'started', () => 'refused')
    expect(spawn, 'no broken PTY').not.toHaveBeenCalled()
    expect(started).toBe('refused')
  })

  test('the app turns the missing folder check on', () => {
    // rigor: source-assertion. index.ts is the composition root and cannot run in a unit test.
    const source = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
    expect(source).toMatch(/rootExists\s*:\s*existsSync/)
  })

  test('the root status says when the folder is there and when it is gone', async () => {
    expect(await invoke('workspace:root-status', workspace.id)).toEqual({ available: true })
    renameSync(original, moved)
    expect(await invoke('workspace:root-status', workspace.id)).toEqual({ available: false })
  })

  test('relink points the same workspace and panes at the folder the person picked', async () => {
    renameSync(original, moved)
    const linked = await invoke('workspace:relink', { workspaceId: workspace.id, rootPath: `"${moved}"` }) as typeof workspace
    expect(linked.id).toBe(workspace.id)
    expect(linked.rootPath).toBe(moved)
    expect(service.get(workspace.id)?.panes.map(pane => pane.id)).toEqual(workspace.panes.map(pane => pane.id))
    expect(existsSync(original), 'nothing recreated the old folder').toBe(false)
  })

  test('relink refuses a folder that is not there or that another workspace has', async () => {
    const other = join(temp, 'web')
    mkdirSync(other)
    service.create({ rootPath: other, layout: '1x1' })
    expect(ipcMain.channels(), 'main handles workspace:relink').toContain('workspace:relink')
    for (const rootPath of [join(temp, 'nowhere'), other]) {
      const answer = await invoke('workspace:relink', { workspaceId: workspace.id, rootPath }).catch((error: unknown) => ({ ok: false, error: String(error) }))
      expect(answer).toMatchObject({ ok: false })
      expect(service.get(workspace.id)?.rootPath).toBe(original)
    }
  })
})
