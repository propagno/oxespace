import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearFileListCache,
  FILE_LIST_CACHE_MAX_ENTRIES,
  getCachedFileList,
  getFileListCacheEpoch,
  LIST_FILES_CACHE_TTL_MS,
  setCachedFileList
} from '../../src/components/CommandMenu/fileListCache'

describe('fileListCache', () => {
  beforeEach(() => {
    clearFileListCache()
  })

  test('returns fresh hits within 30s TTL and stale hits once TTL elapses', () => {
    const start = 10_000
    setCachedFileList('C:/repo-a', ['src/a.ts'], start)

    expect(getCachedFileList('C:/repo-a', start + LIST_FILES_CACHE_TTL_MS - 1)).toEqual({
      files: ['src/a.ts'],
      fresh: true
    })
    expect(getCachedFileList('C:/repo-a', start + LIST_FILES_CACHE_TTL_MS)).toEqual({
      files: ['src/a.ts'],
      fresh: false
    })
  })

  test('evicts the least-recently used rootPath past the 16-workspace limit', () => {
    for (let i = 0; i < FILE_LIST_CACHE_MAX_ENTRIES; i++) {
      setCachedFileList(`C:/repo-${i}`, [`file-${i}.ts`], 1_000 + i)
    }

    // Touch repo-0 so repo-1 becomes the least-recently used entry.
    expect(getCachedFileList('C:/repo-0', 2_000)?.files).toEqual(['file-0.ts'])

    setCachedFileList('C:/repo-16', ['file-16.ts'], 2_001)

    expect(getCachedFileList('C:/repo-1', 2_002)).toBeNull()
    expect(getCachedFileList('C:/repo-0', 2_002)?.files).toEqual(['file-0.ts'])
    expect(getCachedFileList('C:/repo-16', 2_002)?.files).toEqual(['file-16.ts'])
  })

  test('clears entries and ignores stale-epoch writes after clearFileListCache', () => {
    const epochBeforeClear = getFileListCacheEpoch()
    setCachedFileList('C:/repo-a', ['src/a.ts'], 1_000, epochBeforeClear)

    clearFileListCache()
    expect(getCachedFileList('C:/repo-a', 1_001)).toBeNull()

    const written = setCachedFileList('C:/repo-a', ['src/late.ts'], 1_002, epochBeforeClear)
    expect(written).toBe(false)
    expect(getCachedFileList('C:/repo-a', 1_003)).toBeNull()
  })

  test('clones stored arrays so caller mutations cannot corrupt the cache', () => {
    const files = ['src/a.ts']
    setCachedFileList('C:/repo-a', files, 1_000)
    files.push('src/mutated.ts')

    expect(getCachedFileList('C:/repo-a', 1_001)?.files).toEqual(['src/a.ts'])
  })
})
