/**
 * B11 (#228 P2-6): a workspace root that is not an existing folder is refused with a C3 code before anything is
 * written. The wizard used to create a workspace on a typed path that did not exist, with four terminals started
 * in nothing. These run the real adapter on a real database, so "nothing written" means no row and no pane.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FakeIpcMain } from '../helpers/fake-ipc-main'
import { removeTempDir } from '../helpers/removeTempDir'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { checkWorkspaceRoot, normalizeWorkspaceRoot } from '../../electron/main/services/workspace-root'
import type { SemanticService } from '../../electron/main/services/semantic.service'

// vi.mock is hoisted above the imports, so the fake it hands out must be hoisted with it.
const { ipcMain } = await vi.hoisted(async () => {
  const { createFakeIpcMain } = await import('../helpers/fake-ipc-main')
  return { ipcMain: createFakeIpcMain() as FakeIpcMain }
})
vi.mock('electron', () => ({
  ipcMain,
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() }
}))

const { registerWorkspaceIpc } = await import('../../electron/main/ipc/workspace.ipc')

const counts = (db: AppDatabase) => ({
  workspaces: (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n,
  panes: (db.prepare('SELECT COUNT(*) AS n FROM panes').get() as { n: number }).n
})

describe('workspace root check (B11)', () => {
  let db: AppDatabase
  let scratch: string

  beforeEach(() => {
    ipcMain.removeAllListeners()
    for (const channel of ipcMain.channels()) ipcMain.removeHandler(channel)
    db = openInMemoryDatabase()
    scratch = mkdtempSync(join(tmpdir(), 'oxe-ws-root-db-'))
    const semantic = { watchWorkspace: vi.fn(), unwatchWorkspace: vi.fn() } as unknown as SemanticService
    registerWorkspaceIpc(db, semantic, undefined, { workspaceService: new WorkspaceService(db) })
  })

  afterEach(() => {
    db.close()
    removeTempDir(scratch)
  })

  test('a folder that does not exist is refused, with no row and no panes', async () => {
    const rootPath = join(scratch, 'nao', 'existe', 'pasta')

    const result = await ipcMain.invoke('workspace:create', { rootPath, layoutPreset: 4 })

    expect(result).toEqual({ ok: false, refusal: 'notFound', message: { code: 'workspace.root.notFound', params: { path: rootPath } } })
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  test('a file is refused, with no row and no panes', async () => {
    const rootPath = join(scratch, 'package.json')
    writeFileSync(rootPath, '{}')

    const result = await ipcMain.invoke('workspace:create', { rootPath, layoutPreset: 4 })

    expect(result).toMatchObject({ ok: false, refusal: 'notDirectory', message: { code: 'workspace.root.notDirectory' } })
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  test('a relative path is refused, with no row and no panes', async () => {
    const result = await ipcMain.invoke('workspace:create', { rootPath: 'projects/repo', layoutPreset: 4 })

    expect(result).toMatchObject({ ok: false, refusal: 'notAbsolute', message: { code: 'workspace.root.notAbsolute', params: { path: 'projects/repo' } } })
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  test('an existing folder is accepted, with its four terminals', async () => {
    const rootPath = join(scratch, 'repo')
    mkdirSync(rootPath)

    const workspace = await ipcMain.invoke('workspace:create', { rootPath, layoutPreset: 4 }) as { id: string; rootPath: string; panes: unknown[] }

    expect(workspace.rootPath).toBe(rootPath)
    expect(workspace.panes).toHaveLength(4)
    expect(counts(db)).toEqual({ workspaces: 1, panes: 4 })
  })

  // Homologation: Explorer's "Copy as path" wraps the path in quotes.
  test.each([['"', '"'], ['\'', '\''], ['  "', '"  ']])('a path wrapped in %j quotes is accepted and stored without them', async (open, close) => {
    const rootPath = join(scratch, 'repo com espaço')
    mkdirSync(rootPath)

    const workspace = await ipcMain.invoke('workspace:create', { rootPath: `${open}${rootPath}${close}`, layoutPreset: 4 }) as { rootPath: string; panes: unknown[] }

    expect(workspace.rootPath).toBe(rootPath)
    expect(workspace.panes).toHaveLength(4)
  })

  test.each([`"PATH`, `PATH"`, `"PATH'`])('unbalanced quotes are kept, so %s is refused', async (shape) => {
    const rootPath = join(scratch, 'repo')
    mkdirSync(rootPath)
    const given = shape.replace('PATH', rootPath)

    const result = await ipcMain.invoke('workspace:create', { rootPath: given, layoutPreset: 4 })

    expect(result).toMatchObject({ ok: false })
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  // Homologation: an empty root used to throw a raw English sentence; it is a coded refusal like the others.
  test.each(['', '   ', '""', '\'\'', ' " " '])('an empty root %j is refused as empty, with no row', async (given) => {
    const result = await ipcMain.invoke('workspace:create', { rootPath: given, layoutPreset: 4 })

    expect(result).toEqual({ ok: false, refusal: 'empty', message: { code: 'workspace.root.empty', params: {} } })
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  test('a root that is not text is still malformed input, not a refusal', async () => {
    await expect(ipcMain.invoke('workspace:create', { rootPath: 42, layoutPreset: 4 })).rejects.toThrow()
    expect(counts(db)).toEqual({ workspaces: 0, panes: 0 })
  })

  test('quotes inside a name are kept', () => {
    expect(normalizeWorkspaceRoot('C:\\work\\it"s here')).toBe('C:\\work\\it"s here')
    expect(normalizeWorkspaceRoot('"C:\\work\\it"s here"')).toBe('C:\\work\\it"s here')
    expect(normalizeWorkspaceRoot('  /home/me/repo  ')).toBe('/home/me/repo')
    expect(normalizeWorkspaceRoot('""')).toBe('')
  })

  // Windows has no mode bits that stop a directory listing, and root ignores them.
  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a folder that cannot be listed is refused as unreadable', () => {
    const rootPath = join(scratch, 'locked')
    mkdirSync(rootPath)
    chmodSync(rootPath, 0o000)
    try {
      expect(checkWorkspaceRoot(rootPath)).toMatchObject({ ok: false, refusal: 'unreadable', message: { code: 'workspace.root.unreadable' } })
    } finally {
      chmodSync(rootPath, 0o700)
    }
  })
})
