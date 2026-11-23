// @vitest-environment node
// Frozen acceptance test for OXE-371 A3, A4 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// The real bundled ripgrep on a temporary folder: a bad regex or glob is an error, never "No results", and Match case
// off never becomes smart case.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SearchService, __resetRgCommandCacheForTests } from '../../../electron/main/services/search.service'
import { removeTempDir } from '../../helpers/removeTempDir'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-search-p1a-'))
  writeFileSync(join(root, 'a.txt'), 'needle lower\nNeedle title\nNEEDLE upper\n')
})
afterAll(() => { removeTempDir(root) })
beforeEach(() => { __resetRgCommandCacheForTests() })

const search = (input: Record<string, unknown>) => new SearchService().search({ workspaceId: 'ws', rootPath: root, ...input } as never)

describe('OXE-371 · find in files', () => {
  it('an invalid regex is an error with its reason', async () => {
    const result = await search({ query: '[unclosed', isRegex: true })
    expect(result.error).toMatch(/regex|unclosed/i)
    expect(result.error!.length).toBeLessThanOrEqual(1000)
    expect(result.totalMatches).toBe(0)
  })

  it('an invalid glob is an error with its reason', async () => {
    const result = await search({ query: 'needle', globs: ['[unclosed'] })
    expect(result.error).toMatch(/glob|unclosed/i)
  })

  it('no match is still no error', async () => {
    const result = await search({ query: 'absent-from-the-tree' })
    expect(result.error).toBeUndefined()
    expect(result.totalMatches).toBe(0)
  })

  it('match case off always ignores case', async () => {
    expect((await search({ query: 'Needle' })).totalMatches).toBe(3)
    expect((await search({ query: 'NEEDLE', caseSensitive: false })).totalMatches).toBe(3)
  })

  it('match case on keeps exact casing', async () => {
    expect((await search({ query: 'Needle', caseSensitive: true })).totalMatches).toBe(1)
  })
})
