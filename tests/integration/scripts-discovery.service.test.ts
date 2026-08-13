import { describe, expect, test, vi } from 'vitest'
import { discoverScripts } from '../../electron/main/services/scripts-discovery.service'

describe('discoverScripts', () => {
  test('includes runnable package.json scripts alongside shell files', async () => {
    const fileSystem = {
      listTree: vi.fn(async () => []),
      readFile: vi.fn(async () => ({
        relativePath: 'package.json',
        content: JSON.stringify({ scripts: { dev: 'vite', test: 'vitest run', ignored: 42 } }),
        size: 80,
        mtimeMs: 1
      }))
    }

    const scripts = await discoverScripts(fileSystem as never, 'workspace-1', 'C:/repo')

    expect(scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'package:dev',
        relativePath: 'package.json › scripts.dev',
        extension: 'npm',
        command: 'npm run "dev"'
      }),
      expect.objectContaining({ id: 'package:test', extension: 'npm' })
    ]))
    expect(scripts).toHaveLength(2)
  })

  test('builds shell-file commands for the host platform', async () => {
    const fileSystem = {
      listTree: vi.fn(async () => [
        { name: 'deploy.sh', relativePath: 'deploy.sh', type: 'file' },
        { name: 'build.ps1', relativePath: 'build.ps1', type: 'file' }
      ]),
      readFile: vi.fn(async () => { throw new Error('no package.json') })
    }
    const root = process.platform === 'win32' ? 'C:\\repo' : '/home/dev/repo'

    const scripts = await discoverScripts(fileSystem as never, 'workspace-1', root)
    const shell = scripts.find((script) => script.extension === 'sh')
    const powershell = scripts.find((script) => script.extension === 'ps1')

    if (process.platform === 'win32') {
      expect(shell?.command).toContain('Git\\bin\\bash.exe')
      expect(powershell?.command).toContain('powershell.exe -NoProfile')
    } else {
      // The regression this guards: both commands used to be emitted as
      // cmd.exe syntax regardless of platform, so nothing ran on Linux.
      expect(shell?.command).toBe('bash "/home/dev/repo/deploy.sh"')
      expect(powershell?.command).toBe('pwsh -NoProfile -File "/home/dev/repo/build.ps1"')
    }
  })
})
