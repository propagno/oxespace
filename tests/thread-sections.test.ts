import { describe, expect, it, vi } from 'vitest'
import { createSectionsMock, SECTIONS_STORAGE_PREFIX, type SectionsStorage, type ThreadLookup } from '../src/components/Threads/sections/sectionsMock'
import { normalizeSectionName, SECTION_NAME_MAX, sectionErrorCode, SectionError, type ThreadSection } from '../src/components/Threads/sections/sectionsContract'
import { groupBySection, moveSectionIds } from '../src/components/Threads/sections/sectionsModel'

function memoryStorage(): SectionsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, get: key => data.get(key) ?? null, set: (key, value) => { data.set(key, value) }, keys: () => [...data.keys()] }
}

function setup(threads: Record<string, ThreadLookup> = { a: { projectId: 'p1' }, b: { projectId: 'p1' }, child: { projectId: 'p1', parentThreadId: 'a' }, other: { projectId: 'p2' } }) {
  const storage = memoryStorage()
  let id = 0
  const api = createSectionsMock({ storage, lookup: threadId => threads[threadId], now: () => 1000, newId: () => `s${++id}` })
  return { storage, api }
}

const rejection = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => sectionErrorCode(error))

describe('section names', () => {
  it('trims and accepts up to the limit, without control characters', () => {
    expect(normalizeSectionName('  Work  ')).toBe('Work')
    expect(normalizeSectionName('x'.repeat(SECTION_NAME_MAX))).toHaveLength(SECTION_NAME_MAX)
    expect(normalizeSectionName('x'.repeat(SECTION_NAME_MAX + 1))).toBeNull()
    expect(normalizeSectionName('   ')).toBeNull()
    expect(normalizeSectionName('two\nlines')).toBeNull()
    expect(normalizeSectionName('tab\there')).toBeNull()
    expect(normalizeSectionName('Seção ✓ 🚀')).toBe('Seção ✓ 🚀')
  })
  it('reads the code from the mock, an IPC object and an IPC message', () => {
    expect(sectionErrorCode(new SectionError('thread.section.notFound'))).toBe('thread.section.notFound')
    expect(sectionErrorCode({ code: 'thread.section.invalidName', params: { max: 60 } })).toBe('thread.section.invalidName')
    expect(sectionErrorCode(new Error("Error invoking remote method 'thread:section-move': thread.section.childFollowsParent"))).toBe('thread.section.childFollowsParent')
    expect(sectionErrorCode(new Error('EBUSY'))).toBeNull()
  })
})

describe('sections mock', () => {
  it('creates, renames and lists per project, persisted in storage', async () => {
    const { api, storage } = setup()
    const work = await api.createSection({ projectId: 'p1', name: ' Work ' })
    await api.createSection({ projectId: 'p1', name: 'Ideas' })
    await api.createSection({ projectId: 'p2', name: 'Elsewhere' })
    expect(work).toEqual({ id: 's1', projectId: 'p1', name: 'Work', order: 0, collapsed: false, createdAt: 1000 })
    await api.renameSection({ id: 's1', name: 'Shipping' })
    expect((await api.listSections('p1')).map(section => [section.name, section.order])).toEqual([['Shipping', 0], ['Ideas', 1]])
    expect((await api.listSections('p2')).map(section => section.name)).toEqual(['Elsewhere'])
    expect(JSON.parse(storage.data.get(`${SECTIONS_STORAGE_PREFIX}p1`)!).sections).toHaveLength(2)
  })

  it('rejects invalid names with thread.section.invalidName and its max', async () => {
    const { api } = setup()
    await expect(api.createSection({ projectId: 'p1', name: '' })).rejects.toMatchObject({ code: 'thread.section.invalidName', params: { max: SECTION_NAME_MAX } })
    await expect(api.createSection({ projectId: 'p1', name: 'x'.repeat(61) })).rejects.toMatchObject({ code: 'thread.section.invalidName' })
    const section = await api.createSection({ projectId: 'p1', name: 'Ok' })
    expect(await rejection(api.renameSection({ id: section.id, name: 'bad\u0007' }))).toBe('thread.section.invalidName')
    expect(await rejection(api.renameSection({ id: 'missing', name: 'Fine' }))).toBe('thread.section.notFound')
  })

  it('moves conversations, and deleting a section keeps them with no section', async () => {
    const { api } = setup()
    const work = await api.createSection({ projectId: 'p1', name: 'Work' })
    await api.moveToSection({ threadId: 'a', sectionId: work.id })
    await api.moveToSection({ threadId: 'b', sectionId: work.id })
    expect(api.assignments('p1')).toEqual({ a: work.id, b: work.id })
    await api.moveToSection({ threadId: 'b', sectionId: null })
    expect(api.assignments('p1')).toEqual({ a: work.id })
    await api.deleteSection({ id: work.id })
    expect(api.assignments('p1')).toEqual({})
    expect(await api.listSections('p1')).toEqual([])
  })

  it('never moves a child: it follows its parent', async () => {
    const { api } = setup()
    const work = await api.createSection({ projectId: 'p1', name: 'Work' })
    expect(await rejection(api.moveToSection({ threadId: 'child', sectionId: work.id }))).toBe('thread.section.childFollowsParent')
    expect(await rejection(api.moveToSection({ threadId: 'unknown', sectionId: work.id }))).toBe('thread.section.notFound')
    // A section of another project is not found from this conversation.
    const elsewhere = await api.createSection({ projectId: 'p2', name: 'Elsewhere' })
    expect(await rejection(api.moveToSection({ threadId: 'a', sectionId: elsewhere.id }))).toBe('thread.section.notFound')
  })

  it('reorders only with exactly the project set, and collapses', async () => {
    const { api } = setup()
    const one = await api.createSection({ projectId: 'p1', name: 'One' })
    const two = await api.createSection({ projectId: 'p1', name: 'Two' })
    const three = await api.createSection({ projectId: 'p1', name: 'Three' })
    expect((await api.reorderSections({ projectId: 'p1', ids: [three.id, one.id, two.id] })).map(section => section.name)).toEqual(['Three', 'One', 'Two'])
    expect(await rejection(api.reorderSections({ projectId: 'p1', ids: [one.id, two.id] }))).toBe('thread.section.notFound')
    expect(await rejection(api.reorderSections({ projectId: 'p1', ids: [one.id, one.id, two.id] }))).toBe('thread.section.notFound')
    await api.setSectionCollapsed({ id: two.id, collapsed: true })
    expect((await api.listSections('p1')).find(section => section.id === two.id)?.collapsed).toBe(true)
    await api.deleteSection({ id: three.id })
    expect((await api.listSections('p1')).map(section => [section.name, section.order])).toEqual([['One', 0], ['Two', 1]])
  })

  it('announces every change for its project', async () => {
    const { api } = setup()
    const listener = vi.fn()
    const off = api.onSectionsChanged(listener)
    const section = await api.createSection({ projectId: 'p1', name: 'Work' })
    await api.moveToSection({ threadId: 'a', sectionId: section.id })
    off()
    await api.deleteSection({ id: section.id })
    expect(listener.mock.calls).toEqual([[{ projectId: 'p1' }], [{ projectId: 'p1' }]])
  })

  it('reads damaged storage as empty', async () => {
    const { api, storage } = setup()
    storage.data.set(`${SECTIONS_STORAGE_PREFIX}p1`, '{not json')
    expect(await api.listSections('p1')).toEqual([])
    expect(api.assignments('p1')).toEqual({})
  })
})

describe('grouping the list', () => {
  const section = (id: string, order: number): ThreadSection => ({ id, projectId: 'p1', name: id, order, collapsed: false, createdAt: 0 })
  it('puts conversations in section order, keeps their order, and sends unknown sections to no section', () => {
    const where: Record<string, string | null> = { a: 'later', b: null, c: 'first', d: 'gone', e: 'first' }
    const result = groupBySection(['a', 'b', 'c', 'd', 'e'], [section('later', 1), section('first', 0), section('empty', 2)], id => where[id])
    expect(result.sections.map(group => [group.section.id, group.threads])).toEqual([['first', ['c', 'e']], ['later', ['a']], ['empty', []]])
    expect(result.loose).toEqual(['b', 'd'])
  })
  it('moves a section one place and refuses to move past the ends', () => {
    const sections = [section('a', 0), section('b', 1), section('c', 2)]
    expect(moveSectionIds(sections, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveSectionIds(sections, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveSectionIds(sections, 'a', -1)).toBeNull()
    expect(moveSectionIds(sections, 'c', 1)).toBeNull()
    expect(moveSectionIds(sections, 'x', 1)).toBeNull()
  })
})
