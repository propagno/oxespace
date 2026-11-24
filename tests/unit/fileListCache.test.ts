import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { afterEach, vi } from 'vitest'
import {
  clearFileListCache,
  FILE_LIST_CACHE_MAX_ENTRIES,
  getCachedFileList,
  getFileListCacheEpoch,
  LIST_FILES_CACHE_TTL_MS,
  setCachedFileList
} from '../../src/components/CommandMenu/fileListCache'
import * as menuCache from '../../src/components/CommandMenu/fileListCache'
import * as shared from '../../src/lib/fileListCache'
import { clearFileListCache as sharedClear } from '../../src/lib/fileListCache'
import { useFileMentions } from '../../src/components/Threads/useFileMentions'
import { locateDesignSource } from '../../src/components/WebPreview/designSource'

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

// OXE-299: one file-list cache for every consumer of window.oxe.search.listFiles (CommandMenu, the composer's @
// mentions and Design Grab), in src/lib/fileListCache.ts. The CommandMenu path re-exports the same module.
describe('OXE-299 · shared file-list cache', () => {
  const original = window.oxe
  beforeEach(() => { sharedClear() })
  afterEach(() => { window.oxe = original })

  const install = () => {
    const listFiles = vi.fn(async (_input: { workspaceId: string; rootPath: string }) => ({ files: ['src/App.tsx', 'src/main.tsx'], truncated: false }))
    window.oxe = { ...original, search: { listFiles, run: vi.fn(async () => ({ files: [], totalMatches: 0, truncated: false })) } } as unknown as typeof window.oxe
    return listFiles
  }

  test('shared fileListCache serves CommandMenu, useFileMentions and designSource with zero redundant IPC calls within TTL', async () => {
    const listFiles = install()
    // The CommandMenu path is the same module, not a second cache.
    expect(menuCache.getCachedFileList).toBe(shared.getCachedFileList)
    expect(menuCache.setCachedFileList).toBe(shared.setCachedFileList)

    // Design Grab asks first: one IPC call.
    const payload = { probe: { components: [], attrs: [], react: { file: '/repo-299/src/App.tsx', line: 1, column: 1 } } } as never
    await locateDesignSource(payload, { id: 'w-299', rootPath: '/repo-299' })
    expect(listFiles).toHaveBeenCalledTimes(1)

    // The composer's @ mention for the same root: from the cache, no call.
    const { result } = renderHook(() => useFileMentions({ workspaceId: 'w-299', rootPath: '/repo-299', draft: '@App', caret: 4, enabled: true, onApply: () => undefined }))
    await waitFor(() => expect(result.current.popup).not.toBeNull())
    expect(listFiles).toHaveBeenCalledTimes(1)

    // A second grab, and what CommandMenu reads on open: still the cached entry.
    await locateDesignSource(payload, { id: 'w-299', rootPath: '/repo-299' })
    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(menuCache.getCachedFileList('/repo-299')?.fresh).toBe(true)
  })

  test('shared fileListCache enforces LRU cap of 16 entries across all consumers', async () => {
    const listFiles = install()
    expect(shared.FILE_LIST_CACHE_MAX_ENTRIES).toBe(16)
    for (let i = 0; i < 16; i++) await shared.listFilesCached({ workspaceId: 'w', rootPath: `/root-${i}` })
    // The 17th root comes through the composer's @ mentions.
    const { result } = renderHook(() => useFileMentions({ workspaceId: 'w', rootPath: '/root-16', draft: '@App', caret: 4, enabled: true, onApply: () => undefined }))
    await waitFor(() => expect(result.current.popup).not.toBeNull())
    expect(listFiles).toHaveBeenCalledTimes(17)
    expect(shared.getCachedFileList('/root-0'), 'the least recently used root is evicted').toBeNull()
    expect(shared.getCachedFileList('/root-1')).not.toBeNull()
    expect(shared.getCachedFileList('/root-16')).not.toBeNull()
  })
})
