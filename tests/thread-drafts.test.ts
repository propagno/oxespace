import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftWriter, DRAFTS_STORAGE_KEY, loadDrafts, MAX_DRAFT_LENGTH, MAX_STORED_DRAFTS, sanitizeDrafts, saveDrafts } from '../src/utils/threadDrafts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    data
  }
}

describe('Thread draft persistence', () => {
  describe('sanitizeDrafts', () => {
    it('keeps text drafts and drops blank, non-string and malformed entries', () => {
      expect(sanitizeDrafts({ a: 'keep me', b: '   ', c: 42, d: null, e: '' })).toEqual({ a: 'keep me' })
      expect(sanitizeDrafts(null)).toEqual({})
      expect(sanitizeDrafts(['x'])).toEqual({})
      expect(sanitizeDrafts('text')).toEqual({})
    })

    it('truncates a pasted log instead of storing it whole', () => {
      const result = sanitizeDrafts({ a: 'x'.repeat(MAX_DRAFT_LENGTH + 500) })
      expect(result.a).toHaveLength(MAX_DRAFT_LENGTH)
    })

    it('keeps the newest drafts when there are too many', () => {
      const many = Object.fromEntries(Array.from({ length: MAX_STORED_DRAFTS + 10 }, (_, i) => [`t${i}`, `draft ${i}`]))
      const result = sanitizeDrafts(many)
      expect(Object.keys(result)).toHaveLength(MAX_STORED_DRAFTS)
      expect(result.t0).toBeUndefined()
      expect(result[`t${MAX_STORED_DRAFTS + 9}`]).toBe(`draft ${MAX_STORED_DRAFTS + 9}`)
    })
  })

  describe('load and save', () => {
    it('round-trips drafts through storage', () => {
      const storage = memoryStorage()
      saveDrafts({ thread1: 'half written', thread2: 'also this' }, storage)
      expect(loadDrafts(storage)).toEqual({ thread1: 'half written', thread2: 'also this' })
    })

    it('removes the entry once every draft is empty', () => {
      const storage = memoryStorage()
      saveDrafts({ thread1: 'text' }, storage)
      saveDrafts({ thread1: '' }, storage)
      expect(storage.data.has(DRAFTS_STORAGE_KEY)).toBe(false)
    })

    it('starts empty when the stored value is corrupt', () => {
      expect(loadDrafts(memoryStorage({ [DRAFTS_STORAGE_KEY]: '{not json' }))).toEqual({})
      expect(loadDrafts(memoryStorage({ [DRAFTS_STORAGE_KEY]: '"a string"' }))).toEqual({})
    })

    it('starts empty without a storage and does not throw when storage fails', () => {
      expect(loadDrafts(null)).toEqual({})
      expect(() => saveDrafts({ a: 'text' }, null)).not.toThrow()
      const failing = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
      expect(() => saveDrafts({ a: 'text' }, failing)).not.toThrow()
      expect(() => saveDrafts({}, failing)).not.toThrow()
    })
  })

  describe('createDraftWriter', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('writes once after typing stops, with the latest value', () => {
      const storage = memoryStorage()
      const setItem = vi.spyOn(storage, 'setItem')
      const writer = createDraftWriter(400, storage)
      writer.schedule({ t: 'a' })
      writer.schedule({ t: 'ab' })
      writer.schedule({ t: 'abc' })
      expect(setItem).not.toHaveBeenCalled()
      vi.advanceTimersByTime(400)
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(loadDrafts(storage)).toEqual({ t: 'abc' })
    })

    it('flush writes immediately and nothing is written twice', () => {
      const storage = memoryStorage()
      const setItem = vi.spyOn(storage, 'setItem')
      const writer = createDraftWriter(400, storage)
      writer.schedule({ t: 'unsaved' })
      writer.flush()
      expect(loadDrafts(storage)).toEqual({ t: 'unsaved' })
      vi.advanceTimersByTime(1000)
      expect(setItem).toHaveBeenCalledTimes(1)
    })

    it('flush with nothing pending writes nothing', () => {
      const storage = memoryStorage()
      const setItem = vi.spyOn(storage, 'setItem')
      createDraftWriter(400, storage).flush()
      expect(setItem).not.toHaveBeenCalled()
    })
  })
})
