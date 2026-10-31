import { describe, expect, it } from 'vitest'
import { isThreadSectionsWorkspaceId, normalizeThreadSections, sectionNameKey, threadSectionsRefusal } from '../shared/thread-sections'
import { THREAD_SECTIONS_LIMITS, THREAD_SECTIONS_REFUSALS, type ThreadSectionsRefusal } from '../shared/types/thread-sections'

const all = () => true
const section = (id: string, name: string, order: number, extra: Record<string, unknown> = {}) => ({ id, name, order, ...extra })
const save = (input: unknown, exists: (id: string) => boolean = all) => normalizeThreadSections(input, exists)
const refusal = (input: unknown): ThreadSectionsRefusal | null => { const result = save(input); return result.ok ? null : result.refusal }

describe('sections save: normalization', () => {
  it('trims names, sorts by order (ties keep payload order), renumbers from 0 and defaults collapsed', () => {
    const result = save({
      sections: [section('c', '  Later ', 40), section('a', 'First', 3, { collapsed: true }), section('b', 'Tied', 40)],
      assignments: { t2: 'b', t1: 'a' }
    })
    expect(result).toEqual({ ok: true, state: {
      sections: [{ id: 'a', name: 'First', order: 0, collapsed: true }, { id: 'c', name: 'Later', order: 1, collapsed: false }, { id: 'b', name: 'Tied', order: 2, collapsed: false }],
      assignments: { t1: 'a', t2: 'b' }
    } })
  })

  it('drops assignments of conversations that no longer exist, without refusing', () => {
    const result = save({ sections: [section('a', 'A', 0)], assignments: { live: 'a', gone: 'a' } }, id => id === 'live')
    expect(result).toEqual({ ok: true, state: { sections: [{ id: 'a', name: 'A', order: 0, collapsed: false }], assignments: { live: 'a' } } })
  })

  it('accepts the empty state', () => {
    expect(save({ sections: [], assignments: {} })).toEqual({ ok: true, state: { sections: [], assignments: {} } })
  })

  it('counts a name in characters, not UTF-16 units', () => {
    expect(refusal({ sections: [section('a', '😀'.repeat(THREAD_SECTIONS_LIMITS.name), 0)], assignments: {} })).toBeNull()
  })
})

describe('sections save: refusals', () => {
  it.each<[string, unknown]>([
    ['not an object', 'sections'],
    ['null', null],
    ['an array', []],
    ['an unknown key on the state', { sections: [], assignments: {}, extra: 1 }],
    ['sections missing', { assignments: {} }],
    ['assignments missing', { sections: [] }],
    ['sections not a list', { sections: {}, assignments: {} }],
    ['assignments a list', { sections: [], assignments: [] }],
    ['a section that is not an object', { sections: ['a'], assignments: {} }],
    ['an unknown key on a section', { sections: [section('a', 'A', 0, { color: 'red' })], assignments: {} }],
    ['an empty id', { sections: [section('', 'A', 0)], assignments: {} }],
    ['a numeric id', { sections: [{ id: 1, name: 'A', order: 0 }], assignments: {} }],
    ['an id over 100 characters', { sections: [section('x'.repeat(THREAD_SECTIONS_LIMITS.sectionId + 1), 'A', 0)], assignments: {} }],
    ['an id with a control character', { sections: [section('a\nb', 'A', 0)], assignments: {} }],
    ['a repeated id', { sections: [section('a', 'A', 0), section('a', 'B', 1)], assignments: {} }],
    ['a negative order', { sections: [section('a', 'A', -1)], assignments: {} }],
    ['a fractional order', { sections: [section('a', 'A', 1.5)], assignments: {} }],
    ['an infinite order', { sections: [section('a', 'A', Infinity)], assignments: {} }],
    ['NaN as order', { sections: [section('a', 'A', NaN)], assignments: {} }],
    ['a string order', { sections: [section('a', 'A', '0' as unknown as number)], assignments: {} }],
    ['collapsed not a boolean', { sections: [section('a', 'A', 0, { collapsed: 'yes' })], assignments: {} }],
    ['a name that is not a string', { sections: [{ id: 'a', name: 5, order: 0 }], assignments: {} }],
    ['an assignment to a section not in the payload', { sections: [section('a', 'A', 0)], assignments: { t1: 'b' } }],
    ['an assignment that is not a string', { sections: [section('a', 'A', 0)], assignments: { t1: 1 } }],
    ['an assignment with an empty conversation id', { sections: [section('a', 'A', 0)], assignments: { '': 'a' } }],
    ['an object with a foreign prototype', Object.assign(Object.create({ inherited: true }), { sections: [], assignments: {} })]
  ])('refuses %s as invalid', (_label, input) => {
    expect(refusal(input)).toBe('invalid')
  })

  it('checks an assignment to a missing section even when the conversation is gone', () => {
    expect(save({ sections: [section('a', 'A', 0)], assignments: { gone: 'b' } }, () => false)).toMatchObject({ ok: false, refusal: 'invalid' })
  })

  it('refuses more than 100 sections or 10,000 assignments as tooMany', () => {
    const sections = Array.from({ length: THREAD_SECTIONS_LIMITS.sections + 1 }, (_, index) => section(`s${index}`, `S${index}`, index))
    expect(refusal({ sections, assignments: {} })).toBe('tooMany')
    expect(refusal({ sections: sections.slice(0, THREAD_SECTIONS_LIMITS.sections), assignments: {} })).toBeNull()
    const assignments = Object.fromEntries(Array.from({ length: THREAD_SECTIONS_LIMITS.assignments + 1 }, (_, index) => [`t${index}`, 's0']))
    expect(refusal({ sections: [section('s0', 'S', 0)], assignments })).toBe('tooMany')
    delete assignments.t0
    expect(refusal({ sections: [section('s0', 'S', 0)], assignments })).toBeNull()
  })

  it.each(['', '   ', '　'])('refuses the blank name %j as nameEmpty', name => {
    expect(refusal({ sections: [section('a', name, 0)], assignments: {} })).toBe('nameEmpty')
  })

  it('refuses a name over 60 characters as nameTooLong, after trimming', () => {
    expect(refusal({ sections: [section('a', 'x'.repeat(THREAD_SECTIONS_LIMITS.name + 1), 0)], assignments: {} })).toBe('nameTooLong')
    expect(refusal({ sections: [section('a', ` ${'x'.repeat(THREAD_SECTIONS_LIMITS.name)} `, 0)], assignments: {} })).toBeNull()
  })

  it.each([
    ['a right-to-left override', 'abc‮def'],
    ['a bidi isolate', 'a⁦b'],
    ['a zero-width space', 'a​b'],
    ['a left-to-right mark', 'a‎b'],
    ['a BOM', 'a﻿b'],
    ['a tag character', 'a\u{E0041}b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a NUL', 'a\u0000b'],
    ['DEL', 'a\u007Fb'],
    ['a C1 control', 'a\u0085b']
  ])('refuses a name with %s as nameHidden', (_label, name) => {
    expect(refusal({ sections: [section('a', name, 0)], assignments: {} })).toBe('nameHidden')
  })

  it('refuses names equal ignoring case and Unicode form as nameDuplicate, naming the second', () => {
    expect(save({ sections: [section('a', 'Work', 0), section('b', ' wORK ', 1)], assignments: {} }))
      .toEqual({ ok: false, refusal: 'nameDuplicate', message: { code: 'thread.sections.nameDuplicate', params: { name: 'wORK' } } })
    expect(refusal({ sections: [section('a', 'Café', 0), section('b', 'CAFÉ', 1)], assignments: {} })).toBe('nameDuplicate')
    expect(sectionNameKey(' Ação ')).toBe(sectionNameKey('AÇÃO'))
  })

  it('reports the first rule broken, in payload order', () => {
    expect(refusal({ sections: [section('a', '', 0), section('b', 'x'.repeat(61), 1)], assignments: {} })).toBe('nameEmpty')
  })
})

describe('sections refusals: codes', () => {
  it('carry one C3 code each, with their parameters', () => {
    const messages = Object.fromEntries(THREAD_SECTIONS_REFUSALS.map(value => [value, threadSectionsRefusal(value, 'Work').message]))
    expect(messages).toEqual({
      invalid: { code: 'thread.sections.invalid', params: {} },
      tooMany: { code: 'thread.sections.tooMany', params: { sections: 100, assignments: 10_000 } },
      nameEmpty: { code: 'thread.sections.nameEmpty', params: {} },
      nameTooLong: { code: 'thread.sections.nameTooLong', params: { max: 60 } },
      nameHidden: { code: 'thread.sections.nameHidden', params: {} },
      nameDuplicate: { code: 'thread.sections.nameDuplicate', params: { name: 'Work' } },
      unknownWorkspace: { code: 'thread.sections.unknownWorkspace', params: {} }
    })
  })

  it('accepts only sensible workspace ids', () => {
    expect(isThreadSectionsWorkspaceId('thread:project-1')).toBe(true)
    expect(isThreadSectionsWorkspaceId('w'.repeat(THREAD_SECTIONS_LIMITS.workspaceId))).toBe(true)
    for (const value of ['', 'w'.repeat(THREAD_SECTIONS_LIMITS.workspaceId + 1), 'a\u0000b', 'a‮b', 7, null, undefined, {}]) {
      expect(isThreadSectionsWorkspaceId(value), JSON.stringify(value)).toBe(false)
    }
  })
})
