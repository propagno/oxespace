import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftWriter, DRAFTS_STORAGE_KEY, loadDrafts, loadStoredDrafts, MAX_DRAFT_AGE_MS, MAX_DRAFT_LENGTH, MAX_STORED_DRAFTS, parseStoredDrafts, sanitizeDrafts, saveDrafts } from '../src/utils/threadDrafts'

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

  describe('expiry', () => {
    const NOW = Date.UTC(2026, 9, 14, 12)
    const DAY = 24 * 60 * 60 * 1000

    it('deletes a draft that has not been edited for more than the maximum age', () => {
      const result = parseStoredDrafts({
        fresh: { text: 'recent', at: NOW - DAY },
        edge: { text: 'just inside', at: NOW - MAX_DRAFT_AGE_MS },
        stale: { text: 'too old', at: NOW - MAX_DRAFT_AGE_MS - 1 }
      }, NOW)
      expect(Object.keys(result.drafts).sort()).toEqual(['edge', 'fresh'])
      expect(result.stamps.fresh).toBe(NOW - DAY)
    })

    it('uses seven days as the maximum age', () => {
      expect(MAX_DRAFT_AGE_MS).toBe(7 * DAY)
    })

    it('keeps drafts written in the earlier plain-string format and starts their clock now', () => {
      const result = parseStoredDrafts({ legacy: 'written before expiry existed' }, NOW)
      expect(result.drafts).toEqual({ legacy: 'written before expiry existed' })
      expect(result.stamps.legacy).toBe(NOW)
    })

    it('treats a timestamp in the future as now instead of keeping the draft forever', () => {
      const result = parseStoredDrafts({ a: { text: 'x', at: NOW + 400 * DAY } }, NOW)
      expect(result.stamps.a).toBe(NOW)
    })

    it('dates an entry with a missing or non-numeric stamp as now instead of deleting it', () => {
      const result = parseStoredDrafts({ a: { text: 'no stamp' }, b: { text: 'bad stamp', at: 'yesterday' } }, NOW)
      expect(result.stamps).toEqual({ a: NOW, b: NOW })
    })

    it('discards malformed entries', () => {
      const result = parseStoredDrafts({ a: 42, b: null, c: { at: NOW }, d: { text: 7, at: NOW }, e: { text: '  ', at: NOW } }, NOW)
      expect(result.drafts).toEqual({})
    })

    it('keeps the most recently edited drafts when there are too many', () => {
      const many = Object.fromEntries(Array.from({ length: MAX_STORED_DRAFTS + 5 }, (_, i) => [`t${i}`, { text: `d${i}`, at: NOW - (MAX_STORED_DRAFTS + 5 - i) * 1000 }]))
      const result = parseStoredDrafts(many, NOW)
      expect(Object.keys(result.drafts)).toHaveLength(MAX_STORED_DRAFTS)
      expect(result.drafts.t0).toBeUndefined()
      expect(result.drafts[`t${MAX_STORED_DRAFTS + 4}`]).toBe(`d${MAX_STORED_DRAFTS + 4}`)
    })

    it('does not return expired drafts when loading from storage', () => {
      const storage = memoryStorage({ [DRAFTS_STORAGE_KEY]: JSON.stringify({ old: { text: 'gone', at: NOW - 8 * DAY }, new: { text: 'kept', at: NOW - DAY } }) })
      expect(loadDrafts(storage, NOW)).toEqual({ new: 'kept' })
    })

    it('removes an expired draft from storage on the next save', () => {
      const storage = memoryStorage()
      saveDrafts({ old: 'stale text', fresh: 'recent text' }, storage, { old: NOW - 9 * DAY, fresh: NOW - DAY }, NOW)
      const saved = JSON.parse(storage.data.get(DRAFTS_STORAGE_KEY) ?? '{}')
      expect(Object.keys(saved)).toEqual(['fresh'])
      expect(saved.fresh).toEqual({ text: 'recent text', at: NOW - DAY })
    })

    it('removes the storage entry when every draft has expired', () => {
      const storage = memoryStorage()
      saveDrafts({ old: 'stale text' }, storage, { old: NOW - 30 * DAY }, NOW)
      expect(storage.data.has(DRAFTS_STORAGE_KEY)).toBe(false)
    })

    it('a writer restamps only the draft that changed, so an untouched one keeps aging', () => {
      vi.useFakeTimers()
      try {
        const storage = memoryStorage()
        let clock = NOW
        const initial = { drafts: { untouched: 'old words', edited: 'first' }, stamps: { untouched: NOW - 6 * DAY, edited: NOW - 6 * DAY } }
        const writer = createDraftWriter(400, storage, initial, () => clock)
        clock = NOW + DAY / 2
        writer.schedule({ untouched: 'old words', edited: 'first, then more' })
        writer.flush()
        const saved = loadStoredDrafts(storage, clock)
        expect(saved.stamps.edited).toBe(clock)
        expect(saved.stamps.untouched).toBe(NOW - 6 * DAY)
        // A day later the untouched draft is past seven days; the edited one is not.
        clock = NOW + 2 * DAY
        expect(Object.keys(loadStoredDrafts(storage, clock).drafts)).toEqual(['edited'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('a writer forgets the stamp of a draft that was cleared', () => {
      const storage = memoryStorage()
      const writer = createDraftWriter(400, storage, { drafts: { a: 'text' }, stamps: { a: NOW - DAY } }, () => NOW)
      writer.schedule({})
      writer.flush()
      expect(storage.data.has(DRAFTS_STORAGE_KEY)).toBe(false)
      writer.schedule({ a: 'text' })
      writer.flush()
      expect(loadStoredDrafts(storage, NOW).stamps.a).toBe(NOW)
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
