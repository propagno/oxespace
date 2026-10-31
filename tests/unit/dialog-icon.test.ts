// @vitest-environment node
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const createFromPath = vi.fn((_path: string) => ({ isEmpty: () => true }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => join('C:', 'repo') },
  nativeImage: { createFromPath: (path: string) => createFromPath(path) }
}))

const { dialogIconCandidates, loadDialogIcon, withDialogIcon } = await import('../../electron/main/dialog-icon')
type Image = Parameters<typeof loadDialogIcon>[1] extends (path: string) => infer I ? I : never
const image = (empty: boolean) => ({ isEmpty: () => empty }) as unknown as Image

describe('dialog icon', () => {
  it('looks in the resources folder when packaged and in the repository resources in a dev run', () => {
    expect(dialogIconCandidates({ platform: 'linux', packaged: true, resourcesPath: '/opt/OXESpace/resources', appPath: '/x' }))
      .toEqual([join('/opt/OXESpace/resources', 'icons', '256x256.png'), join('/opt/OXESpace/resources', 'icon.png')])
    expect(dialogIconCandidates({ platform: 'win32', packaged: false, resourcesPath: 'ignored', appPath: 'C:/repo' }))
      .toEqual([join('C:/repo', 'resources', 'icons', '256x256.png'), join('C:/repo', 'resources', 'icon.png'), join('C:/repo', 'resources', 'icon.ico')])
  })

  it('takes the first icon that loads, skipping missing files and loaders that throw', () => {
    const icon = image(false)
    const load = (path: string) => {
      if (path === 'throws') throw new Error('unreadable')
      return path === 'good' ? icon : image(true)
    }
    expect(loadDialogIcon(['missing', 'throws', 'good', 'later'], load)).toBe(icon)
    expect(loadDialogIcon(['missing', 'throws'], load)).toBeUndefined()
    expect(loadDialogIcon([], load)).toBeUndefined()
  })

  it('shows the dialog without an icon when none loads, and tries the files once', () => {
    const options = { type: 'error' as const, message: 'x' }
    expect(withDialogIcon(options)).toBe(options)
    expect(withDialogIcon(options)).toBe(options)
    expect(createFromPath.mock.calls.map(([path]) => path)).toEqual(dialogIconCandidates({ platform: process.platform, packaged: false, resourcesPath: '', appPath: join('C:', 'repo') }))
  })
})
