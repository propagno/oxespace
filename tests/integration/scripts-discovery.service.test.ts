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
})
