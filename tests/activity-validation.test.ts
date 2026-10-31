import { describe, expect, it } from 'vitest'
import { activityRefusal, mergeActivityEntries, normalizeActivityEntries, normalizeActivitySeen } from '../shared/activity'
import { ACTIVITY_LIMITS, ACTIVITY_REFUSALS, type ActivityEntry } from '../shared/types/activity'

const NOW = 1_800_000_000_000
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: 'thread', id: 't1', kind: 'needs-you', target: { type: 'thread', threadId: 't1', workspaceId: 'thread:p1' }, title: 'Fix the build', detail: 'Waiting for your decision.', at: NOW - 1000, ...over
})
const check = (input: unknown) => normalizeActivityEntries(input, NOW)
const refusal = (input: unknown) => { const result = check(input); return result.ok ? 'ok' : result.refusal }
const valid = (over: Record<string, unknown> = {}) => { const result = check([entry(over)]); if (!result.ok) throw Error(result.refusal); return result.entries[0] }

describe('activity validation (F30)', () => {
  it('accepts each source with its own target and kinds', () => {
    expect(valid()).toEqual(entry())
    expect(valid({ source: 'code', id: 'pane-1', kind: 'failed', target: { type: 'pane', workspaceId: 'w1', paneId: 'pane-1' } }).target).toEqual({ type: 'pane', workspaceId: 'w1', paneId: 'pane-1' })
    expect(valid({ source: 'background', id: 'j1', kind: 'finished', target: { type: 'background', workspaceId: 'w1', jobId: 'j1' } }).kind).toBe('finished')
    expect(valid({ source: 'quota', id: 'claude:5h', kind: 'quota', target: { type: 'quota', provider: 'codex' } }).source).toBe('quota')
    expect(valid({ source: 'update', id: '1.4.0', kind: 'update', target: { type: 'update', version: '1.4.0' } }).id).toBe('1.4.0')
    expect(valid({ source: 'mcp', id: 'srv', kind: 'needs-you', target: { type: 'mcp', serverId: 'srv' } }).source).toBe('mcp')
    expect(valid({ target: { type: 'thread', threadId: 't1' } }).target).toEqual({ type: 'thread', threadId: 't1' })
  })

  it('trims title and detail, and drops an empty detail', () => {
    expect(valid({ title: '  Spaced  ', detail: '   ' })).toEqual({ ...entry(), title: 'Spaced', detail: undefined, at: NOW - 1000 })
    expect('detail' in valid({ detail: '' })).toBe(false)
    expect('detail' in valid({ detail: undefined })).toBe(false)
  })

  it('refuses what is not a list of entries', () => {
    for (const input of [undefined, null, 'x', 1, {}, { entries: [] }]) expect(refusal(input), String(input)).toBe('invalid')
    for (const item of [null, 'x', [], 1, Object.create({ inherited: 1 })]) expect(refusal([item])).toBe('invalid')
    expect(check([])).toEqual({ ok: true, entries: [] })
  })

  it('refuses unknown keys, in the entry and in its target', () => {
    expect(refusal([entry({ read: true })])).toBe('invalid')
    expect(refusal([entry({ target: { type: 'thread', threadId: 't1', extra: 'x' } })])).toBe('invalid')
  })

  it('refuses unknown sources and kinds, and kinds or targets that do not belong to the source', () => {
    expect(refusal([entry({ source: 'email' })])).toBe('invalid')
    expect(refusal([entry({ kind: 'done' })])).toBe('invalid')
    expect(refusal([entry({ kind: 'quota' })])).toBe('invalid')
    expect(refusal([entry({ source: 'update', kind: 'needs-you', target: { type: 'update', version: '1' } })])).toBe('invalid')
    expect(refusal([entry({ target: { type: 'pane', workspaceId: 'w', paneId: 'p' } })])).toBe('invalid')
    expect(refusal([entry({ target: { type: 'thread' } })])).toBe('invalid')
    expect(refusal([entry({ target: 'thread:t1' })])).toBe('invalid')
    expect(refusal([entry({ source: 'quota', kind: 'quota', target: { type: 'quota', provider: 'gemini' } })])).toBe('invalid')
  })

  it('refuses ids that are empty, padded, too long or not strings', () => {
    for (const id of ['', ' t1', 't1 ', 'x'.repeat(ACTIVITY_LIMITS.id + 1), 7, null]) expect(refusal([entry({ id })]), String(id)).toBe('invalid')
    expect(refusal([entry({ id: 'x'.repeat(ACTIVITY_LIMITS.id) })])).toBe('ok')
    expect(refusal([entry({ target: { type: 'thread', threadId: '' } })])).toBe('invalid')
    expect(refusal([entry({ target: { type: 'thread', threadId: 't1', workspaceId: 5 } })])).toBe('invalid')
  })

  it('caps title and detail by characters after trimming', () => {
    expect(refusal([entry({ title: 'x'.repeat(ACTIVITY_LIMITS.title) })])).toBe('ok')
    expect(refusal([entry({ title: `  ${'x'.repeat(ACTIVITY_LIMITS.title)}  ` })])).toBe('ok')
    expect(refusal([entry({ title: 'x'.repeat(ACTIVITY_LIMITS.title + 1) })])).toBe('titleTooLong')
    // Code points, not UTF-16 units: 200 emoji fit.
    expect(refusal([entry({ title: '😀'.repeat(ACTIVITY_LIMITS.title) })])).toBe('ok')
    expect(refusal([entry({ detail: 'y'.repeat(ACTIVITY_LIMITS.detail) })])).toBe('ok')
    expect(refusal([entry({ detail: 'y'.repeat(ACTIVITY_LIMITS.detail + 1) })])).toBe('detailTooLong')
  })

  it('refuses an empty title and a title or detail that is not text', () => {
    for (const title of ['', '   ', 5, null, undefined]) expect(refusal([entry({ title })]), String(title)).toBe('invalid')
    expect(refusal([entry({ detail: 5 })])).toBe('invalid')
  })

  it('refuses control, format and hidden characters in any text', () => {
    const hidden = ['line\nbreak', 'tab\there', 'nul\u0000', 'del\u007f', 'c1\u0085', 'rtl‮evil', 'zero​width', 'bom﻿', 'tag\u{e0041}', 'fillerㅤ']
    for (const text of hidden) {
      expect(refusal([entry({ title: text })]), JSON.stringify(text)).toBe('hiddenCharacters')
      expect(refusal([entry({ detail: text })]), JSON.stringify(text)).toBe('hiddenCharacters')
    }
    // At the edges too: trimming must not make them vanish.
    for (const text of ['﻿Start', 'End\n', '​']) expect(refusal([entry({ title: text })]), JSON.stringify(text)).toBe('hiddenCharacters')
    expect(refusal([entry({ id: 'a​b' })])).toBe('hiddenCharacters')
    expect(refusal([entry({ target: { type: 'thread', threadId: 'a‮b' } })])).toBe('hiddenCharacters')
    // Accents and emoji are ordinary text.
    expect(refusal([entry({ title: 'Ação concluída 🎉' })])).toBe('ok')
  })

  it('refuses a time that is not a non-negative integer, or more than a minute ahead', () => {
    for (const at of [1.5, -1, NaN, Infinity, '1', null, undefined, Number.MAX_SAFE_INTEGER + 2]) expect(refusal([entry({ at })]), String(at)).toBe('invalid')
    expect(refusal([entry({ at: NOW + ACTIVITY_LIMITS.futureMs })])).toBe('ok')
    expect(refusal([entry({ at: NOW + ACTIVITY_LIMITS.futureMs + 1 })])).toBe('future')
    expect(refusal([entry({ at: 0 })])).toBe('ok')
  })

  it('refuses at most 200 entries per call', () => {
    expect(refusal(Array.from({ length: ACTIVITY_LIMITS.perCall }, (_, index) => entry({ id: `t${index}` })))).toBe('ok')
    expect(refusal(Array.from({ length: ACTIVITY_LIMITS.perCall + 1 }, (_, index) => entry({ id: `t${index}` })))).toBe('tooMany')
  })

  it('refuses the whole call when any text looks like a credential', () => {
    // Built by concatenation, as tests/secrets.test.ts does, so no scanner mistakes them for real keys.
    const github = 'ghp_' + 'c'.repeat(36)
    const secrets = ['token=' + 'abcdef123456', 'key sk-ant-api03-' + 'a'.repeat(40), github, 'Authorization: Bearer ' + 'abcdefgh12345678', 'https://user:' + 'hunter2@example.com']
    for (const text of secrets) {
      expect(refusal([entry({ id: 'fine' }), entry({ id: 'leak', title: text })]), text).toBe('secret')
      expect(refusal([entry({ detail: text })]), text).toBe('secret')
    }
    expect(refusal([entry({ id: github })])).toBe('secret')
    expect(refusal([entry({ target: { type: 'thread', threadId: github } })])).toBe('secret')
    expect(refusal([entry({ title: 'The token expired; sign in again' })])).toBe('ok')
  })

  it('reports the first broken rule in payload order', () => {
    expect(refusal([entry({ title: 'x'.repeat(300) }), entry({ title: 'a‮b' })])).toBe('titleTooLong')
    expect(refusal([entry({ title: 'a‮b' }), { nonsense: true }])).toBe('hiddenCharacters')
  })

  it('gives every refusal its C3 code and parameters', () => {
    for (const reason of ACTIVITY_REFUSALS) expect(activityRefusal(reason).message.code).toBe(`activity.${reason}`)
    expect(activityRefusal('tooMany')).toEqual({ ok: false, refusal: 'tooMany', message: { code: 'activity.tooMany', params: { max: 200 } } })
    expect(activityRefusal('titleTooLong').message.params).toEqual({ max: 200 })
    expect(activityRefusal('detailTooLong').message.params).toEqual({ max: 500 })
    expect(activityRefusal('secret').message.params).toEqual({})
  })
})

describe('activity seen time (F30)', () => {
  it('accepts an integer up to a minute ahead', () => {
    expect(normalizeActivitySeen(NOW, NOW)).toEqual({ ok: true, at: NOW })
    expect(normalizeActivitySeen(NOW + ACTIVITY_LIMITS.futureMs, NOW)).toEqual({ ok: true, at: NOW + ACTIVITY_LIMITS.futureMs })
  })

  it('refuses a future time and nonsense', () => {
    expect(normalizeActivitySeen(NOW + ACTIVITY_LIMITS.futureMs + 1, NOW)).toMatchObject({ ok: false, refusal: 'future', message: { code: 'activity.future' } })
    for (const at of [1.5, -1, NaN, '1', null, undefined, {}]) expect(normalizeActivitySeen(at, NOW), String(at)).toMatchObject({ ok: false, refusal: 'invalid' })
  })
})

describe('activity merge (F30)', () => {
  const item = (id: string, at: number, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ source: 'thread', id, kind: 'finished', target: { type: 'thread', threadId: id }, title: id, at, ...over })

  it('keeps the list newest first', () => {
    const { entries, recorded, ignored } = mergeActivityEntries([], [item('a', 1), item('c', 3), item('b', 2)])
    expect(entries.map(entry => entry.id)).toEqual(['c', 'b', 'a'])
    expect({ recorded, ignored }).toEqual({ recorded: 3, ignored: 0 })
  })

  it('dedupes on source, id and kind, keeping the newer', () => {
    const stored = [item('a', 10, { title: 'stored' })]
    expect(mergeActivityEntries(stored, [item('a', 20, { title: 'new' })]).entries).toEqual([item('a', 20, { title: 'new' })])
    const older = mergeActivityEntries(stored, [item('a', 5, { title: 'old' })])
    expect(older).toEqual({ entries: stored, recorded: 0, ignored: 1 })
    // Another kind or source is another entry.
    expect(mergeActivityEntries(stored, [item('a', 5, { kind: 'failed' }), item('a', 6, { source: 'background', target: { type: 'background', workspaceId: 'w', jobId: 'a' } })]).entries).toHaveLength(3)
  })

  it('dedupes within one call, the later entry winning a tie', () => {
    const merged = mergeActivityEntries([], [item('a', 5, { title: 'first' }), item('b', 5), item('a', 5, { title: 'second' }), item('a', 1, { title: 'older' })])
    expect(merged.entries.map(entry => entry.title)).toEqual(['second', 'b'])
    expect({ recorded: merged.recorded, ignored: merged.ignored }).toEqual({ recorded: 2, ignored: 2 })
  })

  it('puts what was just recorded ahead of a stored entry with the same time', () => {
    expect(mergeActivityEntries([item('old', 5)], [item('new', 5)]).entries.map(entry => entry.id)).toEqual(['new', 'old'])
    expect(mergeActivityEntries([item('a', 5)], [item('a', 5, { title: 'again' })]).entries).toEqual([item('a', 5, { title: 'again' })])
  })

  it('keeps only the newest 200, counting what fell off as ignored', () => {
    const stored = Array.from({ length: 200 }, (_, index) => item(`s${index}`, 1000 - index))
    const merged = mergeActivityEntries(stored, [item('newest', 2000), item('ancient', 1)])
    expect(merged.entries).toHaveLength(ACTIVITY_LIMITS.stored)
    expect(merged.entries[0].id).toBe('newest')
    expect(merged.entries.some(entry => entry.id === 'ancient')).toBe(false)
    expect(merged.entries.at(-1)!.id).toBe('s198')
    expect({ recorded: merged.recorded, ignored: merged.ignored }).toEqual({ recorded: 1, ignored: 1 })
  })
})
