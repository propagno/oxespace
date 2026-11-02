import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { registerActivityIpc } from './activity.ipc'
import type { AppDatabase } from '../db'
import { openExternalOrRecord } from '../utils/external-open'
import { workspaceRootResolver } from './file-system.ipc'

/**
 * `app:connectivity` (+ `app:connectivity-changed`), `app:about`, `app:open-external` and B18's `app:open-in*`. The
 * modules behind the first two and the last three load on first use. It also registers the activity center's channels (F30, `activity:*`), whose store loads on first use.
 */
export function registerAppInfoIpc(db: AppDatabase): () => void {
  registerActivityIpc({ db })
  let watcher: import('../services/app-info').ConnectivityWatcher | undefined
  const service = () => import('../services/app-info')
  ipcMain.handle(IPC_CHANNELS.app.connectivity, async event => {
    const { ConnectivityWatcher } = await service()
    watcher ??= new ConnectivityWatcher(() => net.isOnline(), state => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.app.onConnectivity, state)
    })
    return watcher.read()
  })
  ipcMain.handle(IPC_CHANNELS.app.about, async event => {
    const { aboutFacts, APP_VERSION } = await service()
    return aboutFacts({ version: APP_VERSION, packaged: app.isPackaged, versions: process.versions, platform: process.platform, arch: process.arch, osRelease: release() })
  })
  // The main window's only way to open a link outside the app, called once the person confirmed its host. Its main
  // frame only, through the central sender guard (B12). The URL is checked by the same rule and per-minute budget as
  // every other link: a refusal is journalled by its reason, never the URL.
  ipcMain.handle(IPC_CHANNELS.app.openExternal, (_event, url: unknown): { opened: boolean } => ({ opened: openExternalOrRecord(url) }))
  // B18 "Abrir em…": person-only like the link above (forbidden over MCP). The window names a workspace file and a
  // target id; main checks the path by its real path inside the registered root and picks an editor it detected.
  type OpenIn = import('../services/open-in').OpenInService
  let openIn: Promise<OpenIn> | undefined
  const openInService = (): Promise<OpenIn> => openIn ??= import('../services/open-in').then(({ OpenInService, launchDetached, registeredWorktree }) => new OpenInService({
    platform: process.platform,
    env: process.env,
    // A conversation's project root, or a worktree its repository registered (the conversation may work there).
    resolveRoot: (workspaceId, requestedRoot) => workspaceRootResolver(db)(workspaceId, requestedRoot) ?? (workspaceId.startsWith('thread:')
      ? registeredWorktree((db.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all(workspaceId.slice('thread:'.length)) as Array<{ root_path: string }>).map(row => row.root_path), requestedRoot)
      : null),
    preferenceFile: join(app.getPath('userData'), 'open-in.json'),
    launch: (file, args, cwd) => launchDetached(file, args, cwd, process.env),
    reveal: path => shell.showItemInFolder(path)
  }))
  ipcMain.handle(IPC_CHANNELS.app.openIn, async (_event, input: unknown) => { await (await openInService()).open(input) })
  ipcMain.handle(IPC_CHANNELS.app.openInTargets, async () => (await openInService()).targets())
  ipcMain.handle(IPC_CHANNELS.app.setOpenInPreference, async (_event, preference: unknown) => (await openInService()).setPreference(preference))
  return () => watcher?.stop()
}
