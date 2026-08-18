import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchService, __resetRgCommandCacheForTests } from '../../electron/main/services/search.service'

// These tests run the real bundled ripgrep binary against a throwaway fixture
// tree — they validate the actual `rg --json` parsing + argument building
// end-to-end (rg is a child process, not a native node module, so there is no
// Electron-ABI concern here).

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-search-'))
  mkdirSync(join(root, 'sub'), { recursive: true })
  writeFileSync(join(root, 'a.txt'), 'hello world\nfoo needle bar\nNeedle upper\n')
  writeFileSync(join(root, 'sub', 'b.js'), 'const needle = 1\nno match here\n')
  writeFileSync(join(root, 'ignored.txt'), 'needle in ignored\n')
  // `.ignore` is honored by ripgrep regardless of a git repo, so the default
  // search must skip ignored.txt until includeIgnored disables ignore files.
  writeFileSync(join(root, '.ignore'), 'ignored.txt\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  __resetRgCommandCacheForTests()
})

describe('SearchService', () => {
  test('finds literal matches grouped by file, honoring .ignore', async () => {
    const service = new SearchService()
    const result = await service.search({ workspaceId: 'ws', rootPath: root, query: 'needle' })

    expect(result.error).toBeUndefined()
    expect(result.totalFiles).toBe(2)
    expect(result.totalMatches).toBe(3) // needle + smart-case Needle in a.txt, needle in b.js
    const paths = result.files.map((f) => f.path).sort()
    expect(paths).toEqual(['a.txt', 'sub/b.js'])
    expect(paths).not.toContain('ignored.txt')

    const aFile = result.files.find((f) => f.path === 'a.txt')
    expect(aFile?.matches.map((m) => m.lineNumber)).toEqual([2, 3])
    expect(aFile?.matches[0].submatches[0].text).toBe('needle')
  })

  test('caseSensitive restricts to exact casing', async () => {
    const service = new SearchService()
    const result = await service.search({ workspaceId: 'ws', rootPath: root, query: 'Needle', caseSensitive: true })

    expect(result.totalMatches).toBe(1)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('a.txt')
    expect(result.files[0].matches[0].lineNumber).toBe(3)
  })

  test('regex vs literal changes matching', async () => {
    const service = new SearchService()
    const asRegex = await service.search({ workspaceId: 'ws', rootPath: root, query: 'n..dle', isRegex: true })
    expect(asRegex.totalMatches).toBeGreaterThan(0)

    const asLiteral = await service.search({ workspaceId: 'ws', rootPath: root, query: 'n..dle', isRegex: false })
    expect(asLiteral.totalMatches).toBe(0)
  })

  test('includeIgnored surfaces ignored files', async () => {
    const service = new SearchService()
    const result = await service.search({ workspaceId: 'ws', rootPath: root, query: 'needle', includeIgnored: true })

    const paths = result.files.map((f) => f.path)
    expect(paths).toContain('ignored.txt')
    expect(result.totalFiles).toBe(3)
  })

  test('empty query returns an empty result without error', async () => {
    const service = new SearchService()
    const result = await service.search({ workspaceId: 'ws', rootPath: root, query: '   ' })

    expect(result.error).toBeUndefined()
    expect(result.totalMatches).toBe(0)
    expect(result.files).toHaveLength(0)
  })

  test('missing root reports an error rather than throwing', async () => {
    const service = new SearchService()
    const result = await service.search({ workspaceId: 'ws', rootPath: join(root, 'does-not-exist'), query: 'needle' })

    expect(result.error).toBeTruthy()
    expect(result.totalMatches).toBe(0)
  })

  test('listFiles enumerates tracked files, honoring .ignore and hidden defaults', async () => {
    const service = new SearchService()
    const result = await service.listFiles(root)

    expect(result.error).toBeUndefined()
    const paths = result.files.sort()
    expect(paths).toEqual(['a.txt', 'sub/b.js']) // ignored.txt (.ignore) + .ignore (hidden) excluded
  })
})
