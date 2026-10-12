import { describe, expect, it } from 'vitest'
import { checkWorkspacePath } from '../electron/main/services/conversation/path-safety'

const win = { windows: true }
const ROOT = 'C:\\work\\app'

describe('checkWorkspacePath (windows)', () => {
  it('accepts paths inside the workspace, case-insensitively', () => {
    expect(checkWorkspacePath(ROOT, 'src\\index.ts', win).safe).toBe(true)
    expect(checkWorkspacePath(ROOT, 'C:\\WORK\\APP\\src\\a.ts', win).safe).toBe(true)
    expect(checkWorkspacePath(ROOT, ROOT, win).safe).toBe(true)
  })

  it('rejects traversal and sibling directories that share a prefix', () => {
    expect(checkWorkspacePath(ROOT, '..\\other\\x', win)).toEqual({ safe: false, reason: 'outside-workspace' })
    expect(checkWorkspacePath(ROOT, 'C:\\work\\app-secrets\\key', win)).toEqual({ safe: false, reason: 'outside-workspace' })
    expect(checkWorkspacePath(ROOT, 'src\\..\\..\\app2\\x', win).safe).toBe(false)
  })

  it('rejects the Windows-specific bypasses', () => {
    expect(checkWorkspacePath(ROOT, 'notes.txt:hidden', win)).toEqual({ safe: false, reason: 'alternate-stream' })
    expect(checkWorkspacePath(ROOT, 'src\\NUL.txt', win)).toEqual({ safe: false, reason: 'device-name' })
    expect(checkWorkspacePath(ROOT, 'com1', win)).toEqual({ safe: false, reason: 'device-name' })
    expect(checkWorkspacePath(ROOT, 'src\\file.txt.', win)).toEqual({ safe: false, reason: 'trailing-dot-or-space' })
    expect(checkWorkspacePath(ROOT, 'PROGRA~1\\x', win)).toEqual({ safe: false, reason: 'short-name' })
    expect(checkWorkspacePath(ROOT, '\\\\?\\C:\\work\\app\\x', win)).toEqual({ safe: false, reason: 'device-prefix' })
    expect(checkWorkspacePath(ROOT, '\\\\.\\PhysicalDrive0', win)).toEqual({ safe: false, reason: 'device-prefix' })
  })

  it('follows links: a junction pointing outside is outside', () => {
    const realpath = (p: string): string => (p.toLowerCase().endsWith('\\node_modules') ? 'D:\\shared\\node_modules' : p)
    expect(checkWorkspacePath(ROOT, 'node_modules', { ...win, realpath })).toEqual({ safe: false, reason: 'outside-workspace' })
    expect(checkWorkspacePath(ROOT, 'src', { ...win, realpath }).safe).toBe(true)
  })

  it('rejects empty and NUL-containing input', () => {
    expect(checkWorkspacePath(ROOT, '', win).safe).toBe(false)
    expect(checkWorkspacePath(ROOT, 'a\0b', win).safe).toBe(false)
  })
})

describe('checkWorkspacePath (posix)', () => {
  const posix = { windows: false }
  it('is case-sensitive and does not apply Windows name rules', () => {
    expect(checkWorkspacePath('/work/app', 'src/NUL.txt', posix).safe).toBe(true)
    expect(checkWorkspacePath('/work/app', 'a:b', posix).safe).toBe(true)
    expect(checkWorkspacePath('/work/app', '/work/App/x', posix).safe).toBe(false)
    expect(checkWorkspacePath('/work/app', '../x', posix).safe).toBe(false)
  })
})
