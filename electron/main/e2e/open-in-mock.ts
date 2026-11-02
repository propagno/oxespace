/**
 * B18 `app:open-in*` in E2E runs: the real OpenInService (the same path checks and refusals), with three fake editors
 * "installed" and nothing started. Each launch and reveal is kept, in order, on `globalThis.__oxeOpenedIn` in the main
 * process, so a spec reads the argument list main built:
 *
 *   await app.evaluate(() => (globalThis as { __oxeOpenedIn?: OpenedIn[] }).__oxeOpenedIn ?? [])
 *
 * `OXESPACE_E2E_OPEN_IN_EDITORS=none` lists no editor; `fail` makes every launch fail (`launchFailed`).
 */
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { OpenInService, type OpenInRootResolver } from '../services/open-in'

export const E2E_OPENED_IN_GLOBAL = '__oxeOpenedIn'

export interface OpenedIn { kind: 'launch' | 'reveal'; file: string; args: string[]; cwd?: string }

/** Where the fake editors "are": absolute, never run. */
export const E2E_FAKE_EDITOR_DIR = process.platform === 'win32' ? 'C:\\oxespace-e2e-editors' : '/oxespace-e2e-editors'

export function createOpenInMock(resolveRoot: OpenInRootResolver, env: NodeJS.ProcessEnv, preferenceFile: string, target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): OpenInService {
  const record = (entry: OpenedIn) => { ((target[E2E_OPENED_IN_GLOBAL] ??= []) as OpenedIn[]).push(entry) }
  // Linux candidates come from PATH: the fake directory is its only entry, and only these files "exist" there.
  const names = env.OXESPACE_E2E_OPEN_IN_EDITORS === 'none' ? [] : ['code', 'cursor', 'zed']
  const installed = new Set(names.map(name => join(E2E_FAKE_EDITOR_DIR, name)))
  return new OpenInService({
    platform: 'linux',
    env: { PATH: E2E_FAKE_EDITOR_DIR },
    resolveRoot,
    preferenceFile,
    isExecutable: path => installed.has(path),
    launch: async (file, args, cwd) => {
      if (env.OXESPACE_E2E_OPEN_IN_EDITORS === 'fail') throw new Error('fake launch failure')
      record({ kind: 'launch', file, args, cwd })
    },
    reveal: file => record({ kind: 'reveal', file, args: [] })
  })
}

export function registerOpenInMock(resolveRoot: OpenInRootResolver): void {
  const service = createOpenInMock(resolveRoot, process.env, join(app.getPath('userData'), 'open-in.json'))
  ipcMain.handle(IPC_CHANNELS.app.openIn, async (_event, input: unknown) => { await service.open(input) })
  ipcMain.handle(IPC_CHANNELS.app.openInTargets, () => service.targets())
  ipcMain.handle(IPC_CHANNELS.app.setOpenInPreference, (_event, preference: unknown) => service.setPreference(preference))
}
