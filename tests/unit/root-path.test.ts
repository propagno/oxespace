import { describe, expect, it } from 'vitest'
import { isCaseInsensitiveFs, isSameRootPath, normalizeRootPath, rootPathKey } from '../../shared/utils/path'

describe('normalizeRootPath', () => {
  it('unifies separators and drops trailing slashes without touching case', () => {
    expect(normalizeRootPath('C:\\work\\Repo')).toBe('C:/work/Repo')
    expect(normalizeRootPath('C:/work/repo///')).toBe('C:/work/repo')
    expect(normalizeRootPath('/home/dev/repo/')).toBe('/home/dev/repo')
  })

  it('keeps a bare root separator instead of normalising it to nothing', () => {
    // Stripping the trailing slash from '/' yields '', which would compare equal
    // to any other value that normalises to empty.
    expect(normalizeRootPath('/')).toBe('/')
  })
})

describe('isCaseInsensitiveFs', () => {
  it('folds case on Windows and macOS but not on Linux', () => {
    expect(isCaseInsensitiveFs('win32')).toBe(true)
    expect(isCaseInsensitiveFs('darwin')).toBe(true)
    expect(isCaseInsensitiveFs('linux')).toBe(false)
  })
})

describe('isSameRootPath', () => {
  it('treats separator style and trailing slashes as the same folder everywhere', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      expect(isSameRootPath('C:\\work\\repo', 'C:/work/repo/', platform)).toBe(true)
    }
  })

  it('matches case-insensitively only where the filesystem does', () => {
    // The same two strings are one folder on Windows and two on Linux. Getting
    // this wrong either merges distinct directories or lets a duplicate through.
    expect(isSameRootPath('/home/dev/Repo', '/home/dev/repo', 'win32')).toBe(true)
    expect(isSameRootPath('/home/dev/Repo', '/home/dev/repo', 'darwin')).toBe(true)
    expect(isSameRootPath('/home/dev/Repo', '/home/dev/repo', 'linux')).toBe(false)
  })

  it('does not match different folders that share a prefix', () => {
    expect(isSameRootPath('C:/work/repo', 'C:/work/repo-2', 'win32')).toBe(false)
  })
})

describe('rootPathKey', () => {
  it('groups the variants that isSameRootPath considers equal', () => {
    const key = rootPathKey('C:\\work\\Repo\\', 'win32')
    expect(rootPathKey('c:/work/repo', 'win32')).toBe(key)
    expect(rootPathKey('C:/work/Repo', 'linux')).not.toBe(rootPathKey('c:/work/repo', 'linux'))
  })
})
